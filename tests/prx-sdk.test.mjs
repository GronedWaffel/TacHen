import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('PS5 development module SDK adaptation preserves uploads, PS4 ABI and unavailable firmware APIs',()=>{
  const root=path.resolve(import.meta.dirname,'..'),exe=path.join(root,'build/prx-sdk-test.exe');
  const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const c=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/native','tests/prx-sdk-runner.c','platform/native/prx-image.c','-o',exe],{cwd:root,encoding:'utf8'});
  assert.equal(c.status,0,c.stderr);const guard=spawnSync(exe,['--fail-check'],{encoding:'utf8'});assert.equal(guard.status,90);
  const r=spawnSync(exe,[],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/checks passed/);
});
