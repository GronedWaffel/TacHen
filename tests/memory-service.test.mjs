import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installMemory } from '../src/memory-service.mjs';
import { installMcp } from '../src/mcp.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store, ids, until } from './helpers.mjs';
const game = { titleId: 'PPSA04263', version: '01.000.000', pid: 91, generation: '100:0/91/101:0', metadataHash: 'a'.repeat(64) };
export async function fixture(t) {
  const bytes = Buffer.alloc(0x20000), calls = [], receipts = new Map(), probe = { boot: '100:0', kstuff: { injectionReady: true }, processes: [{ pid: 91, generation: game.generation }] };
  let time = Date.now();
  const native = { systemProbe: () => structuredClone(probe), inspectPoll: id => receipts.get(id),
    inspectStart(request, pid, generation, title, metadataHash, module, wire) {
      const packet = Buffer.from(wire), offset = Number(packet.readBigUInt64LE(0)), length = packet.readUInt32LE(8);
      assert.equal(packet.readUInt32LE(12), 0x544d5231);assert.ok(length <= 65536);
      const part = bytes.subarray(offset, offset + length);calls.push({ request, offset, length });
      receipts.set(request, { request, pid, generation, planHash: createHash('sha256').update(packet).digest('hex'),
        stage: 3, resumed: true, restored: true, writes: 0, base: '0x400000', size: '0x20000', bytes: part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) });
    } };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    install(runtime) { installMemory(runtime, native, { delay: () => new Promise(resolve => setTimeout(resolve, 1)) });installMcp(runtime); }
  }, { id: ids(), now: () => time }).start();
  runtime.game = structuredClone(game);t.after(() => runtime.close());
  await runtime.settings({ developer: { enabled: true } }, runtime.store.snapshot().revision);
  const enqueue = input => runtime.jobs.enqueue('memory.inspect', { module: 'eboot.bin', ...input }, runtime.id());
  const settled = async id => { await until(() => ['completed', 'interrupted', 'failed'].includes(runtime.jobs.snapshot().find(j => j.id === id)?.status));return runtime.jobs.snapshot().find(j => j.id === id); };
  return { runtime, native, bytes, calls, receipts, probe, enqueue, settled, tick: value => time += value };
}
test('native memory service binds its read to the game and keeps bytes out of durable state', async t => {
  const f = await fixture(t);f.bytes.set([1, 2, 3], 16);
  const job = await f.enqueue({ mode: 'read', offset: '0x10', length: 3 });assert.equal((await f.settled(job.id)).status, 'completed');
  assert.equal(f.runtime.memory.result(job.id).bytes, '010203');assert.equal(JSON.stringify(f.runtime.store.snapshot()).includes('010203'), false);
  f.tick(300001);assert.throws(() => f.runtime.memory.result(job.id), { code: 'MEMORY_RESULT_EXPIRED' });
});
test('scans find chunk-crossing wildcard matches exactly once with module-relative alignment', async t => {
  const f = await fixture(t);f.bytes.set([0xaa, 1, 0xbb], 65534);f.bytes.set([0xaa, 2, 0xbb], 70000);f.bytes.set([0xaa, 3, 0xbb], 70005);
  const job = await f.enqueue({ mode: 'scan', length: 0x20000, pattern: 'aa??bb', alignment: 2 });assert.equal((await f.settled(job.id)).status, 'completed');
  const result = f.runtime.memory.result(job.id);assert.deepEqual(result.matches, ['0xfffe', '0x11170']);assert.equal(result.atomicSnapshot, false);
  assert.equal(f.calls.length, 2);assert.notEqual(f.calls[0].request, f.calls[1].request);
});
test('dense scans truncate explicitly and never claim the unread remainder was scanned', async t => {
  const f = await fixture(t);const job = await f.enqueue({ mode: 'scan', length: 0x20000, pattern: '00' });
  assert.equal((await f.settled(job.id)).status, 'completed');const result = f.runtime.memory.result(job.id);
  assert.equal(result.matches.length, 8192);assert.equal(result.truncated, true);assert.equal(result.bytesRead, 65536);assert.equal(f.calls.length, 1);
});
test('uncertain resume locks other memory operations; receipt reconciliation never retries', async t => {
  const f = await fixture(t), start = f.native.inspectStart;
  f.native.inspectStart = (...args) => { start(...args);f.receipts.get(args[0]).resumed = false; };
  const job = await f.enqueue({ mode: 'read', length: 4 });assert.equal((await f.settled(job.id)).status, 'interrupted');
  await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });
  const next = await f.enqueue({ mode: 'module' });await new Promise(resolve => setTimeout(resolve, 10));assert.equal(f.calls.length, 1);
  f.probe.processes[0].generation = '';await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });
  f.probe.processes = [];await f.runtime.jobs.cancel(next.id);await f.runtime.jobs.reconcile(job.id);
  assert.equal(f.calls.length, 1);assert.equal(f.runtime.jobs.snapshot().find(j => j.id === job.id).result.phase, 'game-ended');
});
test('revoking MCP while a scan runs stops between native reads and discards results', async t => {
  const f = await fixture(t);f.runtime.mcp.issue();const start = f.native.inspectStart;
  f.native.inspectStart = (...args) => { start(...args);f.runtime.mcp.revoke(); };
  const job = await f.runtime.jobs.enqueue('memory.inspect', { mode: 'scan', module: 'eboot.bin', length: 0x20000, pattern: 'aa',
    developerSession: f.runtime.session, developerGrant: f.runtime.mcp.grant }, f.runtime.id());
  assert.equal((await f.settled(job.id)).status, 'failed');assert.equal(f.calls.length, 1);assert.equal(f.runtime.memory.results.size, 0);
});
test('changed game, invalid ranges and disabled developer mode reject before native access', async t => {
  const f = await fixture(t);
  for (const input of [{ mode: 'read', length: 65537 }, { mode: 'scan', length: 4, pattern: '????' }, { mode: 'read', offset: '0xffffffffffffffff', length: 2 }]) await assert.rejects(f.enqueue(input));
  f.runtime.jobs.pumping = true;const job = await f.enqueue({ mode: 'module' });f.runtime.game.generation = '100:0/91/999:0';f.runtime.jobs.pumping = false;f.runtime.jobs.kick();
  assert.equal((await f.settled(job.id)).status, 'failed');assert.equal(f.calls.length, 0);
  await f.runtime.settings({ developer: { enabled: false } }, f.runtime.store.snapshot().revision);
  await assert.rejects(f.enqueue({ mode: 'module' }), { code: 'DEVELOPER_DISABLED' });
});
test('scan cancellation waits for a confirmed resume and leaves no result or next chunk', async t => {
  const f = await fixture(t), start = f.native.inspectStart;
  let job, cancel;
  f.runtime.jobs.pumping = true;job = await f.enqueue({ mode: 'scan', length: 0x20000, pattern: 'aa' });
  f.native.inspectStart = (...args) => { start(...args);cancel = f.runtime.jobs.cancel(job.id); };
  f.runtime.jobs.pumping = false;f.runtime.jobs.kick();
  await until(() => f.runtime.jobs.snapshot().find(j => j.id === job.id)?.status === 'cancelled');await cancel;
  assert.equal(f.calls.length, 1);assert.equal(f.runtime.memory.results.size, 0);
});

async function scan(f, input) {
  const job = await f.enqueue({ mode: 'scan', length: 0x20000, pattern: 'aa??bb', ...input });
  assert.equal((await f.settled(job.id)).status, 'completed');return job.id;
}
async function refine(f, source, comparison, args = {}) {
  const job = await f.enqueue({ mode: 'refine', source, comparison, ...args });
  assert.equal((await f.settled(job.id)).status, 'completed');return { id: job.id, ...f.runtime.memory.result(job.id) };
}

test('refinement retains observed wildcard bytes, batches candidates and advances its baseline without saving bytes', async t => {
  const f = await fixture(t);f.bytes.set([0xaa, 1, 0xbb], 100);f.bytes.set([0xaa, 2, 0xbb], 200);f.bytes.set([0xaa, 3, 0xbb], 70000);
  const source = await scan(f), count = f.calls.length;f.bytes[101] = 4;f.bytes[70001] = 5;
  const result = await refine(f, source, 'changed');assert.deepEqual(result.matches, ['0x64', '0x11170']);
  assert.equal(result.candidatesChecked, 3);assert.equal(result.atomicSnapshot, false);assert.equal(f.calls.length - count, 2);
  assert.deepEqual(f.calls.slice(count).map(call => [call.offset, call.length]), [[100, 103], [70000, 3]]);
  const second = await refine(f, result.id, 'unchanged');assert.deepEqual(second.matches, result.matches);
  f.bytes[101] = 6;
  const third = await refine(f, second.id, 'equal', { pattern: 'aa06??' });assert.deepEqual(third.matches, ['0x64']);
  const empty = await refine(f, third.id, 'different', { pattern: 'aa06bb' });assert.deepEqual(empty.matches, []);
  const beforeEmpty = f.calls.length;assert.deepEqual((await refine(f, empty.id, 'changed')).matches, []);assert.equal(f.calls.length, beforeEmpty);
  const disk = JSON.stringify(f.runtime.store.snapshot());assert.equal(disk.includes('aa04bb'), false);assert.equal(disk.includes('aa05bb'), false);
  assert.equal(Object.hasOwn(f.runtime.memory.result(source), 'baseline'), false);
});

test('numeric refinement uses explicit width and little-endian values while preserving truncated coverage', async t => {
  const f = await fixture(t);f.bytes.writeInt32LE(-10, 100);f.bytes.writeInt32LE(-10, 200);
  const source = await scan(f, { pattern: 'f6ffffff', alignment: 4 });f.bytes.writeInt32LE(-9, 100);f.bytes.writeInt32LE(-11, 200);
  assert.deepEqual((await refine(f, source, 'increased', { dataType: 'i32' })).matches, ['0x64']);
  assert.deepEqual((await refine(f, source, 'decreased', { dataType: 'i32' })).matches, ['0xc8']);
  const count = f.calls.length;
  await assert.rejects(f.enqueue({ mode: 'refine', source, comparison: 'increased', dataType: 'u64' }), { code: 'SCAN_VALUE_TYPE' });
  await assert.rejects(f.enqueue({ mode: 'refine', source, comparison: 'equal', pattern: 'ffff' }), { code: 'SCAN_PATTERN' });
  assert.equal(f.calls.length, count);
  const dense = await scan(f, { pattern: '00' });assert.equal(f.runtime.memory.result(dense).truncated, true);
  f.bytes[10] = 2;f.bytes[10000] = 2;
  const narrowed = await refine(f, dense, 'changed');assert.deepEqual(narrowed.matches, ['0xa']);assert.equal(narrowed.truncated, true);
});

test('refinement refuses missing, expired or replaced-game baselines and changed module mappings', async t => {
  const f = await fixture(t);f.bytes.set([0xaa, 1, 0xbb], 100);let source = await scan(f);
  await assert.rejects(f.enqueue({ mode: 'refine', source: '0'.repeat(32), comparison: 'changed' }), { code: 'SCAN_SOURCE_EXPIRED' });
  const generation = f.runtime.game.generation;f.runtime.game.generation += 'other';
  await assert.rejects(f.enqueue({ mode: 'refine', source, comparison: 'changed' }), { code: 'GAME_CHANGED' });f.runtime.game.generation = generation;
  f.tick(300001);await assert.rejects(f.enqueue({ mode: 'refine', source, comparison: 'changed' }), { code: 'SCAN_SOURCE_EXPIRED' });
  source = await scan(f);const start = f.native.inspectStart;
  f.native.inspectStart = (...args) => { start(...args);f.receipts.get(args[0]).base = '0x500000'; };
  const job = await f.enqueue({ mode: 'refine', source, comparison: 'changed' });
  const result = await f.settled(job.id);assert.equal(result.status, 'failed');assert.equal(result.error.code, 'MODULE_CHANGED');
  assert.equal(f.runtime.memory.results.has(job.id), false);
});

test('revocation and source expiry stop refinement between resumed reads without delivering partial matches', async t => {
  for (const revoke of [true, false]) {
    const f = await fixture(t);f.runtime.mcp.issue();f.bytes.set([0xaa, 1, 0xbb], 100);f.bytes.set([0xaa, 2, 0xbb], 70000);
    const source = await scan(f), start = f.native.inspectStart, count = f.calls.length;
    f.native.inspectStart = (...args) => { start(...args);if (revoke) f.runtime.mcp.revoke();else f.tick(300001); };
    const job = await f.enqueue({ mode: 'refine', source, comparison: 'unchanged', developerSession: f.runtime.session, developerGrant: f.runtime.mcp.grant });
    const result = await f.settled(job.id);assert.equal(result.status, 'failed');assert.equal(f.calls.length, count + 1);assert.equal(f.runtime.memory.results.has(job.id), false);
  }
});

test('unconfirmed refinement resume retains the game lock and never replays the read', async t => {
  const f = await fixture(t);f.bytes.set([0xaa, 1, 0xbb], 100);const source = await scan(f), start = f.native.inspectStart;
  f.native.inspectStart = (...args) => { start(...args);f.receipts.get(args[0]).resumed = false; };
  const job = await f.enqueue({ mode: 'refine', source, comparison: 'changed' });assert.equal((await f.settled(job.id)).status, 'interrupted');
  const count = f.calls.length;await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });
  assert.equal(f.calls.length, count);assert.equal(f.runtime.memory.results.has(job.id), false);
});

test('refinement cancellation and queued expiry make no additional native read or partial result', async t => {
  const f = await fixture(t);f.bytes.set([0xaa, 1, 0xbb], 100);f.bytes.set([0xaa, 2, 0xbb], 70000);
  const source = await scan(f), start = f.native.inspectStart;f.runtime.jobs.pumping = true;
  const job = await f.enqueue({ mode: 'refine', source, comparison: 'unchanged' });let cancellation;
  f.native.inspectStart = (...args) => { start(...args);cancellation = f.runtime.jobs.cancel(job.id); };
  const before = f.calls.length;f.runtime.jobs.pumping = false;f.runtime.jobs.kick();
  await until(() => f.runtime.jobs.snapshot().find(j => j.id === job.id)?.status === 'cancelled');await cancellation;
  assert.equal(f.calls.length, before + 1);assert.equal(f.runtime.memory.results.has(job.id), false);
  f.native.inspectStart = start;f.runtime.jobs.pumping = true;
  const queued = await f.enqueue({ mode: 'refine', source, comparison: 'changed' });f.tick(300001);
  f.runtime.jobs.pumping = false;f.runtime.jobs.kick();
  assert.equal((await f.settled(queued.id)).status, 'failed');assert.equal(f.calls.length, before + 1);
});
