import test from 'node:test';
import assert from 'node:assert/strict';
import {transferRows} from '../src/deck-transfers.mjs';
test('Transfers puts live work first, hides prior startup noise, and keeps past file transfers without service noise',()=>{
  const jobs=[{id:'old',kind:'deck.start',status:'failed',session:'old',updatedAt:1},
    {id:'done',kind:'file.import',status:'completed',session:'now',updatedAt:3},
    {id:'live',kind:'package.install',status:'running',session:'old',updatedAt:2,progress:{completed:50,total:100,phase:'Installing'}}];
  const state={session:'now',jobs};const rows=transferRows(state,{section:'active'});
  assert.deepEqual(rows.filter(x=>x.command==='$transfer-open').map(x=>x.args.id),['live']);
  assert.match(rows[0].detail,/50%/);assert.equal(rows[0].label,'Install package');
  assert.equal(transferRows(state,{section:'completed'}).filter(x=>x.command==='$transfer-open').length,1);
});
test('transfer details provide the save destination and only supported cancellation controls',()=>{
  const state={session:'now',identity:{ip:'192.168.1.2'},jobs:[]};
  const job={id:'save',kind:'save.export',status:'completed',result:{ftpPath:'/saves/id/save.tar'}};
  assert.match(transferRows(state,{id:'save'},[job]).find(x=>x.label==='Copy to your computer').detail,/2122.*\/saves/);
  job.status='running';const handlers=new Map([['save.export',{cancellable:false}]]);
  assert.equal(transferRows(state,{id:'save'},[job],handlers).some(x=>x.command==='job.cancel'),false);
});

test('a package workflow has one transfer entry while its steps retain recovery and cancellation',()=>{
  const parent={id:'parent',kind:'package.receive',status:'interrupted',checkpoint:{stage:'download',install:'install'},updatedAt:3};
  const download={id:'download',kind:'package.download',status:'completed',updatedAt:1};
  const install={id:'install',kind:'package.install',status:'interrupted',updatedAt:2};
  const state={jobs:[parent,download,install]},handlers=new Map([['package.receive',{cancellable:false}],['package.install',{cancellable:false}]]);
  assert.deepEqual(transferRows(state,{section:'active'}).filter(r=>r.command==='$transfer-open').map(r=>r.args.id),['parent']);
  const detail=transferRows(state,{id:'parent'},state.jobs,handlers);
  assert.deepEqual(detail.filter(r=>r.command==='$transfer-open').map(r=>r.args),[{id:'download',parent:'parent'},{id:'install',parent:'parent'}]);
  const step=transferRows(state,{id:'install',parent:'parent'},state.jobs,handlers);
  assert(step.some(r=>r.command==='job.reconcile'&&r.args.id==='install'));
  assert.equal(step.at(-1).label,'Back to package transfer');
  // If the parent was archived, its remaining actionable child stays visible.
  assert.equal(transferRows({jobs:[install]},{section:'active'}).filter(r=>r.command==='$transfer-open').length,1);
});
