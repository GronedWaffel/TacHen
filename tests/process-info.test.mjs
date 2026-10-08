import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('native process reader accepts the observed PS5 extension and rejects truncated, oversized, mismatched and failed reads',()=>{
 const root=path.resolve(import.meta.dirname,'..'),exe=path.join(root,'build/process-info-test.exe');
 const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const result=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Itests/kinfo-stubs','-Iplatform/native','tests/process-info-runner.c','platform/native/process-info.c','-o',exe],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.error?.message);
 assert.equal(spawnSync(exe,['--fail-check']).status,90);
 const run=spawnSync(exe,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/checks passed/);
});
