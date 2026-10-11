import test from 'node:test';
import assert from 'node:assert/strict';
import {TacRuntime} from '../src/runtime.mjs';
import {ConsoleDeck,encodeDeck} from '../src/deck.mjs';
import {installPlugins} from '../src/plugins.mjs';
import {KEYBOARDS} from '../src/deck-download.mjs';
import {store,ids,until} from './helpers.mjs';
const target={titleId:'PPSA00001',version:'01.000.000'};
const game={...target,name:'Offline test game',platform:'ps5',pid:77,generation:'100:0/77/110:0',metadataHash:'c'.repeat(64)};
async function fixture(t,{module=false}={}){
  const upload='a'.repeat(32),sha256='b'.repeat(64),info={id:upload,name:module?'example.sprx':'watcher.plugin',format:module?'sprx':'plugin',sha256,
    ...(module?{platform:'ps5'}:{pluginId:'TACP00001',pluginVersion:'1.00'})},receipts=new Map();let calls=0,probes=0;
  const probe={boot:'100:0',processes:[],kstuff:{injectionReady:true}},native={systemProbe:()=>{probes++;return probe;},
    pluginStart(request,_upload,hash){calls++;const pid=88,generation='100:0/88/115:0';receipts.set(request,{request,sha256:hash,stage:3,plugin:true,pluginId:info.pluginId,pluginVersion:info.pluginVersion,pid,generation});probe.processes.push({pid,generation,name:info.pluginId});},
    loaderPoll:request=>receipts.get(request),
    gameModuleStart(request,_upload,hash,pid,generation){calls++;receipts.set(request,{request,sha256:hash,pid,generation,stage:4,handle:12,startResult:0});},
    gameModulePoll:request=>receipts.get(request)};
  const runtime=await new TacRuntime(await store(),{identity:async()=>({mode:'development',ip:'127.0.0.1',firmware:'13.60'}),install(r){
    r.inbox={verify:async id=>{assert.equal(id,upload);return {...info};}};installPlugins(r,native);
  }},{id:ids()}).start();
  runtime.inboxItems=[{id:upload,name:info.name,status:'verified',bytes:100,offset:100}];runtime.consoleDeck=new ConsoleDeck(runtime);
  t.after(()=>runtime.close());
  return {runtime,deck:runtime.consoleDeck,info,native,probe,calls:()=>calls,probes:()=>probes};
}
function action(f,kind,row){return f.deck.action({kind,row,sequence:f.deck.frame().sequence,request:f.runtime.id()});}
async function choose(f,label){for(let i=0;i<20;i++){
  const frame=f.deck.frame(),index=frame.rows.findIndex(row=>typeof label==='string'?row.label===label:label.test(row.label));
  if(index>=0)return action(f,'select',index);
  const next=frame.rows.findIndex(row=>row.label==='More items');assert(next>=0,'Missing row '+label+' in '+frame.rows.map(row=>row.label).join(', '));await action(f,'select',next);
}assert.fail('Too many pages');}
const confirm=f=>choose(f,/^Confirm:/);
async function register(f){await choose(f,'Plugins');assert(!f.deck.frame().rows.some(x=>x.label==='Add from inbox'));f.deck.pluginView={kind:'register',upload:f.info.id};await choose(f,'Register as system / game watcher');assert.equal(f.runtime.plugins.entries().length,0);await confirm(f);}

test('controller registers a verified standalone plugin, starts before a game, and shares its result with the phone snapshot',async t=>{
  const f=await fixture(t);await register(f);assert.equal(f.calls(),0);assert.match(f.deck.frame().title,/Plugins/);
  assert.equal(f.runtime.snapshot().plugins[0].autostart,false);await choose(f,'Start now');assert.equal(f.calls(),0);
  const request={kind:'select',row:0,sequence:f.deck.frame().sequence,request:f.runtime.id()};await Promise.all([f.deck.action(request),f.deck.action(request)]);
  await until(()=>f.runtime.jobs.snapshot()[0]?.status==='completed');await f.runtime.plugins.refresh();
  assert.equal(f.calls(),1);const visible=f.runtime.snapshot().plugins[0];assert.equal(visible.observation.phase,'process-active');assert.equal(visible.controls.canStart,false);
  assert.match(visible.controls.startReason,/initialization is plugin-specific/);assert.equal(f.runtime.jobs.snapshot()[0].result.initialized,false);
  const probes=f.probes();for(let i=0;i<10;i++){f.runtime.snapshot();encodeDeck(f.deck.frame());}assert.equal(f.probes(),probes,'Rendering must not issue extra native probes');
  assert(!f.deck.frame().rows.some(row=>/autostart/i.test(row.label)));assert.match(f.deck.frame().rows.find(row=>row.label==='When to load').detail,/recommended/);
});
test('controller Circle backs out of nested plugin screens without launching or losing the parent section',async t=>{
  const f=await fixture(t);await choose(f,'Plugins');assert(!f.deck.frame().rows.some(x=>x.label==='Add from inbox'));f.deck.pluginView={kind:'register',upload:f.info.id};
  await choose(f,'Register as system / game watcher');await action(f,'back');assert.equal(f.deck.pluginView.kind,'register');assert.equal(f.runtime.plugins.entries().length,0);
  await action(f,'back');assert.equal(f.deck.pluginView.kind,'list');
  await action(f,'back');assert.equal(f.deck.pluginView,null);assert.equal(f.deck.frame().page,0);assert.equal(f.calls(),0);
});
test('phone clients cannot restore removed plugin autostart',async t=>{
 const f=await fixture(t);await register(f);
 await assert.rejects(f.runtime.execute('plugin.configure',{sha256:f.info.sha256,autostart:true,revision:f.runtime.snapshot().revision}),{code:'PLUGIN_MANUAL_ONLY'});
 assert.equal(f.runtime.plugins.entries()[0].autostart,false);assert.equal(f.calls(),0);
});

test('game module registration uses an exact target; it stays manual while the game is closed',async t=>{
  const f=await fixture(t,{module:true});await choose(f,'Plugins');assert(!f.deck.frame().rows.some(x=>x.label==='Add from inbox'));f.deck.pluginView={kind:'register',upload:f.info.id};
  assert(!f.deck.frame().rows.some(row=>row.label==='Register as system / game watcher'));
  assert(f.deck.frame().rows.some(row=>row.label==='Choose a game target'));
  f.runtime.game={...game};await choose(f,'Register for '+target.titleId+' / '+target.version);await confirm(f);
  assert.deepEqual(f.runtime.plugins.entries()[0].target,target);f.runtime.game=null;
  let start=f.deck.frame().rows.find(row=>row.label==='Load into game');assert.equal(start.enabled,false);assert.match(start.detail,/manually/);
  await f.runtime.plugins.refresh();assert.equal(f.calls(),0);
  f.runtime.game={...game,version:'01.001.000'};await f.runtime.plugins.refresh();assert.equal(f.calls(),0);
  f.runtime.game={...game};f.probe.processes=[{pid:game.pid,generation:game.generation}];await f.runtime.plugins.refresh();await choose(f,'Load into game');await confirm(f);
  await until(()=>f.runtime.jobs.snapshot()[0]?.status==='completed');await f.runtime.plugins.refresh();assert.equal(f.calls(),1);
  assert.equal(f.runtime.snapshot().plugins[0].observation.phase,'module-started');assert.equal(f.runtime.snapshot().plugins[0].controls.canStart,false);
});
test('startup recovery disables controller and phone plugin launch controls but permits configuration',async t=>{
  const f=await fixture(t);await register(f);f.runtime.graph.safe=true;
  const entry=f.runtime.snapshot().plugins[0],start=f.deck.frame().rows.find(row=>row.label==='Start now');assert.equal(entry.controls.canStart,false);assert.equal(start.enabled,false);assert.match(start.detail,/recovery/);
  await f.runtime.plugins.refresh();assert.equal(f.calls(),0);assert.equal(f.runtime.plugins.entries()[0].autostart,false);
});
test('a saved loadout supplies an exact PRX target before its game opens',async t=>{
  const f=await fixture(t,{module:true});f.info.name='example.prx';f.info.format='prx';f.runtime.inboxItems[0].name=f.info.name;
  f.runtime.loadouts={snapshot:()=>({profiles:[{...target,name:'Saved game'}, {...target,name:'Duplicate presentation'}]}),overlay:()=>({}),stop(){}};
  await choose(f,'Plugins');assert(!f.deck.frame().rows.some(x=>x.label==='Add from inbox'));f.deck.pluginView={kind:'register',upload:f.info.id};
  const options=f.deck.frame().rows.filter(row=>row.command==='plugin.register');assert.equal(options.length,1);assert.deepEqual(options[0].args.target,target);
  await choose(f,options[0].label);await confirm(f);assert.equal(f.runtime.plugins.entries()[0].format,'prx');assert.equal(f.runtime.game,null);assert.equal(f.calls(),0);
  assert(!f.deck.frame().rows.some(row=>/autostart/i.test(row.label)));assert.equal(f.runtime.plugins.entries()[0].autostart,false);
});


async function typeTarget(f,value){
  for(const char of value){
    const key=char==='.'?36:KEYBOARDS[f.deck.textInput.page].indexOf(char);
    assert(key>=0,'Key unavailable: '+char);await action(f,'select',key);
  }
  await action(f,'select',39);
}
test('copied PRX can register from the installed library with no running game or loadout',async t=>{
  const f=await fixture(t,{module:true});
  f.runtime.libraryState={games:[{...game},{...game}],updatedAt:1,available:true,error:null};
  await choose(f,'Plugins');await choose(f,'Finish adding: '+f.info.name);
  const picker=f.deck.frame().rows.find(row=>row.label==='Choose a game target');assert.equal(picker.enabled,true);
  await choose(f,'Choose a game target');
  assert.equal(f.deck.frame().rows.filter(row=>row.label===game.name).length,1);
  await choose(f,game.name);await choose(f,'Register plugin');assert.equal(f.runtime.plugins.entries().length,0);
  await confirm(f);assert.deepEqual(f.runtime.plugins.entries()[0].target,target);
  assert.equal(f.runtime.game,null);assert.equal(f.calls(),0);
  assert(!f.deck.frame().rows.some(row=>/autostart/i.test(row.label)));assert.equal(f.calls(),0);
});
test('registration has a keyboard fallback when the game list is empty',async t=>{
  const f=await fixture(t,{module:true});await choose(f,'Plugins');await choose(f,'Finish adding: '+f.info.name);
  await choose(f,'Choose a game target');await choose(f,'Enter game manually');
  assert.equal(f.deck.frame().rows.find(row=>row.label==='Register plugin').enabled,false);
  await choose(f,'Game title ID');assert.match(f.deck.frame().title,/Enter game title ID/);await typeTarget(f,target.titleId);
  await choose(f,'Game version');await typeTarget(f,target.version);
  await choose(f,'Register plugin');await confirm(f);
  assert.deepEqual(f.runtime.plugins.entries()[0].target,target);assert.equal(f.calls(),0);
});
test('missing installed version is never guessed and pending registration survives backing out',async t=>{
  const f=await fixture(t,{module:true});f.runtime.libraryState={games:[{...game,version:null}],updatedAt:1,available:true,error:null};
  await choose(f,'Plugins');await choose(f,'Finish adding: '+f.info.name);await choose(f,'Choose a game target');
  await action(f,'back');assert.equal(f.deck.pluginView.kind,'register');
  await choose(f,'Choose a game target');await choose(f,game.name);
  assert.equal(f.deck.frame().rows.find(row=>row.label==='Register plugin').enabled,false);
  await choose(f,'Game version');await action(f,'back');assert.equal(f.deck.pluginView.target.version,'');
  await action(f,'back');await choose(f,'Finish adding: '+f.info.name);
  assert.equal(f.deck.pluginView.kind,'register');assert.equal(f.calls(),0);
});
