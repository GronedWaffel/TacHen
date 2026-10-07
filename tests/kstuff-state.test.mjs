import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FIRMWARES } from '../src/firmware.mjs';
test('actual native kstuff classifier accepts complete hooks and withholds transitional/legacy poison states', async () => {
  const root = path.resolve(import.meta.dirname, '..'); await fs.mkdir(path.join(root, 'build'), { recursive: true });
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const exe = path.join(root, 'build/kstuff-state-test.exe');
  const build = spawnSync(zig, ['cc', '-O1', '-Wall', '-Wextra', '-Werror', '-Iplatform/native', 'tests/kstuff-state-runner.c', '-o', exe],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const failure = spawnSync(exe, ['--fail-check'], { encoding: 'utf8' }); assert.equal(failure.status, 90); assert.match(failure.stderr, /CHECK failed/);
  const run = spawnSync(exe, [], { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /passed/);
});
test('native firmware tables exactly match the pinned public profile data and JS support gate', async () => {
  const data = JSON.parse(await fs.readFile(new URL('../vendor/firmware-provenance.json', import.meta.url)));
  const header = await fs.readFile(new URL('../platform/native/firmware-profiles.h', import.meta.url), 'utf8');
  assert.deepEqual(data.firmwares.map(p => p.firmware), FIRMWARES);
  const rows = [...header.matchAll(/\{(0x[0-9a-f]+)u,"([0-9.]+)",([^}]+)\}/g)];
  assert.equal(rows.length, FIRMWARES.length);
  const fields = ['allproc', 'security', 'rootvnode', 'textDelta', 'sysentvec', 'sysentvecPs4', 'cryptSingletonArray', 'sysents', 'sysentsPs4', 'pagerTable'];
  for (const [index, match] of rows.entries()) {
    const profile = data.firmwares[index]; assert.equal(match[2], profile.firmware); assert.equal(Number(match[1]), Number(profile.code));
    assert.deepEqual(match[3].split(',').map(Number), fields.map(field => profile.offsets[field]));
  }
});
