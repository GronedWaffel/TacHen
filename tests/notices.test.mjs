import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { ConsoleDeck, encodeDeck } from '../src/deck.mjs';
import { TacError } from '../src/errors.mjs';
import { store, ids, until } from './helpers.mjs';
async function fixture(t) {
  let clock = 100000;
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }), install() {} },
    { id: ids(), now: () => clock }).start();t.after(() => runtime.close());
  const complete = async (kind = 'save.export', result = { completed: true }, fail = null) => {
    if (!runtime.jobs.handlers.has(kind)) runtime.jobs.register(kind, { validate: async input => input, resources: () => [],
      async run(input) { if (input.fail) throw Object.assign(new TacError('TEST_FAILURE', input.fail), { noSideEffects: true });return input.result; }, verify: async () => true });
    const job = await runtime.jobs.enqueue(kind, { result, fail }, runtime.id());
    await until(() => ['completed', 'failed', 'interrupted'].includes(runtime.jobs.snapshot().find(j => j.id === job.id)?.status));return job;
  };
  return { runtime, complete, advance: ms => clock += ms, now: () => clock, notice: () => runtime.snapshot().notices };
}

test('verified completion is observed without a polling timer and expires while idle', async t => {
  const f = await fixture(t);assert.equal(f.notice().current, null);
  const job = await f.complete();let n = f.notice();assert.equal(n.current.title, 'Save export completed');assert.equal(n.current.reference.id, job.id);
  f.advance(2000);assert.equal(f.notice().current.remainingMs, 3500);f.advance(3501);assert.equal(f.notice().current, null);
  assert.equal(f.runtime.jobs.snapshot().length, 1);assert.equal(f.notice().current, null);
});

test('bursts coalesce without renewing duration; attention interrupts success and duplicate error phases do not replay', async t => {
  const f = await fixture(t);await f.complete();const first = f.notice().current;
  f.advance(1000);await f.complete();const grouped = f.notice().current;assert.equal(grouped.id, first.id);assert.equal(grouped.count, 2);assert.equal(grouped.remainingMs, 4500);
  const failed = await f.complete('library.storage', null, 'Source unavailable');const attention = f.notice().current;
  assert.equal(attention.level, 'attention');assert.match(attention.detail, /Source unavailable/);
  await f.runtime.jobs.patch(failed.id, { status: 'interrupted' });assert.equal(f.notice().current.count, 1);
  await f.runtime.execute('notice.dismiss', { id: attention.id });assert.equal(f.notice().current, null);
  await f.runtime.execute('notice.dismiss', { id: attention.id });assert.equal(f.notice().current, null);
});

test('disabling notices clears pending work and re-enabling does not replay old results', async t => {
  const f = await fixture(t);await f.complete();
  await f.runtime.settings({ overlay: { adaptive: false } }, f.runtime.snapshot().revision);
  await f.complete('library.storage', null, 'Test failure');assert.equal(f.notice().current, null);assert.equal(f.notice().waiting, 0);
  await f.runtime.settings({ overlay: { adaptive: true } }, f.runtime.snapshot().revision);assert.equal(f.notice().current, null);
  await f.complete();assert.equal(f.notice().current.level, 'success');
});

test('game notices are shorter and rate limited; queued stale successes are dropped', async t => {
  const f = await fixture(t);f.runtime.game = { titleId: 'PPSA00001' };await f.complete();assert.equal(f.notice().current.remainingMs, 3500);
  f.advance(3501);assert.equal(f.notice().current, null);await f.complete();assert.equal(f.notice().waiting, 1);assert.equal(f.notice().current, null);
  f.advance(6000);assert.equal(f.notice().current.remainingMs, 3500);
  f.advance(3501);assert.equal(f.notice().current, null);await f.complete();f.advance(31000);assert.equal(f.notice().current, null);assert.equal(f.notice().waiting, 0);
});

test('dispatch and partial results never claim feature initialization or a fully applied loadout', async t => {
  const f = await fixture(t);await f.complete('plugin.start', { completed: true, phase: 'plugin-dispatched', initialized: false });
  assert.equal(f.notice().current.title, 'Plugin dispatched');assert.match(f.notice().current.detail, /initialization is checked separately/);
  await f.complete('loadout.apply', { completed: true, phase: 'loadout-stopped', message: 'An earlier step remains applied.' });
  assert.equal(f.notice().current.level, 'attention');assert.match(f.notice().current.detail, /earlier step/);
});

test('ordinary memory reads and successful preparation/catalog jobs are quiet; service loss and queue faults are actionable', async t => {
  const f = await fixture(t);for (const kind of ['memory.inspect', 'game.input.prepare', 'fps.ps4.prepare', 'save.refresh']) await f.complete(kind);
  assert.equal(f.notice().current, null);
  f.runtime.graph.register({ id: 'shadowmount', start: async () => ({}), verify: () => true });await f.runtime.graph.start('shadowmount');
  assert.equal(f.notice().current, null);f.runtime.graph.invalidate('shadowmount', new TacError('SERVICE_LOST', 'Service process ended'));
  assert.equal(f.notice().current.reference.type, 'service');assert.match(f.notice().current.detail, /Components/);
  await f.runtime.execute('notice.dismiss', { id: f.notice().current.id });f.advance(11000);
  f.runtime.jobs.halt(new TacError('STORAGE_FAILED', 'Coordinator storage is unavailable'));assert.equal(f.notice().current.title, 'Background work paused');
});

test('notices leave controller menu tokens and selection sequence unchanged and use independent wire fields', async t => {
  const f = await fixture(t), deck = new ConsoleDeck(f.runtime), before = deck.frame();
  await f.complete();const after = deck.frame();assert.equal(after.sequence, before.sequence);assert.deepEqual(after.rows, before.rows);
  const wire = encodeDeck(after);assert.equal(wire.readUInt32LE(8), before.sequence);assert.equal(wire.readUInt32LE(6120), after.notices.sequence);
  assert.equal(wire.readUInt32LE(6124), 5500);assert.equal(wire.readUInt32LE(6128), 1);assert.match(wire.subarray(6136, 6232).toString(), /Save export completed/);
  f.advance(6000);const expired = deck.frame();assert.equal(expired.sequence, before.sequence);assert.equal(encodeDeck(expired).readUInt32LE(6128), 0);
});

test('clock rollback clears old presentation without resurrecting it and recovery startup is identified once', async t => {
  const f = await fixture(t);await f.complete();f.advance(-1);assert.equal(f.notice().current, null);f.advance(20000);assert.equal(f.notice().current, null);
  const saved = await store();await saved.transaction(s => { s.startup.safe = true; });
  const r = await new TacRuntime(saved, { identity: async () => ({ mode: 'development' }), install() {} }, { id: ids() }).start();t.after(() => r.close());
  assert.equal(r.snapshot().notices.current.title, 'Recovery startup');const id = r.snapshot().notices.current.id;
  await r.execute('notice.dismiss', { id });assert.equal(r.snapshot().notices.current, null);
});

test('a new service incident after an unobserved idle gap is not swallowed by an expired notice', async t => {
  const f = await fixture(t);
  for (const id of ['first', 'second']) { f.runtime.graph.register({ id, start: async () => ({}), verify: () => true });await f.runtime.graph.start(id); }
  f.runtime.graph.invalidate('first', new TacError('LOST', 'First service ended'));const first = f.notice().current.id;
  f.advance(20000);f.runtime.graph.invalidate('second', new TacError('LOST', 'Second service ended'));
  const current = f.notice().current;assert.notEqual(current.id, first);assert.equal(current.count, 1);assert.match(current.detail, /Second service ended/);
});
