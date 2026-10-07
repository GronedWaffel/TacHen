import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { inspectPackage, MAX_PACKAGE } from '../src/package-format.mjs';
import { PackageInbox, installPackageInbox } from '../src/package-inbox.mjs';
import { PayloadInbox } from '../src/inbox.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { ids, store, until } from './helpers.mjs';
export function ps4Package(size = 8192) {
  const bytes = Buffer.alloc(size); bytes.writeUInt32BE(0x7f434e54); bytes.write('UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP', 0x40);
  bytes.writeUInt32BE(0x1a, 0x74); bytes.writeBigUInt64BE(BigInt(size), 0x430); return bytes;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-packages-'));
  t.after(async () => { assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return { root, inbox: await new PackageInbox(root, { id: ids() }).init() };
}
test('PS4 package identity, exact file size and homebrew prefixes are parsed without treating ELF as PKG', async () => {
  const bytes = ps4Package(), read = async (at, count) => bytes.subarray(at, at + count);
  const info = await inspectPackage(read, bytes.length); assert.equal(info.platform, 'ps4'); assert.equal(info.titleId, 'CUSA00001');
  bytes.write('SFIN00001', 0x47); assert.equal((await inspectPackage(read, bytes.length)).titleId, 'SFIN00001');
  bytes.writeUInt32BE(0x7f454c46); await assert.rejects(inspectPackage(read, bytes.length), { code: 'PACKAGE_MAGIC' });
});
test('PS5 finalized-image headers support offsets above 4 GiB with only bounded reads', async () => {
  const base = 5n * 1024n ** 3n, size = Number(base + 0x8000n), outer = Buffer.alloc(0x438), inner = Buffer.alloc(0x438), reads = [];
  outer.writeUInt32BE(0x7f464948); outer.writeUInt16LE(3, 6); outer.writeBigUInt64LE(0x100n, 0x10);
  outer.writeBigUInt64LE(0x1000n, 0x18); outer.writeBigUInt64LE(base, 0x58);
  inner.writeUInt32BE(0x7f434e54); inner.write('UP0001-PPSA00001_00-ABCDEFGHIJKLMNOP', 0x40); inner.writeUInt32BE(0x20, 0x74);
  inner.writeUInt32BE(2, 0x10); inner.writeUInt32BE(0x100, 0x18); inner.writeBigUInt64BE(0x1000n, 0x20); inner.writeBigUInt64BE(0x2000n, 0x28);
  const read = async (at, length) => { reads.push({ at, length }); return at === 0 ? outer : at === Number(base) ? inner : Buffer.alloc(0); };
  const info = await inspectPackage(read, size); assert.equal(info.platform, 'ps5'); assert.equal(info.signing, 'debug');
  assert.deepEqual(reads, [{ at: 0, length: 0x438 }, { at: Number(base), length: 0x438 }]);
  inner.writeBigUInt64BE(0x10000n, 0x28); await assert.rejects(inspectPackage(read, size), { code: 'PACKAGE_BOUNDS' });
});
test('truncated and non-ASCII identities cannot pass package validation', async () => {
  const bytes = ps4Package();
  await assert.rejects(inspectPackage(async () => bytes.subarray(0, 100), bytes.length), { code: 'PACKAGE_TRUNCATED' });
  await assert.rejects(inspectPackage(async () => bytes.subarray(0, 0x438), bytes.length + 1), { code: 'PACKAGE_INCOMPLETE' });
  bytes[0x40] |= 128; await assert.rejects(inspectPackage(async () => bytes.subarray(0, 0x438), bytes.length), { code: 'PACKAGE_CONTENT' });
});
test('package staging resumes after reopening and streams an independently verified hash', async t => {
  const { inbox, root } = await fixture(t), bytes = ps4Package(2 * 1024 * 1024), expected = createHash('sha256').update(bytes).digest('hex');
  const entry = await inbox.begin({ name: 'test.pkg', bytes: bytes.length, sha256: expected });
  await inbox.append(entry.id, 0, bytes.subarray(0, 1024 * 1024));
  const reopened = await new PackageInbox(root, { id: ids() }).init();
  assert.equal((await reopened.status(entry.id)).offset, 1024 * 1024);
  await assert.rejects(reopened.append(entry.id, 0, bytes.subarray(0, 1024)), { code: 'UPLOAD_OFFSET' });
  await reopened.append(entry.id, 1024 * 1024, bytes.subarray(1024 * 1024));
  const result = await reopened.verify(entry.id); assert.equal(result.sha256, expected);
  assert.equal((await reopened.describe(entry.id)).package.titleId, 'CUSA00001');
  await assert.rejects(inbox.begin({ name: 'payload.elf', bytes: 8192 }), { code: 'PAYLOAD_NAME' });
});
test('cancelled large verification preserves the uploaded file without promoting it', async t => {
  const { inbox } = await fixture(t), bytes = ps4Package(3 * 1024 * 1024), abort = new AbortController();
  const entry = await inbox.begin({ name: 'cancel.pkg', bytes: bytes.length });
  for (let at = 0; at < bytes.length; at += 1024 * 1024) await inbox.append(entry.id, at, bytes.subarray(at, at + 1024 * 1024));
  await assert.rejects(inbox.verify(entry.id, { signal: abort.signal, progress: async () => abort.abort() }), { code: 'UPLOAD_CANCELLED' });
  assert.equal((await inbox.status(entry.id)).status, 'uploading');
  assert.equal((await inbox.status(entry.id)).offset, bytes.length);
});
test('expected checksum mismatch and malformed headers never promote a staged package', async t => {
  const { inbox } = await fixture(t), bytes = ps4Package();
  const entry = await inbox.begin({ name: 'bad.pkg', bytes: bytes.length, sha256: '0'.repeat(64) }); await inbox.append(entry.id, 0, bytes);
  await assert.rejects(inbox.verify(entry.id), { code: 'PAYLOAD_HASH_MISMATCH' }); assert.equal((await inbox.status(entry.id)).status, 'uploading');
});
test('package and payload uploads share capacity reservations without allocating large test files', async t => {
  const { inbox, root } = await fixture(t), capacity = await fs.statfs(root);
  const free = Number(capacity.bsize) * Number(capacity.bavail), reservation = free - 16 * 1024 * 1024 - 4 * 1024 * 1024;
  if (reservation < 8192 || reservation > MAX_PACKAGE) { t.skip('Host capacity outside test range'); return; }
  const payloads = await new PayloadInbox(path.join(root, 'payloads'), { id: ids(), reservationGroup: inbox.reservations }).init();
  await inbox.begin({ name: 'large.pkg', bytes: reservation });
  await assert.rejects(payloads.begin({ name: 'more.elf', bytes: 16 * 1024 * 1024 }), { code: 'NO_SPACE' });
  assert.equal((await inbox.list())[0].offset, 0);
});
test('verification runs as a durable background job and does not claim package installation', async t => {
  const { root } = await fixture(t), id = ids();
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development' }),
    install: r => installPackageInbox(r, root) }, { id }).start();
  const bytes = ps4Package(), entry = await runtime.execute('package.begin', { name: 'background.pkg', bytes: bytes.length });
  await runtime.packageInbox.append(entry.id, 0, bytes);
  await runtime.jobs.enqueue('package.verify', { id: entry.id }, 'verify-once');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed');
  assert.equal(runtime.snapshot().packages[0].status, 'verified');
  assert.equal(runtime.capabilities.get('packages').available, false);
  assert.match(runtime.jobs.snapshot()[0].result.message, /Installation has not started/);
});
