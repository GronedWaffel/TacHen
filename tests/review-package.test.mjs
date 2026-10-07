// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { sourceFingerprint } from '../scripts/source-fingerprint.mjs';

test('review packaging refuses stale source, changed bytes and unsupported artifact claims',()=>{
  const run=spawnSync(process.env.PYTHON||'python',['tests/review-package-runner.py'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr||run.error?.message);
});

test('source fingerprint includes Python tooling and ignores generated outputs',async t=>{
  const root=await fs.mkdtemp(path.resolve('build/fingerprint-test-'));
  t.after(async()=>{assert(root.startsWith(path.resolve('build')+path.sep));await fs.rm(root,{recursive:true,force:true});});
  for(const dir of ['src','platform','ui','scripts','vendor'])await fs.mkdir(path.join(root,dir));
  for(const file of ['package.json','package-lock.json'])await fs.writeFile(path.join(root,file),'{}');
  const before=await sourceFingerprint(root);
  await fs.writeFile(path.join(root,'scripts/review.py'),'# revision 1\n');const first=await sourceFingerprint(root);assert.notEqual(first,before);
  await fs.writeFile(path.join(root,'scripts/review.py'),'# revision 2\n');const next=await sourceFingerprint(root);assert.notEqual(next,first);
  await fs.writeFile(path.join(root,'scripts/review.py'),'# revision 2\r\n');assert.equal(await sourceFingerprint(root),next);
  await fs.writeFile(path.join(root,'generated.elf'),'not a source file');assert.equal(await sourceFingerprint(root),next);
});
