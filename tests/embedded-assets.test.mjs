// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { embeddingAssembly, verifyEmbeddedAsset } from '../scripts/embedded-assets.mjs';

const root = path.resolve(import.meta.dirname, '..');
const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
function run(args, cwd) {
  const result = spawnSync(zig, args, { cwd, encoding: 'utf8',
    env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test('Zig rebuilds an embedded asset changed at the same path, size and timestamp', async t => {
  const base = path.join(root, 'build');
  const dir = await fs.mkdtemp(path.join(base, 'embedding-case-'));
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(base + path.sep));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const first = Buffer.from('FIRST-EMBEDDED-BUILD'), second = Buffer.from('OTHER-EMBEDDED-BUILD');
  const stamp = new Date('2020-01-01T00:00:00Z');
  async function build(bytes) {
    await fs.writeFile(path.join(dir, 'asset.bin'), bytes);
    await fs.utimes(path.join(dir, 'asset.bin'), stamp, stamp);
    const assembly = embeddingAssembly([{ symbol: 'fixture', path: 'asset.bin', bytes }]) +
      '.text\n.global _start\n_start:\nret\n';
    await fs.writeFile(path.join(dir, 'asset.S'), assembly);
    run(['cc', '-target', 'x86_64-linux-none', '-c', 'asset.S', '-o', 'asset.o'], dir);
    run(['ld.lld', '-e', '_start', 'asset.o', '-o', 'fixture.elf'], dir);
    return fs.readFile(path.join(dir, 'fixture.elf'));
  }
  const old = await build(first);
  verifyEmbeddedAsset(old, 'fixture', first);
  const fresh = await build(second);
  verifyEmbeddedAsset(fresh, 'fixture', second);
  assert.throws(() => verifyEmbeddedAsset(fresh, 'fixture', first), /bytes differ/);
  assert.ok((await build(second)).equals(fresh), 'unchanged input should produce identical bytes');

  // An unrelated copy of the right bytes must never satisfy the exported span.
  assert.throws(() => verifyEmbeddedAsset(Buffer.concat([old, second]), 'fixture', second), /bytes differ/);
  assert.throws(() => verifyEmbeddedAsset(fresh, 'fixture', second.subarray(1)), /span length/);
  assert.throws(() => verifyEmbeddedAsset(fresh, 'missing', second), /missing span symbols/);
  assert.throws(() => verifyEmbeddedAsset(fresh.subarray(0, 32), 'fixture', second), /truncated/);
  const unreadable = Buffer.from(fresh);
  const phoff = Number(unreadable.readBigUInt64LE(32)), count = unreadable.readUInt16LE(56);
  for (let i = 0; i < count; i++) {
    const at = phoff + i * 56;
    if (unreadable.readUInt32LE(at) === 1) unreadable.writeBigUInt64LE(0n, at + 32);
  }
  assert.throws(() => verifyEmbeddedAsset(unreadable, 'fixture', second), /file-backed load mapping/);
});

test('every final runtime helper and launcher fallback matches the current build at its exported span', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'build/manifest.json')));
  const runtime = await fs.readFile(path.join(root, 'build/tachen-runtime.elf'));
  const checks = [];
  for (const [symbol, file] of [['assets', 'components.bin'], ['deck', 'tachen-deck.elf'],
    ['launch', 'tachen-launch-helper.elf'], ['package', 'tachen-package-helper.elf'], ['save', 'tachen-save-helper.elf']]) {
    checks.push(verifyEmbeddedAsset(runtime, 'tachen_' + symbol, await fs.readFile(path.join(root, 'build', file))));
  }
  assert.deepEqual(checks, manifest.embeddedAssets.runtime);
  const launcher = await fs.readFile(path.join(root, 'build/tachen.elf'));
  const update = await fs.readFile(path.join(root, 'build/tachen-update.tachen'));
  assert.deepEqual(verifyEmbeddedAsset(launcher, 'tachen_fallback', update), manifest.embeddedAssets.launcher);
  assert.ok(update.subarray(256).equals(runtime), 'the fallback package must carry the current runtime');
  const damaged = Buffer.from(launcher);
  damaged[manifest.embeddedAssets.launcher.offset + 256] ^= 1;
  assert.throws(() => verifyEmbeddedAsset(damaged, 'tachen_fallback', update), /bytes differ/);
});
