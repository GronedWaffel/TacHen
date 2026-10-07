import test from 'node:test';
import assert from 'node:assert/strict';
import { installConsoleDeck } from '../src/native-deck.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store, ids, until } from './helpers.mjs';
async function fixture(t, { heartbeat = true, timeout = 1000 } = {}) {
  const process = { pid: 77, name: 'SceShellUI', thread: '', generation: 'boot/77/start' };
  const state = { kstuff: { state: 'installed', injectionReady: true }, processes: [process] };
  const calls = [], receipts = new Map();
  const native = { systemProbe: () => structuredClone(state), deckPoll: id => receipts.get(id) || null,
    deckStart(request, pid, generation, credential) { calls.push({ request, pid, generation, credential });
      receipts.set(request, { request, pid, generation, stage: 3, ready: heartbeat, noSideEffects: false, message: 'Hooks published' }); }
  };
  const runtime = new TacRuntime(await store(), {
    identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    async install(runtime) {
      for (const id of ['coordinator', 'kstuff']) runtime.graph.register({ id, start: () => ({}), verify: () => true });
      installConsoleDeck(runtime, native, { timeout, delay: () => new Promise(resolve => setTimeout(resolve, 1)) });
    }
  }, { id: ids() }); await runtime.start(); t.after(() => runtime.close());
  return { runtime, state, calls, receipts, native };
}
test('native deck readiness requires the renderer heartbeat, not merely published hooks', async t => {
  const { runtime, calls } = await fixture(t);
  await runtime.graph.start('native-deck'); assert.equal(calls.length, 1);
  assert.equal(runtime.capabilities.get('deck').available, true); assert.equal(runtime.capabilities.get('ip-overlay').available, true);
  assert.equal(runtime.capabilities.get('game-overlay').available, false);
  await runtime.graph.start('native-deck'); assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(runtime.snapshot()).includes(calls[0].credential), false);
});
test('missing render heartbeat holds the injection resource; another start cannot launch a second module', async t => {
  const { runtime, calls } = await fixture(t, { heartbeat: false, timeout: 10 });
  await assert.rejects(runtime.graph.start('native-deck'), { code: 'DECK_NOT_READY' });
  assert.equal(runtime.jobs.snapshot()[0].status, 'interrupted'); assert.equal(runtime.capabilities.get('deck').available, false);
  assert.throws(() => runtime.graph.start('native-deck'), { code: 'SERVICE_RETRY_REQUIRED' }); assert.equal(calls.length, 1);
  await assert.rejects(runtime.jobs.reconcile(runtime.jobs.snapshot()[0].id), { code: 'OUTCOME_UNKNOWN' });
});
test('changed process identity before dispatch cannot redirect the injected module into a reused PID', async t => {
  const { runtime, state, calls } = await fixture(t);
  const handler = runtime.jobs.handlers.get('deck.start'); const input = await handler.validate({});
  state.processes[0].generation = 'replacement';
  await assert.rejects(handler.run(input, { id: runtime.id() }), error => error.code === 'SHELLUI_CHANGED' && error.noSideEffects);
  assert.equal(calls.length, 0);
});
test('foreign HEN ownership and transitional kernel hooks prevent native deck injection', async t => {
  const { runtime, state, calls } = await fixture(t);
  state.processes.push({ name: 'etaHEN critical', thread: '', pid: 90, generation: 'another-hen' });
  await assert.rejects(runtime.jobs.enqueue('deck.start', {}, 'foreign-hen'), { code: 'OTHER_HEN_RUNNING' });
  state.processes.pop(); state.kstuff.injectionReady = false;
  await assert.rejects(runtime.jobs.enqueue('deck.start', {}, 'unsafe-hooks'), { code: 'DECK_DEPENDENCY' });assert.equal(calls.length, 0);
});
test('readiness loss and scene recovery reuse the existing module instead of reinjection', async t => {
  const { runtime, receipts, calls } = await fixture(t);
  await runtime.graph.start('native-deck'); await until(() => runtime.jobs.running.size === 0);
  const status = receipts.values().next().value; status.ready = false;
  await runtime.nativeDeck.check(); assert.equal(runtime.capabilities.get('deck').available, false);
  status.ready = true; await runtime.nativeDeck.check(); assert.equal(runtime.capabilities.get('deck').available, true);assert.equal(calls.length, 1);
});
