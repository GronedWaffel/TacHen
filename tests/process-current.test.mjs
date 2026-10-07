import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('native process guard rejects stale SDK pointers, invalid lists and bounded cycles', () => {
  const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/process-current-test.exe');
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const build = spawnSync(zig, ['cc', '-O1', '-Wall', '-Wextra', '-Werror', '-Itests/process-stubs', '-Iplatform/native',
    'tests/process-current-runner.c', 'platform/native/process-current.c', '-o', exe],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const failure = spawnSync(exe, ['--fail-check'], { encoding: 'utf8' }); assert.equal(failure.status, 90); assert.match(failure.stderr, /CHECK failed/);
  const result = spawnSync(exe, [], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /passed/);
});
