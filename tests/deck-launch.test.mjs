import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('launch rejects sibling traps, wrong instruction pointers, nonzero create results and uncertain stops',()=>{
 const root=path.resolve(import.meta.dirname,'..'),exe=path.join(root,'build/deck-launch-test.exe');
 const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const build=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Itests/deck-inject-stubs','tests/deck-launch-runner.c','-o',exe],{cwd:root,encoding:'utf8'});
 assert.equal(build.status,0,build.stderr||build.error?.message);
 const run=spawnSync(exe,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.error?.message);
});
