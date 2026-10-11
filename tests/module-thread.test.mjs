import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('module workers reserve stack before creation and handle every attribute failure',()=>{
 const root=path.resolve(import.meta.dirname,'..'),exe=path.join(root,'build/module-thread-test.exe');
 const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const compiled=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Itests/mocks/module-thread','-Iplatform/native',
  'tests/module-thread-runner.c','-o',exe],{cwd:root,encoding:'utf8',env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')}});
 assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
 const run=spawnSync(exe,[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/passed/);
});
