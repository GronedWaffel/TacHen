import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('GoldHEN compatibility executes the native bridge and adapted SDK call with correct ABI and bounded failures',()=>{
 const root=path.resolve(import.meta.dirname,'..'),exe=path.join(root,'build/goldhen-compat-test.exe');
 const env={...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')};
 const built=spawnSync(process.execPath,['scripts/build-goldhen-bridge.mjs'],{cwd:root,encoding:'utf8',env});assert.equal(built.status,0,built.stderr);
 const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const compiled=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/game','-Iplatform/native','tests/goldhen-compat-runner.c','platform/native/goldhen-compat.c','-o',exe],{cwd:root,encoding:'utf8',env});assert.equal(compiled.status,0,compiled.stderr);
 const guard=spawnSync(exe,['--fail-check'],{encoding:'utf8'});assert.equal(guard.status,90);
 const run=spawnSync(exe,[path.join(root,'build/goldhen/bridge.bin')],{encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/tests passed/);
});
