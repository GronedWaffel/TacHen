import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('native plugin parser rejects malformed containers and executable/module confusion', () => {
  const root = path.resolve(import.meta.dirname, '..'), exe = path.join(root, 'build/native-plugin-test.exe');
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compiled = spawnSync(zig, ['cc', '-O1', '-Wall', '-Wextra', '-Werror', '-Iplatform/native', '-Iplatform/loader',
    'tests/native-plugin-runner.c', 'platform/native/plugin-image.c', 'platform/native/elf-image.c',
    'platform/native/dispatch-receipt.c', 'platform/loader/sha256.c', '-o', exe],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
  const failure = spawnSync(exe, ['--fail-check'], { encoding: 'utf8' }); assert.equal(failure.status, 90); assert.match(failure.stderr, /CHECK failed/);
  const result = spawnSync(exe, [], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /passed/);
});
