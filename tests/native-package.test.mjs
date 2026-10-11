import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/native-package-test.exe');
before(async () => {
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const result = spawnSync(zig, ['cc', '-O1', '-Wall', '-Wextra', '-Werror', '-Iplatform/native', '-Iplatform/loader',
    'tests/native-package-runner.c', 'platform/native/package-core.c', 'platform/loader/sha256.c', '-o', exe],
  { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const failure = spawnSync(exe, ['--fail-check'], { encoding: 'utf8' }); assert.equal(failure.status, 90); assert.match(failure.stderr, /CHECK failed/);
});
function run(args) { const result = spawnSync(exe, args, { encoding: 'utf8' }); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout; }
async function inspect(t, bytes, virtual = false) {
  const dir = await fs.mkdtemp(path.join(root, 'build/package-native-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); const file = path.join(dir, 'test.pkg'); await fs.writeFile(file, bytes);
  return JSON.parse(run([file, ...(virtual ? ['virtual'] : [])]));
}
test('native installer tracker refuses stale playable states and partial downloads', () => { assert.match(run(['--track']), /passed/); });
test('historical and current installer progress share counters without interpreting an unknown error tail', () => { assert.match(run(['--prefix']), /passed/); });
test('native installer request bounds and content identity are checked before native effects', () => { assert.match(run(['--requests']), /passed/); });
test('native package parser accepts full PS4 CNT and rejects changed byte counts or system identities', async t => {
  const bytes = Buffer.alloc(8192); bytes.writeUInt32BE(0x7f434e54); bytes.write('UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP', 0x40);
  bytes.writeUInt32BE(0x1a, 0x74); bytes.writeBigUInt64BE(8192n, 0x430);
  const first=await inspect(t,bytes);assert.equal(first.accepted,true);
  assert.equal(first.headerSha256,createHash('sha256').update(bytes.subarray(0,0x438)).digest('hex'));
  bytes.writeBigUInt64BE(9000n, 0x430);
  assert.equal((await inspect(t, bytes)).accepted, false); bytes.writeBigUInt64BE(8192n, 0x430); bytes.write('NPXS', 0x47);
  assert.equal((await inspect(t, bytes)).accepted, false);
});
test('native package parser reads PS5 64-bit image offsets and rejects overflowing ranges', async t => {
  const bytes = Buffer.alloc(0x438 * 2), outer = bytes.subarray(0, 0x438), inner = bytes.subarray(0x438), base = 5n * 1024n ** 3n;
  outer.writeUInt32BE(0x7f464948); outer.writeUInt16LE(3, 6); outer.writeBigUInt64LE(0x100n, 0x10);
  outer.writeBigUInt64LE(0x1000n, 0x18); outer.writeBigUInt64LE(base, 0x58);
  inner.writeUInt32BE(0x7f434e54); inner.write('UP0001-PPSA00001_00-ABCDEFGHIJKLMNOP', 0x40); inner.writeUInt32BE(0x20, 0x74);
  inner.writeUInt32BE(2, 0x10); inner.writeUInt32BE(0x100, 0x18); inner.writeBigUInt64BE(0x1000n, 0x20); inner.writeBigUInt64BE(0x2000n, 0x28);
  const checked=await inspect(t,bytes,true);assert.equal(checked.accepted,true);
  assert.equal(checked.headerSha256,createHash('sha256').update(bytes).digest('hex'));
  inner.writeBigUInt64BE(0xfffffffffffffff0n, 0x28); assert.equal((await inspect(t, bytes, true)).accepted, false);
  inner.writeBigUInt64BE(0x2000n, 0x28); outer.writeBigUInt64LE(0xfffffffffffffff0n, 0x18); assert.equal((await inspect(t, bytes, true)).accepted, false);
});
