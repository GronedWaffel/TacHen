import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { installPayloadLoader } from '../src/payload-loader.mjs';
import { installStartupPayloads } from '../src/startup-payloads.mjs';
import { ConsoleDeck } from '../src/deck.mjs';
import { store, ids, until } from './helpers.mjs';
async function fixture(t) {
  const files = ['a','b'].map(c => ({ id:c.repeat(32), sha256:c.repeat(64), name:c+'.elf', format:'elf', status:'verified', expectedSha256:c.repeat(64) }));
  const calls=[], receipts=new Map();let boot='100:1';
  const native={systemProbe:()=>({boot}),loaderStart(request,id,sha256){calls.push(id);receipts.set(request,{request,sha256,boot,stage:3,pid:40});},loaderPoll:id=>receipts.get(id)||null};
  const runtime=await new TacRuntime(await store(),{identity:async()=>({mode:'development'}),install(r){
    r.inbox={verify:async id=>{const file=files.find(x=>x.id===id);assert.ok(file);return file;},status:async id=>files.find(x=>x.id===id)};
    r.inboxItems=files;r.nativeServices={inspect:async()=>({ready:true}),stopMonitoring(){}};
    installPayloadLoader(r,native);installStartupPayloads(r,native,{delay:()=>new Promise(resolve=>setTimeout(resolve,1))});
  }},{id:ids()}).start();t.after(()=>runtime.close());
  const configure=(index,patch)=>runtime.execute('payload.startup.configure',{id:files[index].id,...patch,revision:runtime.snapshot().revision});
  return {runtime,native,files,calls,configure,setBoot:value=>boot=value};
}
test('startup selections persist, run in selected order and do not replay within a boot',async t=>{
  const f=await fixture(t);await f.configure(0,{enabled:true});await f.configure(1,{enabled:true,move:-1});
  await Promise.all([f.runtime.startupPayloads.run(),f.runtime.startupPayloads.run()]);
  assert.deepEqual(f.calls,[f.files[1].id,f.files[0].id]);
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,2);
  f.setBoot('101:1');await f.runtime.startupPayloads.run();assert.equal(f.calls.length,4);
});
test('manual dispatch evidence skips the same payload during automatic startup',async t=>{
  const f=await fixture(t);await f.configure(0,{enabled:true});
  await f.runtime.jobs.enqueue('payload.dispatch',{id:f.files[0].id},'manual-first');
  await until(()=>f.calls.length===1&&f.runtime.jobs.snapshot()[0].status==='completed');
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,1);
  assert.equal(f.runtime.jobs.snapshot().at(-1).result.phase,'already-dispatched');
});
test('uncertain earlier dispatch blocks duplicate startup and remaining payloads',async t=>{
  const f=await fixture(t);await f.configure(0,{enabled:true});await f.configure(1,{enabled:true});
  const j=await f.runtime.jobs.enqueue('payload.dispatch',{id:f.files[0].id},'manual-first');
  await until(()=>f.runtime.jobs.snapshot()[0].status==='completed');
  const poll=f.native.loaderPoll;f.native.loaderPoll=id=>id===j.id?{...poll(id),stage:5}:poll(id);
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,1);assert.equal(f.runtime.startupPayloads.snapshot().phase,'attention');
});
test('startup guards recovery, managed components and stale changes, and permits disabling a missing file',async t=>{
  const f=await fixture(t);await f.configure(0,{enabled:true});f.runtime.graph.safe=true;
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,0);f.runtime.graph.safe=false;
  f.runtime.componentHashes=new Set([f.files[1].sha256]);await assert.rejects(f.configure(1,{enabled:true}),{code:'MANAGED_COMPONENT'});
  await assert.rejects(f.runtime.startupPayloads.configure({id:f.files[0].id,enabled:false,revision:0}),{code:'STATE_CHANGED'});
  f.runtime.inbox.verify=async()=>{throw Error('file missing');};await f.configure(0,{enabled:false});assert.equal(f.runtime.snapshot().startupPayloads.items[0].enabled,false);
});
test('controller startup controls configure the actual persistent startup selection',async t=>{
  const f=await fixture(t),deck=new ConsoleDeck(f.runtime);deck.page=1;
  async function select(label){const frame=deck.frame();const row=frame.rows.findIndex(x=>x.label===label);assert.ok(row>=0,label);return deck.action({request:f.runtime.id(),sequence:frame.sequence,kind:'select',row});}
  await select('Startup payloads');await select('a.elf');await select('Load when TacHen starts');
  assert.equal(f.runtime.snapshot().startupPayloads.items[0].enabled,true);assert.equal(f.calls.length,0);
});

test('a restarted coordinator uses saved startup settings and receipts without loading twice',async t=>{
  const f=await fixture(t);await f.configure(0,{enabled:true,delayMs:0});
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,1);
  await f.runtime.close();
  const next=await new TacRuntime(f.runtime.store,f.runtime.platform,{id:f.runtime.id}).start();t.after(()=>next.close());
  assert.equal(next.snapshot().startupPayloads.items[0].enabled,true);
  await next.startupPayloads.run();assert.equal(f.calls.length,1);
  f.setBoot('102:1');await next.startupPayloads.run();assert.equal(f.calls.length,2);
});

test('automatic payloads wait for successful configured-service startup and kstuff readiness',async t=>{
  const f=await fixture(t);await f.configure(0,{enabled:true});
  f.runtime.recovery={pending:true,snapshot:()=>({last:{status:'ready'}})};
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,0);
  f.runtime.recovery={pending:null,permitsJob:()=>false,snapshot:()=>({last:{status:'failed'}})};
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,0);
  f.runtime.recovery.snapshot=()=>({last:{status:'ready'}});
  f.runtime.nativeServices.inspect=async()=>({ready:false});
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,0);
  assert.equal(f.runtime.startupPayloads.snapshot().phase,'attention');
  f.runtime.nativeServices.inspect=async()=>({ready:true});
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,1);
});

test('phone choices exclude unverified files, plugins and managed components; removal keeps the file',async t=>{
  const f=await fixture(t);await f.configure(0,{enabled:true});
  f.runtime.componentHashes=new Set([f.files[1].sha256]);
  f.runtime.inboxItems.push({...f.files[1],id:'c'.repeat(32),name:'c.plugin',expectedSha256:'c'.repeat(64)},
    {...f.files[1],id:'d'.repeat(32),name:'d.elf',status:'uploading',expectedSha256:'d'.repeat(64)});
  assert.deepEqual(f.runtime.snapshot().startupPayloads.available.map(x=>x.id),[f.files[0].id]);
  await f.configure(0,{remove:true});assert.equal(f.runtime.snapshot().startupPayloads.items.length,0);
  assert.equal((await f.runtime.inbox.verify(f.files[0].id)).name,'a.elf');
  await f.runtime.startupPayloads.run();assert.equal(f.calls.length,0);
});
