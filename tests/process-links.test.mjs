import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('final console artifacts redirect internal SDK lookups and reject a regressed call site', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const result = spawnSync(process.env.PYTHON || 'python', ['tests/process-links-runner.py'],
    { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /three artifacts and negative link regression passed/);
});
