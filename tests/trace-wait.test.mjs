import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('native trace wait rejects wrong stops and terminates even with an unresponsive target or clock', async () => {
  await fs.mkdir('build/tests', { recursive: true });
  const zig = process.env.ZIG || path.resolve('../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compile = spawnSync(zig, ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-Iplatform/native',
    'platform/native/trace-wait.c', 'tests/trace-wait-runner.c', '-o', 'build/tests/trace-wait.exe'], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
  const result = spawnSync(path.resolve('build/tests/trace-wait.exe'), [], { encoding: 'utf8' });assert.equal(result.status, 0, result.stderr);
});
