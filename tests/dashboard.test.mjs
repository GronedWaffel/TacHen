import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Dashboard } from '../src/dashboard.mjs';
import { ConsoleDeck,encodeDeck } from '../src/deck.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store,ids } from './helpers.mjs';
import { serve } from '../src/server.mjs';

async function fixture(t){
 const runtime=await new TacRuntime(await store(),{identity:async()=>({mode:'development',ip:'127.0.0.1'}),install:async()=>{}},{id:ids()}).start();
 runtime.consoleDeck=new ConsoleDeck(runtime);runtime.deckCredential=runtime.id();t.after(()=>runtime.close());return runtime;
}

test('dashboard ID/version toggle is the first Settings row and persists its change',async t=>{
 const r=await fixture(t),d=r.consoleDeck;d.page=4;d.offset=0;
 const toggle=d.frame().rows[0];
 assert.equal(toggle.label,'Dashboard title ID + version');assert.equal(toggle.enabled,true);
 assert.equal(toggle.command,'settings.update');assert.equal(toggle.args.patch.appearance.gameCardDetails,true);
 await r.settings(toggle.args.patch,toggle.args.revision);
 assert.equal(d.frame().rows[0].on,true);assert.match(d.frame().rows[0].detail,/^On/);
 assert.equal(d.frame().rows[0].args.patch.appearance.gameCardDetails,false);
});
test('dashboard details default off, persist through settings, and rotate bounded metadata without invalidating selections',async t=>{
 const r=await fixture(t),d=r.consoleDeck;
 assert.equal(r.snapshot().settings.appearance.gameCardDetails,false);
 r.libraryState={error:null,available:true,games:Array.from({length:70},(_,i)=>({titleId:'PPSA'+String(i).padStart(5,'0'),version:'01.010.002'}))};
 assert.deepEqual(d.frame().dashboard.items,[]);
 await r.settings({appearance:{gameCardDetails:true}},r.snapshot().revision);
 const frames=[d.frame(),d.frame(),d.frame()],all=new Set(frames.flatMap(f=>f.dashboard.items.map(g=>g.titleId)));
 assert.equal(all.size,70);assert.equal(frames[0].sequence,frames[2].sequence);
 const wire=encodeDeck(frames[0]);assert.equal(wire.readUInt32LE(10848),1);assert.equal(wire.readUInt32LE(10860),32);
 assert.equal(wire.toString('ascii',10864,10873),frames[0].dashboard.items[0].titleId);
 const epoch=frames[0].dashboard.epoch;r.libraryState.games[0].version='01.011.000';assert.notEqual(d.frame().dashboard.epoch,epoch);
 await r.settings({appearance:{gameCardDetails:false}},r.snapshot().revision);assert.deepEqual(d.frame().dashboard.items,[]);
});
test('metadata polling is coalesced and failure leaves the main menu usable',async()=>{
 let resolve,calls=0;const r={snapshot:()=>({settings:{appearance:{gameCardDetails:true}}}),library:{refresh:()=>{calls++;return new Promise(r=>resolve=r);}},libraryState:{games:[]}};
 const d=new Dashboard(r);for(let i=0;i<50;i++)d.frame();assert.equal(calls,1);resolve();await d.pending;d.frame();assert.equal(calls,1);
 d.lastRead=0;r.library.refresh=async()=>{throw Error('Unavailable')};d.frame();await d.pending;assert.equal(d.frame().enabled,true);
});
test('dashboard action selects that title, deduplicates retries, and never applies cheats or launches games',async t=>{
 const r=await fixture(t),d=r.consoleDeck;r.store.state.cheats=[
  {sha256:'a'.repeat(64),titleId:'PPSA00001',version:'01.000.000',name:'First',count:1},
  {sha256:'b'.repeat(64),titleId:'CUSA00002',version:'01.00',name:'Second',count:1}];r.cheats={list:()=>r.store.state.cheats};
 d.managerView={};d.confirmation={};d.dashboard.open({serial:1,titleId:'CUSA00002'});
 assert.equal(d.page,0);assert.deepEqual(d.managerView,{});assert.deepEqual(d.confirmation,{});
 const rows=d.dashboard.cheats.frame().rows;assert(rows.some(x=>x.label==='Second'));assert(!rows.some(x=>x.label==='First'));
 assert.equal(r.jobs.snapshot().length,0);d.page=0;d.dashboard.open({serial:1,titleId:'CUSA00002'});assert.equal(d.page,0);
 d.dashboard.open({serial:2,titleId:'PPSA00001'});assert.equal(d.dashboard.cheats.cheatTitle,'PPSA00001');
 assert.throws(()=>d.dashboard.open({serial:1,titleId:'PPSA00001'}),{code:'DASHBOARD_REQUEST'});
 assert.throws(()=>d.dashboard.open({serial:3,titleId:'../../bad'}),{code:'DASHBOARD_REQUEST'});
});
test('native dashboard action requires the existing private renderer session and returns its acknowledgement',async t=>{
 const r=await fixture(t),s=await serve(r,{host:'127.0.0.1',port:0,id:r.id,uiRoot:path.resolve('ui')});
 t.after(async()=>{s.closeAllConnections();await new Promise(ok=>s.close(ok));});const url=`http://127.0.0.1:${s.address().port}/native/deck/sync`;
 const body=JSON.stringify({menuOpen:false,dashboard:{serial:7,titleId:'PPSA00001'}});
 const bad=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(bad.status,403);assert.equal(r.consoleDeck.page,0);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-TacHen-Native':r.deckCredential},body});assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.readUInt32LE(10856),7);assert.equal(bytes.readUInt16LE(12),0);
});
test('performance readout is empty without a game and returns for a running game; IP stays separate',async t=>{
 const r=await fixture(t);for(const cap of ['fps','resources','ip-overlay'])r.capability(cap,true);
 await r.settings({overlay:{fps:true,cpu:true,ram:true,ip:true}},r.snapshot().revision);
 r.telemetry={snapshot:()=>({fps:60,cpuPercent:20,rssBytes:1048576}),stop(){}};
 assert.equal(r.consoleDeck.frame().metrics,'');assert.equal(r.consoleDeck.frame().ipVisible,true);
 r.game={titleId:'PPSA00001',version:'01.000.000',name:'Game',pid:40,generation:'one'};
 assert.match(r.consoleDeck.frame().metrics,/FPS 60.*CPU 20%.*RAM 1 MiB/);
 r.game=null;assert.equal(r.consoleDeck.frame().metrics,'');
});
test('native dashboard callbacks preserve originals, isolate URLs and acknowledge actions once',async()=>{
 await fs.mkdir('build/tests',{recursive:true});const zig=process.env.ZIG||path.resolve('../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const c=spawnSync(zig,['cc','-std=c11','-Wall','-Wextra','-Werror','-Itests/dashboard-stubs','-Iplatform/deck','tests/dashboard-runner.c','-o','build/tests/dashboard.exe'],{encoding:'utf8'});assert.equal(c.status,0,c.stderr);
 const r=spawnSync(path.resolve('build/tests/dashboard.exe'),[],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('dashboard setup resolves Mono by module and reports optional metadata failures without rejecting the menu',async()=>{
 await fs.mkdir('build/tests',{recursive:true});const zig=process.env.ZIG||path.resolve('../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 for(const name of ['mono-api','dashboard-prepare']){
  const exe=`build/tests/${name}.exe`;
  const c=spawnSync(zig,['cc','-std=c11','-Wall','-Wextra','-Werror','-Itests/dashboard-stubs','-Iplatform/deck',`tests/${name}-runner.c`,'-o',exe],{encoding:'utf8'});assert.equal(c.status,0,c.stderr);
  const r=spawnSync(path.resolve(exe),[],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }
});

test('native cheats settings window escapes data, isolates row actions, preserves retries and releases owned handles',async()=>{
 const zig=process.env.ZIG||path.resolve('../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const c=spawnSync(zig,['cc','-std=c11','-Wall','-Wextra','-Werror','-Itests/dashboard-stubs','-Iplatform/deck','tests/cheats-window-runner.c','-o','build/tests/cheats-window.exe'],{encoding:'utf8'});assert.equal(c.status,0,c.stderr);
 const r=spawnSync(path.resolve('build/tests/cheats-window.exe'),[],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('separate native cheats route is authenticated and leaves the main menu state intact',async t=>{
 const r=await fixture(t);r.consoleDeck.page=2;const s=await serve(r,{host:'127.0.0.1',port:0,id:r.id,uiRoot:path.resolve('ui')});
 t.after(async()=>{s.closeAllConnections();await new Promise(ok=>s.close(ok));});
 const url=`http://127.0.0.1:${s.address().port}/native/cheats/sync`,body=JSON.stringify({dashboard:{serial:10,titleId:'PPSA00001'}});
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-TacHen-Native':r.deckCredential},body});assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.readUInt16LE(12),5);assert.equal(bytes.readUInt32LE(10856),10);assert.equal(r.consoleDeck.page,2);
});

test('native settings keeps unchanged row identities through status updates but invalidates changed action contexts',async t=>{
 const r=await fixture(t);r.consoleDeck.dashboard.open({serial:1,titleId:'PPSA00001'});const d=r.consoleDeck.dashboard.cheats;
 const before=d.frame(),importBefore=before.rows.find(x=>x.command==='$browse');
 d.notice='Download complete';const after=d.frame();
 assert.notEqual(after.sequence,before.sequence);assert.equal(after.rows.find(x=>x.command==='$browse').token,importBefore.token);
 d.confirmation={label:'Action',detail:'Confirm',command:'job.enqueue',args:{kind:'file.delete',input:{path:'first'}}};
 const first=d.frame();d.confirmation.args.input.path='second';const second=d.frame();
 assert.notEqual(first.rows[0].token,second.rows[0].token);assert.notEqual(first.sequence,second.sequence);
 d.confirmation=null;const third=d.frame();r.game={titleId:'PPSA00001',version:'01.000.000',generation:'new-process'};
 const fourth=d.frame();assert.notEqual(third.rows[0].token,fourth.rows[0].token);
});

test('native cheat catalog changes once after sync, not on every imported pack or progress message',async t=>{
 const r=await fixture(t);r.consoleDeck.dashboard.open({serial:1,titleId:'CUSA00265'});const d=r.consoleDeck.dashboard.cheats;
 let jobs=[{id:'sync',kind:'cheat.sync',status:'running',progress:{phase:'First file'}}];r.jobs.snapshot=()=>jobs;r.store.state.jobs=jobs;r.cheats={list:()=>r.store.state.cheats};
 r.store.state.cheats=[];const first=d.frame();
 for(let i=0;i<4;i++){
  r.store.state.cheats=[...r.store.state.cheats,{sha256:String(i).repeat(64),titleId:'CUSA00265',version:'01.00',name:'Minecraft',count:2}];
  jobs[0].progress.phase='Importing file '+i;
  const update=d.frame();assert.equal(update.sequence,first.sequence);assert(!update.rows.some(x=>x.label==='Minecraft'));
 }
 jobs[0].status='completed';jobs[0].result={message:'Done'};
 const finished=d.frame();assert.notEqual(finished.sequence,first.sequence);assert(finished.rows.some(x=>x.label==='Minecraft'));
 assert.equal(finished.rows.find(x=>x.label==='Minecraft').detail,'CUSA00265 \u00b7 01.00 \u00b7 2 cheats');
 assert.equal(d.frame().sequence,finished.sequence);
});
