import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('game import metadata resolves only verified pad relocations',()=>{
 const root=path.resolve(import.meta.dirname,'..'),exe=path.join(root,'build/game-imports-test.exe');
 const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const build=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/native','tests/game-imports-runner.c','platform/native/game-imports.c','-o',exe],
 {cwd:root,encoding:'utf8',env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')}});
 assert.equal(build.status,0,build.stderr);
 const fail=spawnSync(exe,['--fail-check'],{encoding:'utf8'});assert.equal(fail.status,90);
 const run=spawnSync(exe,[],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/passed/);
});
