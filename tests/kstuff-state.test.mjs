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
test('expanded tables preserve every Beta 1 offset and firmware update bit', async () => {
  const baseline=JSON.parse(await fs.readFile(new URL('../vendor/firmware-baseline-beta1.json',import.meta.url)));
  const expanded=JSON.parse(await fs.readFile(new URL('../vendor/firmware-provenance.json',import.meta.url)));
  assert.equal(baseline.firmwares.length,14);assert.equal(expanded.firmwares.length,67);
  for(const [bit,old] of baseline.firmwares.entries()){
    const row=expanded.firmwares.find(p=>p.firmware===old.firmware);
    assert.deepEqual(row.offsets,old.offsets,old.firmware);assert.equal(Number(row.code),Number(old.code));assert.equal(row.updateBit,bit);
  }
  for(const row of expanded.firmwares){
    assert.equal(row.kstuffAnchorAdjustment,Number(row.firmware)<3?-0x1010000:0);
    for(const source of Object.values(row.sourceUrls))assert.match(source,/^https:\/\/github\.com\/.+\/blob\/[a-f0-9]{40}\//);
  }
  await import('../scripts/check-firmware-profiles.mjs');
});
