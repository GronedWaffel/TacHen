import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('actual PS4 counter machine code preserves the submission ABI and counts atomically', () => {
  const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/fps-trampoline-test.exe');
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compile = spawnSync(zig, ['c++', '-O1', '-Wall', '-Wextra', '-Werror', '-std=c++17', '-DHDE_DECODE_ONLY',
    '-Iplatform/native', '-Ivendor/deck', 'tests/fps-trampoline-runner.cpp', 'platform/game/fps-trampoline.cpp',
    'vendor/deck/relocate.cpp', 'vendor/deck/hde64.cpp', '-o', exe], { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
  const failure = spawnSync(exe, ['--fail-check'], { encoding: 'utf8', timeout: 10000 });assert.equal(failure.status, 90);
  const result = spawnSync(exe, [], { encoding: 'utf8', timeout: 10000 });assert.equal(result.status, 0, result.stdout + result.stderr);assert.match(result.stdout, /passed/);
});
