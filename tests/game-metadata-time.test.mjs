import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('registered PS4 metadata rejects updates and replacements newer than the game, including subsecond boundaries',()=>{
 const root=path.resolve(import.meta.dirname,'..'),exe=path.join(root,'build/game-metadata-time-test.exe');
 const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const built=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/native','tests/game-metadata-time-runner.c','-o',exe],{cwd:root,encoding:'utf8'});
 assert.equal(built.status,0,built.stderr||built.error?.message);assert.equal(spawnSync(exe,['--fail-check']).status,90);
 const run=spawnSync(exe,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/checks passed/);
});
