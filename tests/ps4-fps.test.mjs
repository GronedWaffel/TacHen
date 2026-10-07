import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { installPs4Fps } from '../src/ps4-fps.mjs';
import { installTelemetry, CounterWindow } from '../src/telemetry.mjs';
import { store, ids, until } from './helpers.mjs';
const game = { pid: 91, generation: '100:0/91/101:0', titleId: 'CUSA00001', version: '01.00', metadataHash: 'a'.repeat(64) };
async function fixture(t) {
  const calls = [], receipts = new Map(), probe = { boot: '100:0', kstuff: { injectionReady: true }, processes: [{ pid: game.pid, generation: game.generation }] };
  const native = { systemProbe: () => structuredClone(probe), telemetryStart: () => null, telemetryPoll: () => null,
    bcFpsStart(request, pid, generation, titleId, metadataHash) { calls.push({ request, pid, generation, titleId, metadataHash });receipts.set(generation, { request, pid, generation, metadataHash, stage: 2, resumed: true, uncertain: false }); },
    bcFpsPoll: (request, generation) => receipts.has(generation) ? { ...receipts.get(generation), request } : null };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    install(runtime) { installPs4Fps(runtime, native, { delay: () => new Promise(resolve => setTimeout(resolve, 1)) });installTelemetry(runtime, native); }
  }, { id: ids() }).start();runtime.game = { ...game };t.after(() => runtime.close());
  const settings = value => runtime.settings({ overlay: { fps: value } }, runtime.store.snapshot().revision);
  const settled = async () => { await until(() => runtime.jobs.snapshot().length && !runtime.jobs.running.size);return runtime.jobs.snapshot().at(-1); };
  return { runtime, calls, receipts, probe, native, settings, settled };
}
test('PS4 monitoring installs once per game generation and never treats preference toggles as reinjection', async t => {
  const f = await fixture(t);await f.runtime.ps4Fps.refresh();assert.equal(f.calls.length, 0);
  await f.settings(true);await Promise.all([f.runtime.ps4Fps.refresh(), f.runtime.ps4Fps.refresh()]);assert.equal((await f.settled()).status, 'completed');
  await f.runtime.ps4Fps.refresh();await f.settings(false);await f.runtime.ps4Fps.refresh();await f.settings(true);await f.runtime.ps4Fps.refresh();assert.equal(f.calls.length, 1);
  f.runtime.game.generation = '100:0/91/999:0';await f.runtime.ps4Fps.refresh();await until(() => f.calls.length === 2 && !f.runtime.jobs.running.size);
  assert.equal(f.calls[1].generation, '100:0/91/999:0');assert.notEqual(f.calls[1].request, f.calls[0].request);
});
test('PS4 preparation stays off on PS5, during safe startup and while readiness is unknown', async t => {
  const f = await fixture(t);await f.settings(true);f.runtime.game.titleId = 'PPSA00001';await f.runtime.ps4Fps.refresh();assert.equal(f.calls.length, 0);
  f.runtime.game = { ...game };f.runtime.graph.safe = true;await f.runtime.ps4Fps.refresh();assert.equal(f.calls.length, 0);
  f.runtime.graph.safe = false;f.probe.busy = true;await f.runtime.ps4Fps.refresh();assert.equal(f.calls.length, 0);assert.equal(f.runtime.jobs.snapshot().length, 0);
  f.probe.busy = false;f.probe.kstuff.injectionReady = false;await f.runtime.ps4Fps.refresh();assert.equal(f.calls.length, 0);
});
test('rejected or uncertain PS4 counter attempts are not replayed automatically', async t => {
  for (const stage of [3, 4]) {
    const f = await fixture(t);const start = f.native.bcFpsStart;f.native.bcFpsStart = (...args) => { start(...args);Object.assign(f.receipts.get(args[2]), { stage, uncertain: stage === 4, message: 'Fixture publication failure' }); };
    await f.settings(true);await f.runtime.ps4Fps.refresh();const job = await f.settled();assert.equal(job.status, stage === 3 ? 'failed' : 'interrupted');
    await f.runtime.ps4Fps.refresh();await f.runtime.ps4Fps.refresh();assert.equal(f.calls.length, 1);
    if (stage === 4) {
      f.probe.busy = true;await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });assert.equal(f.runtime.jobs.snapshot()[0].status, 'interrupted');
      f.probe.busy = false;f.probe.processes = [];await f.runtime.jobs.reconcile(job.id);assert.equal(f.runtime.jobs.snapshot()[0].result.phase, 'game-ended');
    }
  }
});
test('native busy waits recheck game identity and preference before dispatch', async t => {
  const f = await fixture(t);await f.settings(true);let calls = 0;
  f.native.bcFpsStart = () => { calls++;f.runtime.game = { ...game, generation: '100:0/91/999:0' };throw Object.assign(Error('busy'), { code: 'NATIVE_BUSY' }); };
  await f.runtime.ps4Fps.refresh();assert.equal((await f.settled()).status, 'failed');assert.equal(calls, 1);
});
test('PS4 render samples are distinct from display refresh and reset when the counter is unavailable', () => {
  const rates = new CounterWindow();assert.equal(rates.consume({ time: 1000, bc: '100' }).fps, null);
  const value = rates.consume({ time: 1500, bc: '130' });assert.equal(value.fps, 60);assert.equal(value.fpsSource, 'gnm-flip-submissions');
  assert.equal(rates.consume({ time: 2000 }).fps, null);assert.equal(rates.consume({ time: 2500, bc: '190' }).fps, null);
});
