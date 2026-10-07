import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/native-image-test.exe');
before(async () => {
  await fs.mkdir(path.join(root, 'build'), { recursive: true });
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const result = spawnSync(zig, ['cc', '-O1', '-Wall', '-Wextra', '-Werror', '-Iplatform/native', '-Iplatform/loader',
    'tests/native-image-runner.c', 'platform/native/elf-image.c', 'platform/loader/sha256.c', '-o', exe],
  { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
function fixture({ lowest = 0n, dynamic = false } = {}) {
  const b = Buffer.alloc(0x600); Buffer.from([127, 69, 76, 70, 2, 1, 1]).copy(b);
  b.writeUInt16LE(3, 16); b.writeUInt16LE(62, 18); b.writeUInt32LE(1, 20);
  b.writeBigUInt64LE(lowest + 0x180n, 24); b.writeBigUInt64LE(64n, 32);
  b.writeUInt16LE(64, 52); b.writeUInt16LE(56, 54); b.writeUInt16LE(dynamic ? 2 : 1, 56);
  b.writeUInt32LE(1, 64); b.writeUInt32LE(7, 68); b.writeBigUInt64LE(lowest, 80);
  b.writeBigUInt64LE(BigInt(b.length), 96); b.writeBigUInt64LE(0x4000n, 104); b.writeBigUInt64LE(1n, 112);
  b.writeBigUInt64LE(lowest + 0x280n, 0x300); b.writeBigUInt64LE(8n, 0x308); b.writeBigInt64LE(lowest + 0x180n, 0x310);
  if (dynamic) {
    b.writeUInt32LE(2, 120); b.writeBigUInt64LE(0x200n, 128); b.writeBigUInt64LE(lowest + 0x200n, 136);
    b.writeBigUInt64LE(64n, 152); b.writeBigUInt64LE(64n, 160);
    for (const [index, tag, value] of [[0, 7, lowest + 0x300n], [1, 8, 24n], [2, 9, 24n]]) {
      b.writeBigInt64LE(BigInt(tag), 0x200 + index * 16); b.writeBigUInt64LE(value, 0x208 + index * 16);
    }
  } else {
    b.writeBigUInt64LE(0x400n, 40); b.writeUInt16LE(64, 58); b.writeUInt16LE(2, 60);
    b.writeUInt32LE(4, 0x444); b.writeBigUInt64LE(2n, 0x448); b.writeBigUInt64LE(0x300n, 0x458);
    b.writeBigUInt64LE(24n, 0x460); b.writeBigUInt64LE(24n, 0x478);
  }
  return b;
}
async function inspect(t, data, name = 'image') {
  const dir = await fs.mkdtemp(path.join(root, 'build/native-case-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, name + '.elf'); await fs.writeFile(file, data);
  const result = spawnSync(exe, [file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout);
}
test('native SHA-256 agrees with the published abc vector', () => {
  const result = spawnSync(exe, ['--hash-test'], { encoding: 'utf8' }); assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('native loader correctly maps nonzero virtual origins and zero-filled tails', async t => {
  const data = fixture({ lowest: 0x8000n }), result = await inspect(t, data);
  assert.equal(result.accepted, true, result.reason); assert.equal(result.lowest, 0x8000); assert.equal(result.bytes, 0x4000);
  const expected = Buffer.alloc(0x4000); data.copy(expected); expected.writeBigUInt64LE(0x408180n, 0x280);
  assert.equal(result.sha256, createHash('sha256').update(expected).digest('hex'));
});
test('stripped ELF uses PT_DYNAMIC relative relocations without section headers', async t => {
  const data = fixture({ dynamic: true }), result = await inspect(t, data);
  assert.equal(result.accepted, true, result.reason);
  const expected = Buffer.alloc(0x4000); data.copy(expected); expected.writeBigUInt64LE(0x400180n, 0x280);
  assert.equal(result.sha256, createHash('sha256').update(expected).digest('hex'));
});
test('native validator rejects truncated tables, sparse allocations, external relocations and writes into holes', async t => {
  const mutations = [
    b => b.writeBigUInt64LE(0xfffffffffffffff0n, 32),
    b => b.writeUInt16LE(8193, 60),
    b => b.writeBigUInt64LE(0x80000000n, 104),
    b => b.writeBigUInt64LE(0x4000n, 0x300),
    b => b.writeBigUInt64LE(0x100000008n, 0x308),
    b => b.writeBigUInt64LE(7n, 0x308),
    b => b.writeBigUInt64LE(0xfffffffffffffff0n, 0x458)
  ];
  for (const change of mutations) { const data = fixture(); change(data); assert.equal((await inspect(t, data)).accepted, false); }
});
test('native validator rejects incomplete dynamic tables and unmapped relocation arrays', async t => {
  for (const change of [b => b.writeBigUInt64LE(0x8000n, 0x208), b => b.writeBigUInt64LE(25n, 0x218),
    b => b.writeBigInt64LE(1n, 0x200), b => b.writeBigInt64LE(7n, 0x230)]) {
    const data = fixture({ dynamic: true }); change(data); assert.equal((await inspect(t, data)).accepted, false);
  }
});
test('a second segment cannot hide nonempty file data behind zero memory size', async t => {
  const data = fixture({ dynamic: true });
  data.writeUInt32LE(1, 120); data.writeBigUInt64LE(0x100000n, 136); data.writeBigUInt64LE(0n, 160);
  const result = await inspect(t, data); assert.equal(result.accepted, false); assert.match(result.reason, /File bytes/);
});
test('current TacHen coordinator and resident deck cross-builds pass the actual native validator', async () => {
  for (const file of ['tachen-runtime.elf', 'tachen-deck.elf', 'tachen-package-helper.elf']) {
    const result = spawnSync(exe, [path.join(root, 'build', file), '--inspect-only'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); const parsed = JSON.parse(result.stdout); assert.equal(parsed.accepted, true, file + ': ' + parsed.reason);
  }
});
