// SPDX-License-Identifier: GPL-3.0-or-later
import { canonical, clone, invariant, publicError, TacError } from './errors.mjs';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE = new Set(['running', 'cancelling', 'uncertain']);

export class JobQueue {
  constructor(store, { id, now = Date.now, session = null, concurrency = 2, changed = () => {}, timeout = 120000 } = {}) {
    this.store = store; this.id = id; this.now = now; this.session = session; this.concurrency = concurrency;
    this.changed = changed; this.timeout = timeout; this.handlers = new Map(); this.running = new Map();
    this.pumping = false; this.halted = false; this.fault = null; this.stopped = false;
  }
  register(kind, handler) {
    invariant(!this.handlers.has(kind) && typeof handler.run === 'function' && typeof handler.validate === 'function',
      'JOB_HANDLER', 'Invalid or duplicate job handler.');
    this.handlers.set(kind, handler);
  }
  async recover() {
    const jobs = this.store.snapshot().jobs;
    if (!jobs.some(job => ACTIVE.has(job.status) || job.status === 'queued')) return;
    await this.store.transaction(state => {
      for (const job of state.jobs) {
        if (ACTIVE.has(job.status)) {
          job.status = 'interrupted'; job.error = { code: 'INTERRUPTED', message: 'Execution was interrupted; its outcome is unknown.',
            action: 'Reconcile the actual result before retrying.' };
        } else if (job.status === 'queued') {
          job.status = 'held'; job.error = { code: 'RESTART_HELD', message: 'Queued work is held after restart.',
            action: 'Resume it when ready.' };
        }
      }
    });
  }
  snapshot() { return this.store.snapshot().jobs; }
  async enqueue(kind, input, key) {
    invariant(!this.halted && !this.stopped, 'QUEUE_HALTED', 'The job queue is not accepting work.');
    invariant(typeof key === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(key), 'JOB_KEY', 'A valid request identity is required.', { status: 400 });
    const handler = this.handlers.get(kind);
    invariant(handler, 'FEATURE_UNAVAILABLE', 'This operation has no installed native adapter.', { status: 409 });
    const requestSignature = canonical({ kind, input });
    const accepted = this.snapshot().find(job => job.key === key);
    if (accepted?.requestSignature) {
      invariant(accepted.requestSignature === requestSignature, 'JOB_KEY_REUSED', 'This request identity belongs to different work.');
      // Validation may bind current process/source identities. A retry of the
      // same accepted request must return its original intent, not rebind it.
      return clone(accepted);
    }
    const args = await handler.validate(clone(input));
    const signature = canonical({ kind, args });
    const { result } = await this.store.transaction(state => {
      const previous = state.jobs.find(job => job.key === key);
      if (previous) {
        invariant(previous.requestSignature ? previous.requestSignature === requestSignature : previous.signature === signature,
          'JOB_KEY_REUSED', 'This request identity belongs to different work.');
        return clone(previous);
      }
      invariant(state.jobs.length < 1024, 'QUEUE_FULL', 'Job history is full; archive completed operations first.');
      handler.guard?.(args, state);
      const resources = handler.resources(args);
      invariant(Array.isArray(resources) && resources.every(x => typeof x === 'string' && x.length <= 160), 'JOB_RESOURCE', 'Invalid operation resources.');
      const job = { id: this.id(), session: this.session, key, kind, args, signature, requestSignature, resources: [...new Set(resources)],
        status: 'queued', progress: null, result: null, error: null, createdAt: this.now(), updatedAt: this.now() };
      state.jobs.push(job); return clone(job);
    });
    this.changed(); this.kick(); return result;
  }
  kick() { if (!this.pumping && !this.halted && !this.stopped) queueMicrotask(() => this.pump().catch(e => this.halt(e))); }
  halt(error) { this.halted = true; this.fault = publicError(error); this.changed(); }
  async patch(id, update) {
    await this.store.transaction(state => {
      const job = state.jobs.find(job => job.id === id);
      invariant(job, 'JOB_MISSING', 'Operation not found.', { status: 404 });
      Object.assign(job, update, { updatedAt: this.now() });
    });
    this.changed();
  }
  async pump() {
    if (this.pumping || this.halted || this.stopped) return;
    this.pumping = true;
    try {
      while (this.running.size < this.concurrency && !this.halted && !this.stopped) {
        const jobs = this.snapshot();
        const locked = new Set(jobs.filter(job => ACTIVE.has(job.status) || job.status === 'interrupted')
          .flatMap(job => job.resources));
        for (const active of this.running.values()) for (const resource of active.job.resources) locked.add(resource);
        const job = jobs.find(job => job.status === 'queued' && !job.resources.some(resource => locked.has(resource)));
        if (!job) break;
        const handler = this.handlers.get(job.kind);
        if (!handler) { await this.patch(job.id, { status: 'held', error: { code: 'ADAPTER_MISSING', message: 'Operation adapter is not installed.' } }); continue; }
        // Durable intent precedes the first possible side effect.
        const claim = await this.store.transaction(state => {
          const current = state.jobs.find(item => item.id === job.id);
          if (current?.status !== 'queued') return false;
          current.status = 'running'; current.updatedAt = this.now(); return true;
        });
        if (!claim.result) continue;
        const active = { job, controller: new AbortController(), expired: false, cancelling: false };
        this.running.set(job.id, active);
        active.promise = this.execute(active, handler);
      }
    } finally { this.pumping = false; }
  }
  async execute(active, handler) {
    const { job, controller } = active;
    let lastProgress = 0, progressTail = Promise.resolve();
    const timer = setTimeout(() => {
      active.expired = true; controller.abort();
      active.timeoutWrite = this.patch(job.id, { status: 'uncertain', error: {
        code: 'JOB_TIMEOUT', message: 'The operation did not confirm completion in time.',
        action: 'Its resource remains reserved until the operation settles and is reconciled.'
      } }).catch(error => this.halt(error));
    }, handler.timeout ?? this.timeout);
    try {
      const result = await handler.run(clone(job.args), {
        id: job.id,
        signal: controller.signal,
        checkpoint: async evidence => {
          const serialized = canonical(evidence);
          invariant(serialized.length <= 16384, 'CHECKPOINT_LIMIT', 'Operation receipt exceeds its limit.');
          await this.patch(job.id, { checkpoint: clone(evidence) });
        },
        progress: value => {
          const now = this.now();
          invariant(value && Number.isFinite(value.completed) && value.completed >= 0 &&
            Number.isFinite(value.total) && value.total >= value.completed && typeof value.phase === 'string',
            'BAD_PROGRESS', 'Invalid operation progress.');
          if (now - lastProgress < 1000 && value.completed !== value.total) return progressTail;
          lastProgress = now;
          progressTail = progressTail.then(() => this.patch(job.id, { progress: clone(value) }));
          return progressTail;
        }
      });
      await active.timeoutWrite; await progressTail;
      const verified = result?.completed === true && await handler.verify(result, job.args);
      clearTimeout(timer); await active.timeoutWrite;
      if (active.expired) {
        await this.patch(job.id, { status: 'interrupted', result: result ?? null });
      } else if (active.cancelling) {
        // A native completion racing a cancellation is still a completion.
        if (verified)
          await this.patch(job.id, { status: 'completed', result, error: null });
        else if (result?.cancelled === true)
          await this.patch(job.id, { status: 'cancelled', result, error: null });
        else await this.patch(job.id, { status: 'interrupted', result: result ?? null, error: {
          code: 'CANCEL_UNCONFIRMED', message: 'Cancellation was requested but not confirmed.' } });
      } else {
        invariant(verified, 'JOB_UNVERIFIED',
          'The operation was accepted but its completion was not verified.');
        await this.patch(job.id, { status: 'completed', result, error: null });
      }
    } catch (error) {
      clearTimeout(timer); await active.timeoutWrite;
      try {
        // Only an adapter that establishes no side effects may mark ordinary failure.
        const status = error?.noSideEffects === true && !active.expired ? 'failed' : 'interrupted';
        await this.patch(job.id, { status, error: publicError(error) });
      } catch (commitError) { this.halt(commitError); }
    } finally {
      clearTimeout(timer); this.running.delete(job.id); this.changed(); this.kick();
    }
  }
  async cancel(id) {
    const job = this.snapshot().find(job => job.id === id);
    invariant(job, 'JOB_MISSING', 'Operation not found.', { status: 404 });
    if (TERMINAL.has(job.status)) return;
    if (job.status === 'queued' || job.status === 'held') {
      // Dispatch may claim a job while this transaction waits for disk I/O.
      // Never cancel it based on the earlier snapshot after native work starts.
      const cancelled = await this.store.transaction(state => {
        const current = state.jobs.find(item => item.id === id);
        if (!['queued', 'held'].includes(current.status)) return false;
        current.status = 'cancelled'; current.error = null; current.updatedAt = this.now(); return true;
      });
      this.changed(); if (cancelled.result) return;
      if (TERMINAL.has(this.snapshot().find(item => item.id === id)?.status)) return;
    }
    const active = this.running.get(id);
    invariant(active && !active.expired, 'JOB_RECONCILE_REQUIRED', 'The operation must be reconciled before another action.');
    invariant(this.handlers.get(job.kind)?.cancellable === true, 'CANCEL_UNSUPPORTED', 'This native operation cannot safely be cancelled.');
    await this.store.transaction(state => {
      const current = state.jobs.find(item => item.id === id);
      if (TERMINAL.has(current.status)) return;
      invariant(current.status === 'running' && this.running.has(id), 'JOB_RECONCILE_REQUIRED', 'Operation state changed. Refresh before cancelling.');
      active.cancelling = true; current.status = 'cancelling'; current.updatedAt = this.now();
    });
    if (active.cancelling) active.controller.abort();
    this.changed();
  }
  async resume(id) {
    const job = this.snapshot().find(job => job.id === id);
    invariant(job?.status === 'held', 'JOB_NOT_HELD', 'Only held work can be resumed.');
    invariant(this.handlers.has(job.kind), 'ADAPTER_MISSING', 'The operation adapter is not installed.');
    await this.handlers.get(job.kind).validate(clone(job.args), { jobId: job.id });
    await this.patch(id, { status: 'queued', error: null }); this.kick();
  }
  async reconcile(id) {
    invariant(!this.running.has(id), 'JOB_BUSY', 'Execution has not settled.');
    const job = this.snapshot().find(job => job.id === id), handler = this.handlers.get(job?.kind);
    invariant(job?.status === 'interrupted' && handler?.reconcile, 'RECONCILE_UNAVAILABLE', 'This operation cannot yet be reconciled automatically.');
    const outcome = await handler.reconcile(clone(job));
    if (outcome?.completed === true && await handler.verify(outcome, job.args))
      await this.patch(id, { status: 'completed', result: outcome, error: null });
    else if (outcome?.absent === true)
      await this.patch(id, { status: 'failed', result: outcome, error: { code: 'NOT_APPLIED', message: 'The operation was verified as not applied.' } });
    else throw new TacError('OUTCOME_UNKNOWN', 'The result remains uncertain. No retry was issued.');
    this.kick();
  }
  stopDispatch() { this.stopped = true; }
}
