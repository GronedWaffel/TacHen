import test from 'node:test';
import assert from 'node:assert/strict';
import {TacRuntime} from '../src/runtime.mjs';
import {ConsoleDeck} from '../src/deck.mjs';
import {packageDeckRows} from '../src/deck-packages.mjs';
import {transferRows} from '../src/deck-transfers.mjs';
import {store,ids} from './helpers.mjs';
test('Payloads root has exactly four actions and keeps file operations in Downloads',async t=>{
 const r=await new TacRuntime(await store(),{install(){},identity:async()=>({mode:'development'})},{id:ids()}).start();t.after(()=>r.close());
 const d=new ConsoleDeck(r);d.page=1;r.inboxItems=[{id:'a'.repeat(32),name:'file.elf',status:'verified',bytes:128}];
 assert.deepEqual(d.frame().rows.map(x=>x.label),['Download from link','Downloads','Load from storage','Startup payloads']);
 const choose=async label=>{const f=d.frame();return d.action({kind:'select',row:f.rows.findIndex(x=>x.label===label),sequence:f.sequence,request:r.id()});};
 await choose('Downloads');await choose('file.elf');assert(d.frame().rows.some(x=>x.label==='Delete download'));
 await choose('Delete download');assert.match(d.frame().title,/Confirm/);await d.action({kind:'back',request:r.id(),sequence:d.frame().sequence});assert.equal(d.payloadDownloads.id,'a'.repeat(32));
});
test('Packages and Transfers separate entry actions from long file and job lists',()=>{
 const state={packages:[{id:'x',name:'game.pkg',bytes:8192,status:'verified'}],jobs:[],identity:{ip:'192.168.1.2'}};
 const root=packageDeckRows(state,{},[]);assert(root.some(x=>x.label==='Downloads'));assert(!root.some(x=>x.label==='game.pkg'));
 assert(packageDeckRows(state,{downloads:true},[]).some(x=>x.label==='game.pkg'));
 assert.deepEqual(transferRows(state).map(x=>x.label),['File browser','Active transfers','Completed transfers','FTP connection']);
});
