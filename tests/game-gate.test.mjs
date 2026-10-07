import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('actual game callback binary preserves arguments, serializes module starts and retains failures', () => {
  const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/game-gate-test.exe');
  const env = { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') };
  const built = spawnSync(process.execPath, ['scripts/build-game-gate.mjs', 'build/game-test'], { cwd: root, encoding: 'utf8', env });
  assert.equal(built.status, 0, built.stderr);
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compiled = spawnSync(zig, ['c++', '-O1', '-Wall', '-Wextra', '-Werror', '-DHDE_DECODE_ONLY', '-std=c++17',
    '-Iplatform/game', '-Ivendor/deck', 'tests/game-gate-runner.cpp', 'platform/game/game-trampoline.cpp',
    'vendor/deck/relocate.cpp', 'vendor/deck/hde64.cpp', '-o', exe], { cwd: root, encoding: 'utf8', env });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
  const failure = spawnSync(exe, ['--fail-check'], { encoding: 'utf8' }); assert.equal(failure.status, 90); assert.match(failure.stderr, /CHECK failed/);
  const result = spawnSync(exe, [path.join(root, 'build/game-test/gate.bin')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /passed/);
});
