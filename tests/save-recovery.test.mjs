// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
test('native save recovery verifies quiescence, publication and durability before releasing the operation', async () => {
  const exe = path.join(root, 'build/save-recovery-test.exe');
  await fs.mkdir(path.dirname(exe), { recursive: true });
  const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compiled = spawnSync(zig, ['cc', '-O1', '-Wall', '-Wextra', '-Werror', '-DTAC_SAVE_RECOVERY_TEST',
    '-Itests', '-Iplatform/native', '-Iplatform/loader', 'tests/save-recovery-runner.c',
    'platform/native/save-recovery.c', 'platform/native/save-recovery-io.c', 'platform/native/save-core.c',
    'platform/loader/sha256.c', '-o', exe],
  { cwd: root, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
  assert.equal(spawnSync(exe, ['--fail-check']).status, 90, 'optimized runner checks must execute');
  const result = spawnSync(exe, [], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /passed/);
});
