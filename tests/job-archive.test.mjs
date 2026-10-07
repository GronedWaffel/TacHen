import test from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../src/jobs.mjs';
import { StateStore } from '../src/store.mjs';
import { canonical } from '../src/errors.mjs';
import { DeveloperMcp } from '../src/mcp.mjs';
import { store, ids, checksum, deferred, until } from './helpers.mjs';

const record = (n, extra = {}) => ({ id: n.toString(16).padStart(32, '0'), key: `request-${n}`, kind: 'memory.inspect',
  args: { offset: n }, signature: canonical({ kind: 'memory.inspect', args: { offset: n } }),
  requestSignature: canonical({ kind: 'memory.inspect', input: { offset: n } }), status: 'completed',
  resources: ['memory'], result: { completed: true, receipt: n }, error: null, createdAt: n, updatedAt: n, ...extra });
async function setup(count = 768) {
  const state = await store();
  await state.transaction(s => { s.jobs = Array.from({ length: count }, (_, i) => record(i + 1)); });
  const queue = new JobQueue(state, { id: () => 'f'.repeat(32) });queue.pumping = true;
  let validates = 0;
  queue.register('memory.inspect', { validate: value => { validates++;return value; }, resources: () => ['memory'], run() { throw Error('No dispatch in archive tests'); } });
  return { state, queue, validates: () => validates };
}
const count = state => Object.values(state.snapshot().jobArchive || {}).reduce((n, ref) => n + ref.count, 0);
const enqueue = queue => queue.enqueue('memory.inspect', { offset: 9000 }, 'new-request');

test('old terminal jobs archive before acceptance; original retries survive restart without validation or dispatch', async () => {
  const { state, queue, validates } = await setup();
  await enqueue(queue);assert.equal(count(state), 64);assert.equal(queue.snapshot().length, 705);
  const original = await queue.enqueue('memory.inspect', { offset: 1 }, 'request-1');
  assert.equal(original.id, record(1).id);assert.equal(original.archived, true);assert.equal(validates(), 1);
  await assert.rejects(queue.enqueue('memory.inspect', { offset: 2 }, 'request-1'), { code: 'JOB_KEY_REUSED' });
  const reopened = await new StateStore(state.storage, checksum).open();
  const next = new JobQueue(reopened, { id: ids() });next.pumping = true;
  next.register('memory.inspect', { validate() { throw Error('Must not revalidate'); }, run() { throw Error('Must not replay'); } });
  assert.equal((await next.enqueue('memory.inspect', { offset: 1 }, 'request-1')).id, original.id);
  assert.equal((await next.get(original.id)).result.receipt, 1);
  const mcp = new DeveloperMcp({ jobs: next });
  const status = await mcp.call('operation_status', { id: original.id });
  assert.equal(status.archived, true);assert.equal(status.result.receipt, 1);
  for (const field of ['key', 'signature', 'requestSignature', 'args', 'checkpoint']) assert.ok(!Object.hasOwn(status, field));
});

test('archive preserves unresolved work, busy terminal transitions, native guards, recent history and referenced receipts', async () => {
  const { state, queue } = await setup();
  await state.transaction(s => {
    for (let i = 0; i < 8; i++) s.jobs[i].status = ['interrupted', 'running', 'uncertain', 'queued', 'held', 'cancelling', 'completed', 'completed'][i];
    s.jobs[8].kind = 'plugin.start';s.jobs[9].kind = 'game.module.start';s.jobs[10].kind = 'cheat.set';s.jobs[11].kind = 'library.mount';
    s.jobs[12].kind = 'package.verify';s.jobs[12].args = { id: 'pkg-a' };
    s.jobs[13].kind = 'package.verify';s.jobs[13].args = { id: 'pkg-a' };
    s.jobs[14].kind = 'future.native.operation';
    s.jobs[760].result = { steps: [{ id: record(16).id }] };s.jobs[760].checkpoint = { childKey: 'request-17' };
  });
  queue.running.set(record(7).id, {});queue.reconciling.set(record(8).id, {});
  await enqueue(queue);
  const remaining = new Set(queue.snapshot().map(j => j.id));
  for (const n of [1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,768]) assert.ok(remaining.has(record(n).id), String(n));
  assert.ok(!remaining.has(record(13).id));assert.equal(count(state), 64);
});

test('missing or damaged referenced archive blocks new and repeated requests instead of allowing replay', async () => {
  const { state, queue } = await setup();await enqueue(queue);
  const bucket = queue.archive.bucket('request-1'), ref = state.snapshot().jobArchive[bucket], name = `jobs-${bucket}-${ref.slot}.json`;
  const original = state.storage.files.get(name);state.storage.files.delete(name);
  await assert.rejects(queue.enqueue('memory.inspect', { offset: 1 }, 'request-1'), { code: 'JOB_ARCHIVE_DAMAGED' });
  let key;for (let i = 0; !key; i++) if (queue.archive.bucket(`different-${i}`) === bucket) key = `different-${i}`;
  await assert.rejects(queue.enqueue('memory.inspect', {}, key), { code: 'JOB_ARCHIVE_DAMAGED' });
  state.storage.files.set(name, original + ' ');
  await assert.rejects(queue.get(record(1).id), { code: 'JOB_ARCHIVE_DAMAGED' });
  state.storage.files.set(name, original);assert.equal((await queue.get(record(1).id)).archived, true);
});

test('failed main commit leaves both durable snapshots usable across retry', async () => {
  const { state, queue } = await setup();await enqueue(queue);
  await state.transaction(s => { s.jobs.push(...Array.from({ length: 64 }, (_, i) => record(1001 + i))); });
  const before = state.snapshot(), prior = state.previousState;
  const write = state.storage.replace.bind(state.storage);let failed = false;
  state.storage.replace = async (name, value) => {
    if (name.startsWith('state-') && !failed) { failed = true;throw Error('main write failed'); }
    await write(name, value);
  };
  await assert.rejects(queue.enqueue('memory.inspect', {}, 'next-request'), /main write failed/);
  assert.deepEqual(state.snapshot(), before);
  for (const snapshot of [before, prior]) for (const bucket of Object.keys(snapshot.jobArchive)) await queue.archive.read(snapshot, bucket);
  state.storage.replace = write;
  await queue.enqueue('memory.inspect', {}, 'next-request');assert.equal(count(state), 128);
  const current = state.snapshot();state.storage.files.set(`state-${current.revision % 2}.json`, 'torn');
  const fallback = await new StateStore(state.storage, checksum).open();assert.equal(fallback.recovered, true);
  assert.equal(fallback.snapshot().revision, before.revision);
  for (const bucket of Object.keys(before.jobArchive)) await queue.archive.read(fallback.snapshot(), bucket);
});

test('a torn archive write never publishes pruning and a retry preserves old receipts', async () => {
  const { state, queue } = await setup();await enqueue(queue);
  await state.transaction(s => { s.jobs.push(...Array.from({ length: 64 }, (_, i) => record(1001 + i))); });
  const before = state.snapshot(), write = state.storage.replace.bind(state.storage);
  state.storage.replace = async (name, value) => {
    if (name.startsWith('jobs-')) { state.storage.files.set(name, value.slice(0, 20));throw Error('archive write failed'); }
    return write(name, value);
  };
  await assert.rejects(queue.enqueue('memory.inspect', {}, 'after-torn-write'), /archive write failed/);
  assert.deepEqual(state.snapshot(), before);
  for (const snapshot of [before, state.previousState]) for (const bucket of Object.keys(snapshot.jobArchive)) await queue.archive.read(snapshot, bucket);
  state.storage.replace = write;await queue.enqueue('memory.inspect', {}, 'after-torn-write');
  assert.equal(count(state), 128);assert.equal((await queue.get(record(1).id)).result.receipt, 1);
});

test('three archive slots cycle without overwriting either state recovery root', async () => {
  const { state, queue } = await setup();await enqueue(queue);
  for (let turn = 0; turn < 5; turn++) {
    await state.transaction(s => { s.jobs.push(...Array.from({ length: 64 }, (_, i) => record(2001 + turn * 64 + i))); });
    await queue.enqueue('memory.inspect', { turn }, `turn-request-${turn}`);
    for (const snapshot of [state.snapshot(), state.previousState]) for (const bucket of Object.keys(snapshot.jobArchive)) await queue.archive.read(snapshot, bucket);
  }
  assert.ok([...state.storage.files.keys()].filter(name => name.startsWith('jobs-')).length <= 192);
});

test('serialized archive lookup cannot race a slot reuse and concurrent submissions retain one intent', async () => {
  const { state, queue } = await setup();await enqueue(queue);
  const gate = deferred(), read = state.storage.read.bind(state.storage);let waiting = false;
  state.storage.read = async name => { if (name.startsWith('jobs-') && !waiting) { waiting = true;await gate.promise; }return read(name); };
  const first = queue.enqueue('memory.inspect', { offset: 1 }, 'request-1');await until(() => waiting);
  const second = queue.enqueue('memory.inspect', { offset: 1 }, 'request-1');gate.resolve();
  const results = await Promise.all([first, second]);assert.equal(results[0].id, results[1].id);assert.equal(count(state), 64);
});

test('capacity full of protected operations refuses acceptance without discarding guards', async () => {
  const { state, queue } = await setup(1024);
  await state.transaction(s => { for (const job of s.jobs) job.kind = 'plugin.start'; });
  await assert.rejects(enqueue(queue), { code: 'QUEUE_FULL' });assert.equal(count(state), 0);assert.equal(queue.snapshot().length, 1024);
});
