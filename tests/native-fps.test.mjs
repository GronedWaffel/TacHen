import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('actual native AGC ring reader bounds reads and rejects malformed or changing sources', () => {
  const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/native-fps-test.exe');
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const built = spawnSync(zig, ['cc', '-O1', '-Wall', '-Wextra', '-Werror', '-Iplatform/native',
    'tests/native-fps-runner.c', 'platform/native/fps-counters.c', 'platform/native/user-read.c', '-o', exe],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(built.status, 0, built.stderr || built.error?.message);
  const failure = spawnSync(exe, ['--fail-check'], { encoding: 'utf8' });assert.equal(failure.status, 90);
  const result = spawnSync(exe, [], { encoding: 'utf8' });assert.equal(result.status, 0, result.stderr);assert.match(result.stdout, /passed/);
});
