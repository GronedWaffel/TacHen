import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('actual post-read pad binary preserves reads and bounds menu capture to its owner and lease', () => {
  const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/pad-bridge-test.exe');
  const env = { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') };
  const build = spawnSync(process.execPath, ['scripts/build-pad-bridge.mjs', 'build/pad-test'], { cwd: root, encoding: 'utf8', env });
  assert.equal(build.status, 0, build.stderr);
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compiled = spawnSync(zig, ['c++', '-O1', '-Wall', '-Wextra', '-Werror', '-DHDE_DECODE_ONLY', '-std=c++17',
    '-Iplatform/game', '-Ivendor/deck', 'tests/pad-bridge-runner.cpp', 'platform/game/pad-trampoline.cpp',
    'vendor/deck/relocate.cpp', 'vendor/deck/hde64.cpp', '-o', exe], { cwd: root, encoding: 'utf8', env });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
  const fail = spawnSync(exe, ['--fail-check'], { encoding: 'utf8', timeout: 10000 });assert.equal(fail.status, 90);
  const result = spawnSync(exe, [path.join(root, 'build/pad-test/pad.bin')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);assert.match(result.stdout, /passed/);
});
