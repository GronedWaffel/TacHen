import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('actual POSIX assembly preserves successful descriptors and converts raw kernel carry errors',()=>{
  const result=spawnSync('python',['-X','utf8','tests/posix-at-runner.py'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/30 POSIX syscall cases passed/);
});
