// SPDX-License-Identifier: GPL-3.0-or-later
import { canonical, clone, invariant, publicError, TacError } from './errors.mjs';
const startupJob = j => ['component.start', 'deck.start'].includes(j.kind);
const unresolved = j => ['queued', 'held', 'running', 'cancelling', 'uncertain', 'interrupted'].includes(j.status);

export class StartupRecovery {
  constructor(runtime, native) {
    this.runtime = runtime; this.native = native; this.pending = null; this.target = null; this.attempt = null;
  }
  permits(id) { return Boolean(this.pending && this.target === id); }
  permitsJob(kind, args) { return kind === 'component.start' ? this.permits(args?.component) : kind === 'deck.start' && this.permits('native-deck'); }
  services(settings) {
    return ['kstuff', ...(this.runtime.graph.definitions.has('native-deck') ? ['native-deck'] : []),
      ...(settings.services.shadowmount ? ['shadowmount'] : []), ...(settings.services.payloadManager ? ['payload-manager'] : [])];
  }
  snapshot(state = this.runtime.store.snapshot()) {
    const last = state.startup.native;
    return { available: true, running: Boolean(this.pending), target: this.target, safe: this.runtime.graph.safe,
      last: last ? { status: last.status, service: last.service, at: last.at, error: clone(last.error), services: last.services } : null,
      knownGood: state.knownGoodReceipt ? clone(state.knownGoodReceipt) : null };
  }
  async preview() {
    const r = this.runtime;
    invariant(!this.pending, 'STARTUP_BUSY', 'Startup is already being checked.');
    const state = r.store.snapshot(), probe = this.native.systemProbe(), blockers = [];
    if (probe.busy || r.jobs.running.size || r.graph.pending.size) blockers.push('An operation is still running. Wait for it to settle.');
    if (r.jobs.halted || r.jobs.stopped) blockers.push('The work queue is stopped. Preserve diagnostics before restarting TacHen.');
    if (!probe.boot) blockers.push('The current console boot could not be identified.');
    for (const job of state.jobs.filter(j => unresolved(j) && !startupJob(j)))
      blockers.push(`${job.kind}: review its previous ${job.status} operation in Activity first.`);
    const services = [], identities = [], settings = clone(state.settings);
    if (!blockers.length) {
      for (const service of this.services(settings)) {
        const definition = r.graph.definitions.get(service);
        let evidence;
        try { evidence = await definition.inspect(); }
        catch (error) { evidence = { ready: false, absent: false, reason: publicError(error).message }; }
        const status = evidence.ready ? 'adopt' : evidence.absent ? 'start' : 'blocked';
        identities.push(Object.fromEntries(['ready', 'absent', 'boot', 'pid', 'generation', 'version', 'request', 'stage', 'noSideEffects'].map(key => [key, evidence[key] ?? null])));
        services.push({ id: service, status, reason: status === 'blocked' ? evidence.reason || evidence.message || 'Existing state remains uncertain. Restart the console before another attempt.' : null });
        if (status === 'blocked') blockers.push(`${service}: ${services.at(-1).reason}`);
      }
      // Inspection is read-only. Reconciliation and any new dispatch require confirmation.
      for (const job of state.jobs.filter(j => startupJob(j) && j.status === 'interrupted')) {
        const handler = r.jobs.handlers.get(job.kind);
        try {
          const result = await handler?.reconcile?.(clone(job));
          if (!(result?.absent || result?.completed || result?.expired)) blockers.push(`${job.kind}: its previous result remains uncertain.`);
        } catch { blockers.push(`${job.kind}: the previous receipt could not be verified.`); }
      }
    }
    const current = this.native.systemProbe();
    invariant(r.store.snapshot().revision === state.revision && (!current.busy || probe.busy) && current.boot === probe.boot,
      'RECOVERY_CHANGED', 'Startup state changed during inspection. Review recovery again.');
    const stable = { session: r.session, boot: probe.boot || null, revision: state.revision, settings, services, identities, blockers };
    return { available: blockers.length === 0, proof: r.store.checksum(canonical(stable)), revision: state.revision,
      services, blockers, message: 'Recheck existing services, reconcile prior startup receipts, then start only absent configured components.' };
  }
  async resume({ proof }) {
    if (this.pending) return { accepted: true, running: true };
    const review = await this.preview();
    invariant(review.available, 'RECOVERY_BLOCKED', review.blockers.join(' '));
    invariant(typeof proof === 'string' && proof === review.proof, 'RECOVERY_CHANGED', 'Startup state changed. Review recovery again.');
    // Set the reservation before returning to the phone. Other native jobs stay
    // held throughout recovery; only the current ordered startup step is admitted.
    this.begin(true, review.revision);return { accepted: true, running: true };
  }
  startConfigured() {
    if (this.pending) return this.pending;
    if (this.runtime.graph.safe) return Promise.resolve({ held: true });
    return this.begin(false);
  }
  begin(recovery, reviewedRevision) {
    if (this.pending) return this.pending;
    this.attempt = this.runtime.id();
    this.pending = Promise.resolve().then(() => this.run(recovery, reviewedRevision)).finally(() => {
      this.pending = null;this.target = null;this.runtime.sequence++;
    });
    // Interactive launch has no request waiting for completion. Keep its error
    // recorded and observed rather than creating an unhandled rejection.
    this.pending.catch(() => {});return this.pending;
  }
  async run(recovery, reviewedRevision) {
    const r = this.runtime, candidate = clone(r.store.snapshot().settings), services = this.services(candidate);
    let failure = null;
    try {
      invariant(!r.jobs.halted && !r.jobs.stopped && !r.jobs.running.size && !r.graph.pending.size,
        'STARTUP_BUSY', 'Wait for active operations before starting components.');
      invariant(!r.jobs.snapshot().some(j => unresolved(j) && !startupJob(j)), 'RECOVERY_BLOCKED', 'Review unfinished operations in Activity first.');
      await r.store.transaction(state => {
        state.startup.pending = true;
        state.startup.native = { id: this.attempt, status: 'starting', at: r.now(), service: null, error: null, services };
      }, reviewedRevision);
      if (recovery) {
        for (const job of r.jobs.snapshot().filter(j => startupJob(j) && unresolved(j))) {
          if (['held', 'queued'].includes(job.status)) await r.jobs.cancel(job.id);
          else if (job.status === 'interrupted') await r.jobs.reconcile(job.id);
          else throw new TacError('RECOVERY_BUSY', 'A prior startup worker is still active.');
        }
      }
      for (const service of services) {
        this.target = service;
        await r.store.transaction(state => { state.startup.native.service = service; });
        r.diagnostics?.record('startup', { status: 'native-step', target: service });
        const status = r.graph.states.get(service)?.status;
        if (recovery && ['failed', 'uncertain', 'blocked', 'ready'].includes(status)) await r.graph.reconcile(service);
        await r.graph.start(service);
      }
      // Verify the complete set again before promoting this startup configuration.
      for (const service of services) {
        const definition = r.graph.definitions.get(service), evidence = await definition.inspect();
        invariant(await definition.verify(evidence), 'STARTUP_READINESS_LOST', `${service} lost readiness before startup completed.`);
      }
      await r.store.transaction(state => {
        state.startup.pending = false;state.startup.safe = false;
        Object.assign(state.startup.native, { status: 'ready', service: null, error: null });
        state.knownGood = clone(candidate);state.knownGood.developer.enabled = false;state.knownGood.developer.memoryWrites = false;
        state.knownGoodReceipt = { session: r.session, at: r.now(), firmware: r.identity.firmware || null, services };
        this.history(state, 'Configured native startup verified', 'The complete configured service set passed readiness checks.');
      });
      r.graph.safe = false;r.diagnostics?.record('startup', { status: 'native-ready' });
    } catch (error) {
      failure = publicError(error);r.graph.safe = true;
      try {
        await r.store.transaction(state => {
          state.startup.pending = false;state.startup.safe = true;
          state.startup.native = { id: this.attempt, status: 'failed', at: r.now(), service: this.target, error: failure, services };
          this.history(state, 'Native startup needs attention', failure.message);
        });
      } catch (saveError) {
        // A failed failure-journal write cannot make startup safe to retry.
        r.jobs.halt(saveError);throw saveError;
      }
      r.diagnostics?.record('startup', { status: 'native-failed', target: this.target, code: failure.code });
    }
    r.sequence++;r.notices?.observe();r.diagnostics?.observe();
    return { completed: !failure, error: failure };
  }
  history(state, message, detail) {
    const r = this.runtime;state.history.push({ id: r.id(), session: r.session, at: r.now(), type: 'startup', undo: false, message, detail });
    state.history = state.history.slice(-256);
  }
}
