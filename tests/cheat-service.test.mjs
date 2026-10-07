import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { installCheats } from '../src/cheat-service.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { ConsoleDeck } from '../src/deck.mjs';
import { serve } from '../src/server.mjs';
import { store, memoryStorage, ids, until } from './helpers.mjs';
const game = { titleId: 'PPSA04263', version: '01.000.000', pid: 91, generation: '100:0/91/101:0', metadataHash: 'a'.repeat(64) };
const doc = () => JSON.stringify({ name: 'Test game', process: 'eboot.bin', credits: ['Fixture author'],
  mods: [{ name: 'Test option', memory: [{ offset: '10', on: '9090', off: '0102' }] }] });
async function fixture(t) {
  const files = memoryStorage(), calls = [], receipts = new Map(), probe = { boot: '100:0', kstuff: { injectionReady: true }, processes: [{ pid: 91, generation: game.generation }] };
  const native = { systemProbe: () => structuredClone(probe), cheatPoll: id => receipts.get(id),
    cheatStart(request, pid, generation, title, metadataHash, module, packet) {
      calls.push({ request, pid, generation, title, metadataHash, module, packet });
      receipts.set(request, { request, pid, generation, planHash: createHash('sha256').update(Buffer.from(packet)).digest('hex'),
        stage: 3, resumed: true, restored: false, writes: 1, message: 'Applied fixture', busy: false });
    } };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    install(runtime) { installCheats(runtime, native, files, { delay: () => new Promise(resolve => setTimeout(resolve, 1)) }); }
  }, { id: ids() }).start();
  runtime.game = structuredClone(game);t.after(() => runtime.close());
  const entry = await runtime.cheats.packs.import({ source: doc(), ...game });
  const input = enabled => ({ sha256: entry.sha256, cheatId: '0', enabled });
  const enqueue = enabled => runtime.jobs.enqueue('cheat.set', input(enabled), runtime.id());
  const settled = async id => { await until(() => ['completed', 'interrupted', 'failed'].includes(runtime.jobs.snapshot().find(j => j.id === id)?.status)); return runtime.jobs.snapshot().find(j => j.id === id); };
  return { runtime, native, files, calls, receipts, probe, entry, input, enqueue, settled };
}
test('cheat packs retain credits and exact target; imports deduplicate without native execution', async t => {
  const f = await fixture(t);
  const again = await f.runtime.cheats.packs.import({ source: doc(), ...game });assert.deepEqual(again, f.entry);
  assert.equal(f.runtime.snapshot().cheats.length, 1);assert.equal(f.calls.length, 0);
  const detail = await f.runtime.cheats.inspect(f.entry.sha256);assert.deepEqual(detail.credits, ['Fixture author']);assert.equal(detail.matches, true);
  f.files.files.set(f.entry.sha256 + '.json', '{}');await assert.rejects(f.enqueue(true), { code: 'CHEAT_STORAGE' });assert.equal(f.calls.length, 0);
});
test('native patch packet and receipt bind both directions to exact game; duplicate request dispatches once', async t => {
  const f = await fixture(t), key = f.runtime.id(), job = await f.runtime.jobs.enqueue('cheat.set', f.input(true), key);
  assert.equal((await f.settled(job.id)).status, 'completed');
  await f.runtime.jobs.enqueue('cheat.set', f.input(true), key);assert.equal(f.calls.length, 1);
  const on = Buffer.from(f.calls[0].packet);assert.equal(on.readUInt32LE(0), 0x54435031);assert.equal(on.readUInt32LE(12), on.length);
  assert.equal(on.readBigUInt64LE(16), 16n);assert.equal(on.subarray(32).toString('hex'), '01029090');
  assert.equal((await f.runtime.cheats.inspect(f.entry.sha256)).cheats[0].lastApplied, true);
  const off = await f.enqueue(false);assert.equal((await f.settled(off.id)).status, 'completed');
  assert.equal(Buffer.from(f.calls[1].packet).subarray(32).toString('hex'), '90900102');
});
test('history undo dispatches the inverse native packet once across simultaneous devices', async t => {
  const f = await fixture(t), source = await f.enqueue(true);await f.settled(source.id);
  const plan = f.runtime.changes.preview(source);assert.equal(plan.available, true);
  const results = await Promise.all([f.runtime.changes.undo(plan), f.runtime.changes.undo(plan)]);
  assert.equal(results[0].jobId, results[1].jobId);assert.equal((await f.settled(results[0].jobId)).status, 'completed');
  assert.equal(f.calls.length, 2);assert.equal(Buffer.from(f.calls[1].packet).subarray(32).toString('hex'), '90900102');
  assert.equal((await f.runtime.changes.undo(plan)).jobId, results[0].jobId);assert.equal(f.calls.length, 2);
  assert.equal(f.runtime.changes.preview(source).available, false);
});

test('native undo follows reverse order, rejects a replaced game and holds an unconfirmed reversal', async t => {
  const f = await fixture(t), first = await f.enqueue(true);await f.settled(first.id);
  const second = await f.enqueue(false);await f.settled(second.id);
  assert.equal(f.runtime.changes.preview(first).available, false);
  const undone = await f.runtime.changes.undo(f.runtime.changes.preview(second));await f.settled(undone.jobId);
  assert.equal(f.runtime.changes.preview(first).available, true);
  const originalGame = { ...f.runtime.game };f.runtime.game.generation += '-replacement';
  assert.equal(f.runtime.changes.preview(first).available, false);f.runtime.game = originalGame;
  const start = f.native.cheatStart;
  f.native.cheatStart = (...args) => { start(...args);f.receipts.get(args[0]).resumed = false; };
  const held = await f.runtime.changes.undo(f.runtime.changes.preview(first));assert.equal((await f.settled(held.jobId)).status, 'interrupted');
  const count = f.calls.length;assert.equal((await f.runtime.changes.undo(f.runtime.changes.preview(first))).jobId, held.jobId);assert.equal(f.calls.length, count);
});

test('queued reversal detects newer conflicting work at dispatch and never writes', async t => {
  const f = await fixture(t), source = await f.enqueue(true);await f.settled(source.id);
  f.runtime.jobs.concurrency = 0;
  const undone = await f.runtime.changes.undo(f.runtime.changes.preview(source));
  const later = await f.enqueue(false);f.runtime.jobs.concurrency = 2;f.runtime.jobs.kick();
  const result = await f.settled(undone.jobId);assert.equal(result.status, 'failed');assert.equal(result.error.code, 'HISTORY_CONFLICT');
  await f.settled(later.id);assert.equal(f.calls.length, 2);assert.equal(f.calls[1].request, later.id);
});

test('a forged undo reference cannot redirect a native operation', async t => {
  const f = await fixture(t), source = await f.enqueue(true);await f.settled(source.id);
  const plan = f.runtime.changes.preview(source), undoOf = { id: source.id, proof: plan.proof };
  await assert.rejects(f.runtime.jobs.enqueue('cheat.set', { ...f.input(true), undoOf }, f.runtime.id()), { code: 'HISTORY_TARGET' });
  await assert.rejects(f.runtime.jobs.enqueue('cheat.set', { ...f.input(false), undoOf: { ...undoOf, proof: '0'.repeat(64) } }, f.runtime.id()), { code: 'HISTORY_CHANGED' });
  assert.equal(f.calls.length, 1);
});

test('wrong versions, safe startup and changed queued generation cannot reach native writes', async t => {
  const f = await fixture(t);f.runtime.game.version = '01.001.000';await assert.rejects(f.enqueue(true), { code: 'CHEAT_MISMATCH' });
  f.runtime.game = { ...game };f.runtime.graph.safe = true;await assert.rejects(f.enqueue(true), { code: 'SAFE_STARTUP' });
  f.runtime.graph.safe = false;f.runtime.jobs.pumping = true;const job = await f.enqueue(true);
  f.runtime.game.generation = '100:0/91/999:0';f.runtime.jobs.pumping = false;f.runtime.jobs.kick();
  assert.equal((await f.settled(job.id)).status, 'failed');assert.equal(f.calls.length, 0);
});
test('mismatched results and unconfirmed resume retain the operation and its exclusion', async t => {
  for (const mutation of [r => r.generation = '100:0/91/999:0', r => r.planHash = 'b'.repeat(64), r => r.resumed = false]) {
    const f = await fixture(t), start = f.native.cheatStart;
    f.native.cheatStart = (...args) => { start(...args);mutation(f.receipts.get(args[0])); };
    const job = await f.enqueue(true);assert.equal((await f.settled(job.id)).status, 'interrupted');
    const second = await f.enqueue(false);await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.runtime.jobs.snapshot().find(j => j.id === second.id).status, 'queued');assert.equal(f.calls.length, 1);
  }
});
test('verified rollback is a clean failure; unknown rollback cannot be retried in the same instance', async t => {
  const f = await fixture(t), start = f.native.cheatStart;
  f.native.cheatStart = (...args) => { start(...args);Object.assign(f.receipts.get(args[0]), { stage: 4, restored: true, resumed: true, writes: 2, message: 'Original bytes restored' }); };
  const rolled = await f.enqueue(true);assert.equal((await f.settled(rolled.id)).status, 'failed');
  f.native.cheatStart = (...args) => { start(...args);Object.assign(f.receipts.get(args[0]), { stage: 5, restored: false }); };
  const unknown = await f.enqueue(true);assert.equal((await f.settled(unknown.id)).status, 'interrupted');
  await assert.rejects(f.runtime.jobs.reconcile(unknown.id), { code: 'OUTCOME_UNKNOWN' });
  f.probe.processes[0].generation = '';await assert.rejects(f.runtime.jobs.reconcile(unknown.id), { code: 'OUTCOME_UNKNOWN' });
  f.probe.processes = [];await f.runtime.cheats.reconcileEnded();
  const ended = f.runtime.jobs.snapshot().find(j => j.id === unknown.id);assert.equal(ended.status, 'completed');assert.equal(ended.result.phase, 'game-ended');
});
test('controller cheats use the same job and Circle returns to its pack list', async t => {
  const f = await fixture(t), deck = new ConsoleDeck(f.runtime);
  const action = (kind, row = 0) => deck.action({ kind, row, request: f.runtime.id(), sequence: deck.frame().sequence });
  await action('previous');assert.equal(deck.frame().page, 5);assert.equal(deck.frame().rows[0].label, 'Test game');
  await action('select');assert.equal(deck.frame().rows[1].label, 'Test option');
  await action('select', 1);const job = f.runtime.jobs.snapshot().at(-1);assert.equal((await f.settled(job.id)).status, 'completed');
  assert.equal(deck.frame().rows[1].on, true);await action('back');assert.equal(deck.frame().page, 5);assert.equal(deck.frame().rows[0].label, 'Test game');
});
test('phone imports require same-origin session and write token, and never apply a cheat', async t => {
  const f = await fixture(t), server = await serve(f.runtime, { uiRoot: path.resolve('ui'), host: '127.0.0.1', port: 0, id: f.runtime.id });
  t.after(async () => { server.closeAllConnections();await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`, sessionResponse = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin } });
  const session = await sessionResponse.json(), cookie = sessionResponse.headers.get('set-cookie').split(';')[0];
  const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body = JSON.stringify({ source: doc(), titleId: game.titleId, version: game.version });
  assert.equal((await fetch(origin + '/api/cheats/import', { method: 'POST', headers, body })).status, 403);
  const response = await fetch(origin + '/api/cheats/import', { method: 'POST', headers: { ...headers, 'X-TacHen-CSRF': session.csrf }, body });
  assert.equal(response.status, 200);assert.equal((await response.json()).result.sha256, f.entry.sha256);assert.equal(f.calls.length, 0);
});
