import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { installLibrary } from '../src/library.mjs';
import { localRequest } from '../src/local-http.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store, ids, until, deferred } from './helpers.mjs';
import { ConsoleDeck } from '../src/deck.mjs';
async function fixture(t, options = {}) {
  const evidence = { ready: true, id: 'shadowmount', boot: 'one', pid: 30, generation: 'process-one', version: '1.7beta4' };
  const game = { title_id: 'PPSA00001', title_name: 'Test game', content_id: 'CONTENT00001', platform: 'ps5',
    path: '/data/games/test.ffpkg', source_type: 'image', installed: true, mounted: false, installed_pkg: false,
    source_available: true, can_manage_source: true, app_db_size_bytes: 1000000 };
  const calls = [], state = { game, evidence, busy: false, games: null };
  const server = createServer(async (req, res) => {
    assert.equal(req.method, 'POST'); assert.equal(req.headers['content-type'], 'application/json');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push({ route: req.url, body });
    let response;
    if (req.url === '/api/v1/games') {
      assert.equal(body.include_size, false);
      response = { status: 0, count: state.games?.length ?? 1, games: state.games || [game] };
    } else {
      assert.equal(body.title_id, game.title_id);
      if (state.busy) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end('{"status":16,"error":"Device busy"}'); }
      game.mounted = req.url === '/api/v1/games/mount'; response = { status: 0, title_id: game.title_id, mounted: game.mounted };
    }
    const data = JSON.stringify(response);
    if(req.url==='/api/v1/games'&&state.holdNextList){const gate=state.holdNextList;state.holdNextList=null;gate.captured.resolve();await gate.release.promise;}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }); res.end(data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const runtime = new TacRuntime(await store(), { identity: async () => ({ mode: 'development' }), async install(runtime) {
    runtime.nativeServices = { inspect: async () => structuredClone(evidence) };
    installLibrary(runtime, { request: (_port, route, options) => localRequest(server.address().port, route, options), ...options });
  } }, { id: ids() });
  await runtime.start(); return { runtime, state, calls };
}
test('game library uses ShadowMount POST contract without recursively measuring game directories', async t => {
  const { runtime, calls } = await fixture(t);
  const page = await runtime.execute('library.refresh', {});
  assert.equal(page.games[0].titleId, 'PPSA00001'); assert.equal(page.games[0].canMount, true);
  assert.deepEqual(calls, [{ route: '/api/v1/games', body: { include_size: false } }]);
  assert.equal(runtime.snapshot().library.count, 1); assert.equal(runtime.snapshot().library.games, undefined);
});

test('installed versions survive ShadowMount merge and malformed optional versions never discard a game',async t=>{
 const {runtime}=await fixture(t,{catalog:async()=>[
  {titleId:'PPSA00001',name:'Game',version:'01.010.002'},
  {titleId:'CUSA00002',name:'PS4 game',version:'03.43'},
  {titleId:'PPSA00003',name:'Bad version',version:'03.43'},
  {titleId:'CUSA00004',name:'Missing version'}]});
 const result=await runtime.library.refresh();
 assert.equal(result.games.find(g=>g.titleId==='PPSA00001').version,'01.010.002');
 assert.equal(result.games.find(g=>g.titleId==='CUSA00002').version,'03.43');
 assert.equal(result.games.find(g=>g.titleId==='PPSA00003').version,null);
 assert.equal(result.games.find(g=>g.titleId==='CUSA00004').version,null);assert.equal(result.total,4);
});

test('an unreadable installed-game database does not block ShadowMount discovery and emits source diagnostics',async t=>{
 const logs=[],{runtime,calls}=await fixture(t,{catalog:()=>{throw Error('database is locked');},log:line=>logs.push(line)});
 const result=await runtime.library.refresh();
 assert.equal(result.available,true);assert.equal(result.games[0].titleId,'PPSA00001');assert.match(result.error.message,/Installed games:/);
 assert.equal(calls.length,1);assert(logs.some(s=>s.includes('installed failed')&&s.includes('database is locked')));
 assert(logs.some(s=>s.includes('shadowmount ready')&&s.includes('1.7beta4')));
 assert(logs.some(s=>s.includes('refresh finished')&&s.includes('"total":1')));
 assert(!logs.some(s=>s.includes('Test game')||s.includes('/data/games/')));
});

test('a malformed installed catalog cannot discard the independent ShadowMount list',async t=>{
 const {runtime}=await fixture(t,{catalog:async()=>[{titleId:'NOT_A_TITLE',name:'Bad',contentId:''}]});
 const result=await runtime.library.refresh();assert.equal(result.games.length,1);assert.equal(result.error,null);
});

test('utility records and display metadata cannot hide valid installed games',async t=>{
 const logs=[],{runtime,state}=await fixture(t,{log:s=>logs.push(s),catalog:async()=>[
  {titleId:'PS5M00001',name:'Utility',contentId:''},null,
  {titleId:'CUSA00002',name:'Game\nTitle',contentId:null,bytes:100},
  {titleId:'PPSA00003',name:null,contentId:'content'},
  {titleId:'CUSA00002',name:'Duplicate',contentId:''}
 ]});state.games=[];
 const page=await runtime.library.refresh();assert.equal(page.error,null);assert.equal(page.total,2);
 assert.deepEqual(page.games.map(g=>[g.titleId,g.name,g.contentId]),[['CUSA00002','Game Title',''],['PPSA00003','PPSA00003','content']]);
 assert(logs.some(s=>s.includes('"skipped":3')&&s.includes('"normalized":2')));
});

test('Games auto refresh uses the manual command on a timer for both list and details',async t=>{
 let catalogs=0,tick=null,cancelled=0;const {runtime,state,calls}=await fixture(t,{catalog:async()=>{catalogs++;return [];}});
 state.game.mounted=true;await runtime.library.refresh();
 const deck=new ConsoleDeck(runtime,{schedule:(fn,ms)=>{assert.equal(ms,3000);tick=fn;return 42;},cancel:id=>{assert.equal(id,42);cancelled++;tick=null;}});
 t.after(()=>deck.stop());deck.page=2;deck.gameView={titleId:state.game.title_id};deck.notice='Keep this notice';
 assert(deck.frame().rows.some(r=>r.label==='Unmount game'));
 state.game.mounted=false;tick();await deck.libraryPending;
 assert(deck.frame().rows.some(r=>r.label==='Mount game'));assert.equal(catalogs,2);assert.equal(deck.notice,'Keep this notice');
 assert.equal(calls.filter(c=>c.route!=='/api/v1/games').length,0);
 const count=calls.length;for(let i=0;i<20;i++)deck.frame();assert.equal(calls.length,count);
 state.evidence.ready=false;tick();await deck.libraryPending;
 assert.match(deck.frame().rows.find(r=>r.label==='Refresh library').detail,/ShadowMount/);
 assert.equal(deck.notice,'Keep this notice');
 state.evidence.ready=true;state.game.mounted=true;tick();await deck.libraryPending;
 assert(deck.frame().rows.some(r=>r.label==='Unmount game'));
 deck.gameView=null;state.game.mounted=false;tick();await deck.libraryPending;
 assert(deck.frame().rows.some(r=>r.detail.includes('Needs mounting')));
 deck.setVisible(false);assert.equal(tick,null);assert.equal(cancelled,1);
 deck.setVisible(true);assert(tick);deck.page=0;deck.frame();assert.equal(tick,null);assert.equal(cancelled,2);
});

test('automatic and manual refresh share one in-flight request and recover after errors',async t=>{
 const {runtime,state,calls}=await fixture(t);let tick;
 const deck=new ConsoleDeck(runtime,{schedule:fn=>{tick=fn;return 1;},cancel:()=>{}});t.after(()=>deck.stop());deck.page=2;deck.frame();
 const gate={captured:deferred(),release:deferred()};state.holdNextList=gate;
 tick();const pending=deck.libraryPending;await gate.captured.promise;
 tick();assert.equal(deck.refreshLibrary(),pending);assert.equal(calls.length,1);
 gate.release.resolve();await pending;assert.equal(deck.libraryPending,null);
 state.evidence.ready=false;tick();await deck.libraryPending;assert.equal(deck.libraryPending,null);
 state.evidence.ready=true;tick();await deck.libraryPending;assert.equal(runtime.libraryState.available,true);
});

test('a delayed game-status read cannot overwrite a newer verified mount',async t=>{
 const {runtime,state}=await fixture(t);await runtime.library.refresh();
 const gate={captured:deferred(),release:deferred()};state.holdNextList=gate;
 const stale=runtime.library.refreshGame(state.game.title_id);await gate.captured.promise;
 try{
  await runtime.jobs.enqueue('library.mount',{titleId:state.game.title_id,mounted:true},'newer-mount');
  await until(()=>runtime.jobs.snapshot()[0].status==='completed');
 }finally{gate.release.resolve();await stale;}
 assert.equal(runtime.libraryState.games[0].mounted,true);
});

test('failure of both catalog sources is reported instead of presenting a successful empty refresh',async t=>{
 const {runtime,state,calls}=await fixture(t,{catalog:()=>{throw Error('database open failed');}});
 state.evidence.ready=false;state.evidence.reason='ShadowMount is stopped';
 await assert.rejects(runtime.library.refresh(),e=>e.code==='LIBRARY_UNAVAILABLE'&&/Installed games:/.test(e.message)&&/ShadowMount is stopped/.test(e.message));
 assert.equal(runtime.libraryState.available,false);assert.equal(calls.length,0);
 state.evidence.ready=true;assert.equal((await runtime.library.refresh()).games.length,1);
});

test('a successful empty catalog remains distinct from failed discovery and logging cannot block it',async t=>{
 const {runtime,state}=await fixture(t,{catalog:async()=>[],log:()=>{throw Error('log unavailable');}});
 state.games=[];const result=await runtime.library.refresh();assert.equal(result.available,true);assert.equal(result.total,0);assert.equal(result.error,null);
});

test('beta3 managed-source response populates games without requiring beta4-only PKG fields',async t=>{
  const {runtime,state}=await fixture(t);state.evidence.version='1.7beta3';
  delete state.game.installed_pkg;delete state.game.can_manage_source;
  state.game.managed=true;state.game.image_backed=true;
  const result=await runtime.library.refresh();assert.equal(result.games[0].canMount,true);assert.equal(result.games[0].installedPackage,false);
  state.game.managed=false;assert.equal((await runtime.library.refresh()).games[0].canMount,false);
  state.evidence.version='1.7beta4';await assert.rejects(runtime.library.refresh(),{code:'LIBRARY_RESPONSE'});
});
test('mount and unmount complete only after independent observation and bind the game source', async t => {
  const { runtime, state, calls } = await fixture(t);
  await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'mount-one');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed'); assert.equal(state.game.mounted, true);
  const repeated = await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'mount-one');
  assert.equal(repeated.id, runtime.jobs.snapshot()[0].id); assert.equal(runtime.jobs.snapshot().length, 1);
  await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: false }, 'unmount-one');
  await until(() => runtime.jobs.snapshot()[1].status === 'completed'); assert.equal(state.game.mounted, false);
  assert.equal(calls.filter(item => item.route.endsWith('/mount')).length, 1);
  assert.equal(calls.filter(item => item.route.endsWith('/unmount')).length, 1);
});

test('the open game menu updates after verified unmount even when an older refresh arrives last',async t=>{
 const {runtime,state,calls}=await fixture(t);state.game.mounted=true;await runtime.library.refresh();
 const deck=new ConsoleDeck(runtime);deck.page=2;deck.gameView={titleId:state.game.title_id};
 assert(deck.frame().rows.some(r=>r.label==='Unmount game'));
 const gate={captured:deferred(),release:deferred()};state.holdNextList=gate;
 const stale=runtime.library.refresh();await gate.captured.promise;
 try{
  await runtime.jobs.enqueue('library.mount',{titleId:state.game.title_id,mounted:false},'menu-unmount');
  await until(()=>runtime.jobs.snapshot()[0].status==='completed');
  assert(deck.frame().rows.some(r=>r.label==='Mount game'));
  assert(!deck.frame().rows.some(r=>r.label==='Unmount game'));
 }finally{gate.release.resolve();await stale;}
 assert.equal(runtime.libraryState.games[0].mounted,false);
 assert(deck.frame().rows.some(r=>r.label==='Mount and play'));
 assert.equal(calls.filter(c=>c.route.endsWith('/unmount')).length,1);
});

test('no-op and reconciled mount observations update the menu without repeating the write',async t=>{
 const {runtime,state,calls}=await fixture(t);await runtime.library.refresh();
 state.game.mounted=true;
 const handler=runtime.jobs.handlers.get('library.mount');
 const input=await handler.validate({titleId:state.game.title_id,mounted:true});
 await handler.run(input,{id:'observed-noop'});
 assert.equal(runtime.libraryState.games[0].mounted,true);
 state.game.mounted=false;
 await handler.reconcile({args:{...input,priorMounted:true,mounted:false}});
 assert.equal(runtime.libraryState.games[0].mounted,false);
 assert.equal(calls.filter(c=>c.route.endsWith('/mount')||c.route.endsWith('/unmount')).length,0);
});
test('history mount undo verifies the original service and source, then observes the inverse state', async t => {
  const { runtime, state, calls } = await fixture(t);
  const source = await runtime.jobs.enqueue('library.mount', { titleId: state.game.title_id, mounted: true }, 'history-mount');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed');
  const noop = await runtime.jobs.enqueue('library.mount', { titleId: state.game.title_id, mounted: true }, 'history-mount-noop');
  await until(() => runtime.jobs.snapshot().find(j => j.id === noop.id).status === 'completed');
  const plan = runtime.changes.preview(source);assert.equal(plan.available, true);
  runtime.game = { titleId: state.game.title_id };await assert.rejects(runtime.changes.undo(plan), { code: 'HISTORY_CONFLICT' });runtime.game = null;
  const old = state.evidence.generation;state.evidence.generation = 'replacement';
  await assert.rejects(runtime.changes.undo(plan), { code: 'SERVICE_CHANGED' });state.evidence.generation = old;
  const results = await Promise.all([runtime.changes.undo(plan), runtime.changes.undo(plan)]);
  assert.equal(results[0].jobId, results[1].jobId);
  await until(() => runtime.jobs.snapshot().find(j => j.id === results[0].jobId).status === 'completed');
  assert.equal(state.game.mounted, false);assert.equal(calls.filter(c => c.route.endsWith('/unmount')).length, 1);
});

test('queued mount undo rejects an externally changed mount without writing', async t => {
  const { runtime, state, calls } = await fixture(t);
  const source = await runtime.jobs.enqueue('library.mount', { titleId: state.game.title_id, mounted: true }, 'history-mount');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed');runtime.jobs.concurrency = 0;
  const reversed = await runtime.changes.undo(runtime.changes.preview(source));state.game.mounted = false;
  runtime.jobs.concurrency = 2;runtime.jobs.kick();await until(() => runtime.jobs.snapshot().find(j => j.id === reversed.jobId).status === 'failed');
  assert.equal(calls.filter(c => c.route.endsWith('/unmount')).length, 0);
});

test('caller cannot invent a prior mount state to manufacture an undoable change', async t => {
  const { runtime, state, calls } = await fixture(t);state.game.mounted = true;
  await assert.rejects(runtime.jobs.enqueue('library.mount', { titleId: state.game.title_id, mounted: true, priorMounted: false }, 'forged-prior'), { code: 'HISTORY_CONFLICT' });
  const noop = await runtime.jobs.enqueue('library.mount', { titleId: state.game.title_id, mounted: true }, 'observed-noop');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed');assert.equal(runtime.changes.preview(noop).available, false);
  assert.equal(calls.filter(c => c.route.endsWith('/mount')).length, 0);
});

test('installed packages and unavailable sources cannot enter mount queue', async t => {
  const { runtime, state } = await fixture(t); state.game.installed_pkg = true;
  await assert.rejects(runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'package-mount'), { code: 'LIBRARY_SOURCE' });
  state.game.installed_pkg = false; state.game.source_available = false;
  await assert.rejects(runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'missing-mount'), { code: 'LIBRARY_SOURCE' });
});
test('busy mount remains interrupted until the unchanged prior state is independently reconciled', async t => {
  const { runtime, state, calls } = await fixture(t); state.busy = true;
  const job = await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'busy-mount');
  await until(() => runtime.jobs.snapshot()[0].status === 'interrupted');
  await runtime.jobs.reconcile(job.id); assert.equal(runtime.jobs.snapshot()[0].status, 'failed');
  assert.equal(calls.filter(item => item.route.endsWith('/mount')).length, 1);
});
test('queued mount rejects replacement game content and never sends the write', async t => {
  const { runtime, state, calls } = await fixture(t); runtime.jobs.concurrency = 0;
  await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'changed-mount');
  state.game.path = '/data/games/replacement.ffpkg'; runtime.jobs.concurrency = 2; runtime.jobs.kick();
  await until(() => runtime.jobs.snapshot()[0].status === 'failed');
  assert.equal(runtime.jobs.snapshot()[0].error.code, 'LIBRARY_CHANGED'); assert.equal(calls.filter(item => item.route.endsWith('/mount')).length, 0);
});
test('library search is paged and periodic runtime state never duplicates the catalog', async t => {
  const { runtime, state } = await fixture(t);
  state.games = Array.from({ length: 250 }, (_, index) => ({ ...state.game, title_id: 'PPSA' + String(index).padStart(5, '0'), title_name: 'Game ' + index }));
  const page = await runtime.library.refresh(); assert.equal(page.games.length, 100); assert.equal(page.total, 250);
  const next = runtime.library.page({ offset: 200 }); assert.equal(next.games.length, 50);
  const found = runtime.library.page({ search: 'PPSA00149' }); assert.equal(found.games.length, 1); assert.equal(found.games[0].name, 'Game 149');
  assert.equal(runtime.snapshot().library.count, 250); assert.equal(runtime.snapshot().library.games, undefined);
});

test('installed games remain visible without ShadowMount and launch receipts are verified',async t=>{
 const r=await new TacRuntime(await store(),{identity:async()=>({mode:'development'}),install:async()=>{}},{id:ids()}).start();t.after(()=>r.close());
 r.nativeServices={inspect:async()=>({ready:false,reason:'ShadowMount is stopped'}),stopMonitoring(){}};let last=null,launches=0;
 installLibrary(r,{catalog:async()=>[{titleId:'CUSA00265',name:'Minecraft',contentId:'EP-CUSA00265',bytes:123}],native:{appLaunch(id,titleId){launches++;last={request:id,titleId,stage:3,currentBoot:true,appId:22,message:'Game started'};},appLaunchPoll(){return last;}},delay:async()=>{}});
 const page=await r.library.refresh();assert.equal(page.games[0].name,'Minecraft');assert.equal(page.available,true);assert.equal(page.games[0].canMount,false);
 const job=await r.execute('job.enqueue',{kind:'library.launch',input:{titleId:'CUSA00265'},key:'launch-minecraft'});
 await until(()=>r.jobs.snapshot().find(j=>j.id===job.id).status==='completed');assert.equal(launches,1);
 r.game={titleId:'PPSA00001'};await assert.rejects(r.execute('job.enqueue',{kind:'library.launch',input:{titleId:'CUSA00265'},key:'wrong-active-game'}),{code:'GAME_RUNNING'});assert.equal(launches,1);
});

test('a mount from an earlier boot expires without repeating a mount request',async t=>{
 const r=await new TacRuntime(await store(),{identity:async()=>({mode:'development'}),install:async()=>{}},{id:ids()}).start();t.after(()=>r.close());
 let calls=0;installLibrary(r,{native:{systemProbe:()=>({boot:'new-boot'})},request:async()=>{calls++;throw Error('must not call');}});
 const handler=r.jobs.handlers.get('library.mount'),job={args:{service:{boot:'old-boot'}}};
 const result=await handler.reconcile(job);assert.equal(result.expired,true);assert.equal(await handler.verifyExpired(result,job),true);assert.equal(calls,0);
 assert.equal(await handler.verifyExpired({...result,boot:'wrong'},job),false);
});
