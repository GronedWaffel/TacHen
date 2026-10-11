import test from 'node:test';
import assert from 'node:assert/strict';
import {continuePayloadLoad} from '../src/deck-payload-load.mjs';
import {payloadDownloadsRows} from '../src/deck-downloads.mjs';
import {ConsoleDeck} from '../src/deck.mjs';
import {TacRuntime} from '../src/runtime.mjs';
import {store,ids} from './helpers.mjs';

function fixture(status='completed') {
 const imported={id:'copy',status,args:{name:'example.elf'},result:{id:'file',sha256:'digest'}},calls=[];
 const state={safe:false,jobs:[imported],inbox:[{id:'file',name:'example.elf',status:'verified'}],services:[],capabilities:[{id:'payloads',available:true}]};
 const runtime={componentsByHash:new Map(),snapshot:()=>state,jobs:{stopped:false,get:async id=>state.jobs.find(j=>j.id===id)},execute:async(command,args)=>{
  calls.push({command,args});const job={id:'send',status:'completed',result:{message:'Sent successfully'}};state.jobs.push(job);return job;
 }};
 return {runtime,imported,state,calls};
}

test('storage selection checks and loads once without a second action',async()=>{
 const {runtime,imported,calls,state}=fixture();
 const view=continuePayloadLoad(runtime,imported);await view.done;
 assert.equal(view.phase,'ready');assert.equal(view.file,'file');assert.equal(calls.length,1);
 assert.deepEqual(calls[0],{command:'job.enqueue',args:{kind:'payload.dispatch',input:{id:'file'},key:'storage_load_copy'}});
 for(let i=0;i<5;i++)payloadDownloadsRows(state,{load:view},runtime.componentsByHash);
 assert.equal(calls.length,1);
});
for(const status of ['failed','cancelled','interrupted','uncertain','held'])test(`storage ${status} never loads the payload`,async()=>{
 const {runtime,imported,calls}=fixture(status);const view=continuePayloadLoad(runtime,imported);await view.done;
 assert.equal(view.phase,'error');assert.equal(calls.length,0);
});
test('shutdown while preparing does not schedule a payload later',async()=>{
 const {runtime,imported,calls}=fixture('running');
 const view=continuePayloadLoad(runtime,imported,{delay:async()=>{runtime.jobs.stopped=true;imported.status='completed';}});
 await view.done;assert.equal(view.phase,'error');assert.equal(calls.length,0);
});
for(const status of ['ready','stopped'])test(`managed payload ${status} uses service state rather than a duplicate raw load`,async()=>{
 const {runtime,imported,state,calls}=fixture();runtime.componentsByHash.set('digest','kstuff');state.services=[{id:'kstuff',status}];
 const view=continuePayloadLoad(runtime,imported);await view.done;assert.equal(view.phase,'ready');
 assert.equal(calls.length,status==='ready'?0:1);if(calls.length)assert.equal(calls[0].command,'service.start');
});
test('downloaded payload progress follows completion and failure with options preserved',()=>{
 const {state,runtime}=fixture(),load={job:'copy',file:'file',trackJob:true,phase:'loading'};
 let rows=payloadDownloadsRows(state,{load},runtime.componentsByHash);assert.equal(rows[0].label,'Load complete');
 assert.ok(rows.some(r=>r.label==='Payload options'));
 state.jobs[0].status='failed';state.jobs[0].error={message:'Loader refused the file'};
 rows=payloadDownloadsRows(state,{load},runtime.componentsByHash);assert.equal(rows[0].label,'Could not load payload');assert.equal(rows[0].detail,'Loader refused the file');
});
test('Payloads > Load from storage > ELF starts the whole workflow and leaves navigation usable',async t=>{
 const runtime=await new TacRuntime(await store(),{identity:async()=>({mode:'development'}),install:async()=>{}},{id:ids()}).start();t.after(()=>runtime.close());
 const deck=new ConsoleDeck(runtime);runtime.capability('payloads',true);
 const f=fixture();runtime.inboxItems=f.state.inbox;runtime.jobs.get=f.runtime.jobs.get;runtime.componentsByHash=new Map();
 const calls=[];runtime.execute=async(command,args)=>{
  if(command==='files.browse')return args.source?{kind:'payload',source:'/mnt/usb0',parent:null,entries:[{name:'example.elf',source:'usb-file',bytes:100,modified:1}]}:{kind:'payload',entries:[{name:'USB',usb:true,directory:true,source:'/mnt/usb0'}]};
  calls.push({command,args});if(args.kind==='file.import')return f.imported;return f.runtime.execute(command,args);
 };
 async function select(label){const frame=deck.frame(),row=frame.rows.findIndex(x=>x.label===label);assert.ok(row>=0,label);return deck.action({kind:'select',row,request:runtime.id(),sequence:frame.sequence});}
 await select('Payloads');assert.deepEqual(deck.frame().rows.map(r=>r.label),['Download from link','Downloads','Load from storage','Startup payloads']);
 await select('Load from storage');assert.equal(deck.frame().rows[0].label,'example.elf');
 const frame=deck.frame(),request={kind:'select',row:0,request:runtime.id(),sequence:frame.sequence};await Promise.all([deck.action(request),deck.action(request)]);
 const load=deck.payloadDownloads.load;await select('Back to payloads');await load.done;
 assert.equal(deck.confirmation,null);assert.equal(load.phase,'ready');assert.equal(calls.filter(c=>c.args.kind==='file.import').length,1);assert.equal(calls.filter(c=>c.args.kind==='payload.dispatch').length,1);
});
