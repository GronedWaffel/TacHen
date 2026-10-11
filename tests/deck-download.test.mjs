import test from 'node:test';
import assert from 'node:assert/strict';
import {KEYBOARDS,editDownload,suggestedName} from '../src/deck-download.mjs';
import {ConsoleDeck,encodeDeck} from '../src/deck.mjs';
import {TacRuntime} from '../src/runtime.mjs';
import {store,ids} from './helpers.mjs';
import {downloadRows} from '../src/deck-download.mjs';
import {payloadDownloadsRows} from '../src/deck-downloads.mjs';
import {payloadRunAction} from '../src/deck-payload-action.mjs';

test('downloaded bundled payloads use managed startup and never launch a duplicate',()=>{
 const digest='a'.repeat(64), id='b'.repeat(32), components=new Map([[digest,'payload-manager']]);
 const state={safe:false,capabilities:[{id:'payloads',available:true}],services:[{id:'payload-manager',status:'stopped'}],
  inbox:[{id,name:'manager.elf',status:'verified',bytes:128}],jobs:[{id:'download',status:'completed',result:{id,sha256:digest}}]};
 let row=payloadDownloadsRows(state,{id},components).find(r=>r.label==='Load payload');
 assert.equal(row.command,'service.start');assert.deepEqual(row.args,{id:'payload-manager'});assert.equal(row.confirm,false);
 // The regular payload list also recognizes downloads without an expected hash.
 assert.equal(payloadRunAction(state,{id,expectedSha256:null},components).command,'service.start');
 state.services[0].status='ready';row=payloadDownloadsRows(state,{id},components).find(r=>r.label==='Load payload');
 assert.equal(row.enabled,false);assert.match(row.detail,/already running/);
 state.services[0].status='starting';assert.equal(payloadRunAction(state,{id},components).enabled,false);
 state.jobs[0].result.sha256='c'.repeat(64);row=payloadDownloadsRows(state,{id},components).find(r=>r.label==='Load payload');
 assert.equal(row.command,'job.enqueue');assert.equal(row.args.kind,'payload.dispatch');
});
test('controller keyboard covers link punctuation and preserves bounded input',()=>{
 for(const page of KEYBOARDS)assert.equal(page.length,36);
 const input={field:'url',page:0,value:'https://'};editDownload(input,'select',0);assert.equal(input.value,'https://a');
 editDownload(input,'previous');assert.equal(input.page,2);editDownload(input,'select',1);assert.equal(input.value,'https://a?');
 editDownload(input,'select',38);assert.equal(input.value,'https://a');assert.equal(editDownload(input,'select',39),'done');
 input.value='x'.repeat(2048);assert.throws(()=>editDownload(input,'select',0),{code:'DOWNLOAD_INPUT_LIMIT'});
 input.value='ftp://example.com/a.elf';assert.throws(()=>editDownload(input,'select',39),{code:'DOWNLOAD_URL'});
 input.field='name';input.value='../file.elf';assert.throws(()=>editDownload(input,'select',39),{code:'DOWNLOAD_NAME'});
 assert.equal(suggestedName('https://example.com/download?id=1'),'payload.elf');
});
test('native download editing and one-click download never execute a payload',async t=>{
 const runtime=await new TacRuntime(await store(),{identity:async()=>({mode:'development'}),install:async()=>{}},{id:ids()}).start();t.after(()=>runtime.close());
 const deck=new ConsoleDeck(runtime);deck.page=1;
 async function act(kind,row=0){return deck.action({kind,row,request:runtime.id(),sequence:deck.frame().sequence});}
 async function select(label){const row=deck.frame().rows.findIndex(x=>x.label===label);assert.ok(row>=0,label);return act('select',row);}
 await select('Download from link');await select('Download link');
 assert.equal(encodeDeck(deck.frame()).readUInt16LE(6)&128,128);
 await act('select',0);await act('select',36);await act('select',1);await act('select',39);
 assert.equal(deck.downloadView.url,'https://a.b');assert.equal(deck.textInput,null);
 await select('Filename');await act('select',0);await act('back');assert.equal(deck.downloadView.name,'payload.elf');
 const calls=[];runtime.execute=async(command,args)=>{calls.push({command,args});return {id:'download-job'};};
 await select('Download payload');assert.equal(deck.confirmation,null);
 assert.equal(calls.length,1);assert.equal(calls[0].args.kind,'payload.download');assert.equal(deck.downloadView.job,'download-job');
 assert.ok(!calls.some(x=>x.args.kind==='payload.dispatch'));
});
