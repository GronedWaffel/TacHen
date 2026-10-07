import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { installGameInput } from '../src/game-input.mjs';
import { store, ids, until } from './helpers.mjs';
const game = { pid: 91, generation: '100:0/91/101:0', titleId: 'PPSA00001', version: '01.000.000', metadataHash: 'a'.repeat(64) };
async function fixture(t) {
  const calls = [], receipts = new Map(), probe = { boot: '100:0', kstuff: { injectionReady: true }, processes: [{ pid: game.pid, generation: game.generation }] };
  const renderer = { ready: true };
  const native = { systemProbe: () => structuredClone(probe),
    gameInputStart(request, pid, generation, titleId, metadataHash) { calls.push({ request, pid, generation, titleId, metadataHash });receipts.set(request, { request, pid, generation, metadataHash, stage: 2, phase: 2, captureEnabled: false }); },
    gameInputPoll: request => receipts.has(request) ? structuredClone(receipts.get(request)) : null };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    install(runtime) { runtime.nativeDeck = { inspect: () => renderer, stopMonitoring() {} };installGameInput(runtime, native, { delay: () => new Promise(resolve => setTimeout(resolve, 1)) }); }
  }, { id: ids() }).start();runtime.game = { ...game };runtime.capability('deck', true);t.after(() => runtime.close());
  const settled = async () => { await until(() => runtime.jobs.snapshot().length && !runtime.jobs.running.size);return runtime.jobs.snapshot().at(-1); };
  return { runtime, calls, receipts, probe, native, renderer, settled };
}
test('input callback prepares without any registered module and once per game instance', async t => {
  const f = await fixture(t);await Promise.all([f.runtime.gameInput.refresh(), f.runtime.gameInput.refresh()]);
  assert.equal((await f.settled()).result.phase, 'prepared');assert.equal(f.calls.length, 1);
  await f.runtime.gameInput.refresh();assert.equal(f.runtime.snapshot().gameInput.phase, 'prepared');
  assert.equal(f.runtime.capabilities.get('game-overlay').available, false);assert.equal(f.runtime.snapshot().gameInput.captureAvailable, false);
  f.receipts.get(f.calls[0].request).stage = 4;
  await f.runtime.gameInput.refresh();assert.equal(f.runtime.snapshot().gameInput.phase, 'uncertain');
  f.receipts.delete(f.calls[0].request);
  await f.runtime.gameInput.refresh();assert.equal(f.runtime.snapshot().gameInput.phase, 'unavailable');assert.equal(f.calls.length, 1);
  f.runtime.game.generation = '100:0/91/999:0';await f.runtime.gameInput.refresh();await until(() => f.calls.length === 2 && !f.runtime.jobs.running.size);
  assert.notEqual(f.calls[0].request, f.calls[1].request);
});
test('missing renderer, unsafe startup, bad metadata or readiness cannot dispatch input hooks', async t => {
  const f = await fixture(t);f.renderer.ready = false;await f.runtime.gameInput.refresh();assert.equal(f.calls.length, 0);
  f.renderer.ready = true;f.runtime.graph.safe = true;await f.runtime.gameInput.refresh();assert.equal(f.calls.length, 0);
  f.runtime.graph.safe = false;f.runtime.game.metadataHash = '';await f.runtime.gameInput.refresh();assert.equal(f.calls.length, 0);
  f.runtime.game = { ...game };f.probe.busy = true;await f.runtime.gameInput.refresh();assert.equal(f.calls.length, 0);
  f.probe.busy = false;f.probe.kstuff.injectionReady = false;await f.runtime.gameInput.refresh();assert.equal(f.calls.length, 0);
});
test('rejected and interrupted preparation do not replay and PID reuse can settle old work', async t => {
  for (const stage of [3, 4]) {
    const f = await fixture(t), original = f.native.gameInputStart;
    f.native.gameInputStart = (...args) => { original(...args);Object.assign(f.receipts.get(args[0]), { stage, phase: stage === 4 ? 3 : 0, message: 'Fixture outcome' }); };
    await f.runtime.gameInput.refresh();const job = await f.settled();assert.equal(job.status, stage === 3 ? 'failed' : 'interrupted');
    await f.runtime.gameInput.refresh();assert.equal(f.calls.length, 1);
    if (stage === 4) {
      f.probe.processes[0].generation = undefined;await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });
      f.probe.boot = '';await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });f.probe.boot = '100:0';
      f.probe.processes[0].generation = '100:0/91/555:0';await f.runtime.jobs.reconcile(job.id);assert.equal(f.runtime.jobs.snapshot()[0].result.phase, 'game-ended');
    }
  }
});
test('an unrelated receipt is held and a busy native call cannot target a replacement game', async t => {
  const f = await fixture(t), original = f.native.gameInputStart;
  f.native.gameInputStart = (...args) => { original(...args);f.receipts.get(args[0]).metadataHash = 'b'.repeat(64); };
  await f.runtime.gameInput.refresh();const job = await f.settled();assert.equal(job.status, 'interrupted');assert.equal(job.error.code, 'INPUT_RECEIPT');
  const second = await fixture(t);let tries = 0;
  second.native.gameInputStart = () => { tries++;second.runtime.game = null;throw Object.assign(Error('busy'), { code: 'NATIVE_BUSY' }); };
  await second.runtime.gameInput.refresh();assert.equal((await second.settled()).status, 'failed');assert.equal(tries, 1);
});
test('input preparation shares exclusion with queued native module loading', async t => {
  const f = await fixture(t);let release;
  f.runtime.jobs.register('fixture.module', { validate: () => ({ generation: game.generation }), resources: input => ['game-modules:' + input.generation],
    run: () => new Promise(resolve => { release = () => resolve({ completed: true }); }), verify: () => true });
  await f.runtime.jobs.enqueue('fixture.module', {}, f.runtime.id());await until(() => release);
  const inputJob = await f.runtime.jobs.enqueue('game.input.prepare', {}, f.runtime.id());
  await new Promise(resolve => setTimeout(resolve, 10));assert.equal(f.calls.length, 0);release();
  await until(() => f.runtime.jobs.snapshot().find(job => job.id === inputJob.id).status === 'completed');assert.equal(f.calls.length, 1);
});
