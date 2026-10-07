// SPDX-License-Identifier: GPL-3.0-or-later
import { ConsoleDeck } from './deck.mjs';
import { invariant, TacError } from './errors.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function installConsoleDeck(runtime, native, { delay = sleep, timeout = 30000 } = {}) {
  runtime.consoleDeck = new ConsoleDeck(runtime); runtime.deckCredential = runtime.id();
  let request = null, monitor = null;
  function enable(ready) {
    for (const feature of ['deck', 'ip-overlay']) runtime.capability(feature, ready,
      ready ? 'Native ShellUI renderer heartbeat verified.' : 'Native renderer is not ready. Use the phone interface.');
    // The separate game-input relay owns game-overlay readiness. ShellUI's
    // heartbeat alone cannot establish game-process input isolation.
  }
  function inspect() {
    if (!request) return { absent: true, ready: false };
    const status = native.deckPoll(request);
    return status ? { ...status, absent: status.stage === 4 && status.noSideEffects } : { ready: false, absent: true };
  }
  function target(input) {
    const state = native.systemProbe();
    invariant(!state.busy && state.kstuff?.state === 'installed' && state.kstuff.injectionReady,
      'DECK_DEPENDENCY', 'Verified kstuff must be ready before the native deck starts.');
    const shells = state.processes.filter(p => p.name === 'SceShellUI');
    invariant(shells.length === 1 && shells[0].generation, 'SHELLUI_IDENTITY', 'ShellUI process identity could not be verified.');
    invariant(!state.processes.some(p => /etahen.*(?:critical|utility)|(?:critical|utility).*etahen/i.test(p.name + ' ' + p.thread)),
      'OTHER_HEN_RUNNING', 'Another HEN owns ShellUI. Start TacHen in a separate clean session.');
    if (input?.generation) invariant(input.pid === shells[0].pid && input.generation === shells[0].generation,
      'SHELLUI_CHANGED', 'ShellUI restarted after the native deck was requested.');
    return { pid: shells[0].pid, generation: shells[0].generation };
  }
  runtime.jobs.register('deck.start', {
    validate: target, resources: () => ['native-payload-dispatch', 'shellui-hooks'], timeout: timeout + 30000, cancellable: false,
    async run(input, context) {
      try { target(input); } catch (error) { error.noSideEffects = true; throw error; }
      request = context.id; native.deckStart(request, input.pid, input.generation, runtime.deckCredential);
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline && !context.signal.aborted) {
        const status = inspect();
        invariant(status.request === request && status.pid === input.pid && status.generation === input.generation,
          'DECK_RECEIPT', 'Native deck receipt does not match this ShellUI process.');
        if (status.ready) return { completed: true, evidence: status };
        if (status.stage === 4 && status.noSideEffects) throw Object.assign(new TacError('DECK_REJECTED', status.message), { noSideEffects: true });
        invariant(status.stage !== 5, 'DECK_UNCERTAIN', status.message || 'Deck startup needs inspection before retrying.');
        await context.progress({ completed: 0, total: 1, phase: status.message || 'Waiting for native renderer' });
        await delay(250);
      }
      throw new TacError('DECK_NOT_READY', 'The native deck did not produce a fresh render heartbeat. Use the phone interface; no reinjection was issued.');
    },
    verify(result, input) { const status = inspect(); return status.ready && status.pid === input.pid && status.generation === input.generation && result.evidence.request === status.request; },
    reconcile(job) { request = job.id; const status = inspect(); if (status.absent) return { absent: true };
      return status.ready && status.pid === job.args.pid && status.generation === job.args.generation ? { completed: true, evidence: status } : null; }
  });
  runtime.graph.register({ id: 'native-deck', dependencies: ['coordinator', 'kstuff'], optional: true, timeout: timeout + 35000,
    inspect, verify: evidence => evidence?.request === inspect().request && inspect().ready,
    async start({ signal }) {
      const current = inspect(); if (current.ready) { enable(true); return current; }
      invariant(current.absent, 'DECK_UNCERTAIN', 'The previous native deck attempt needs inspection.');
      const job = await runtime.jobs.enqueue('deck.start', {}, 'deck_' + runtime.session);
      while (!signal.aborted) {
        const state = runtime.jobs.snapshot().find(j => j.id === job.id);
        if (state.status === 'completed') { enable(true); return state.result.evidence; }
        if (['failed', 'interrupted', 'cancelled', 'held', 'uncertain'].includes(state.status))
          throw new TacError(state.error?.code || 'DECK_STOPPED', state.error?.message || 'Native deck startup needs inspection.');
        await delay(250);
      }
      throw new TacError('DECK_WAIT_EXPIRED', 'Deck startup remains recorded in Activity.');
    }
  });
  async function check() {
    if (!request || runtime.jobs.running.size) return;
    const status = inspect();
    if (status.busy) return;
    const wasReady = runtime.capabilities.get('deck').available;
    if (wasReady !== Boolean(status.ready)) enable(Boolean(status.ready));
    // A temporarily absent scene can recover naturally; never publish the
    // hooks again. The same injection's new render heartbeat re-enables it.
  }
  return runtime.nativeDeck = {
    inspect, check,
    startMonitoring() { if (!monitor) monitor = setInterval(() => { try { check().catch(() => enable(false)); } catch { enable(false); } }, 2000); },
    stopMonitoring() { clearInterval(monitor); monitor = null; }
  };
}
