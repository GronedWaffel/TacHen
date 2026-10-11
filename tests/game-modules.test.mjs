import test from 'node:test';
import assert from 'node:assert/strict';
import { installPlugins } from '../src/plugins.mjs';
import { JobQueue } from '../src/jobs.mjs';
import { SessionHistory } from '../src/history.mjs';
import { store, ids, until, deferred } from './helpers.mjs';
const hash = 'a'.repeat(64), upload = 'b'.repeat(32), boot = '100:0';
const game = { pid: 77, generation: boot + '/77/110:0', titleId: 'PPSA00001', version: '01.000.000', platform: 'ps5', metadataHash: 'c'.repeat(64) };
const info = { id: upload, sha256: hash, name: 'test.sprx', format: 'sprx', platform: 'ps5' };
async function setup(options = {}, moduleInfo = info) {
  const saved = await store(), id = ids(), runtime = { store: saved, id, graph: { safe: false }, sequence: 0, game: null,
    capability() {}, inbox: { verify: async () => ({ ...moduleInfo }) }, jobs: new JobQueue(saved, { id }) };
  runtime.now = Date.now;runtime.session = id();runtime.changes = new SessionHistory(runtime);
  let receipt = null, calls = 0; const probe = { boot, processes: [], kstuff: { injectionReady: true } };
  const native = { systemProbe: () => probe, gameModulePoll: () => receipt,
    gameModuleStart(request, file, sha256, pid, generation, titleId, metadata, extension) {
      calls++; assert.deepEqual([file, sha256, pid, titleId, metadata, extension], [upload, hash, game.pid, game.titleId, game.metadataHash, 'sprx']);
      receipt = { request, sha256, pid, generation, stage: 4, handle: 12, startResult: 0 };
    } };
  const plugins = installPlugins(runtime, native, options);
  await plugins.register({ upload, scope: 'game', target: { titleId: game.titleId, version: game.version }, revision: saved.snapshot().revision });
  const active = value => { runtime.game = value ? { ...value } : null; probe.processes = value ? [{ pid: value.pid, generation: value.generation }] : []; };
  return { runtime, plugins, native, probe, active, calls: () => calls, setReceipt: value => receipt = value, receipt: () => receipt };
}
const start = (env, key = 'manual-module') => env.runtime.jobs.enqueue('game.module.start', { sha256: hash, source: 'manual' }, key);
const autostart = env => env.plugins.configure({ sha256: hash, autostart: true, revision: env.runtime.store.snapshot().revision });

test('SDK rejection retains game ownership without blocking unrelated payload dispatch', async () => {
  const env=await setup();env.active(game);
  env.native.gameModuleStart=request=>env.setReceipt({request,sha256:hash,pid:game.pid,generation:game.generation,
    stage:5,handle:0x80020063|0,startResult:0,message:'SDK version rejected'});
  await start(env);await until(()=>env.runtime.jobs.snapshot()[0]?.status==='interrupted');
  assert.deepEqual(env.runtime.jobs.snapshot()[0].resources,['game-modules:'+game.generation]);
  let sent=0;
  env.runtime.jobs.register('test.payload',{validate:input=>input,resources:()=>['native-payload-dispatch'],
    timeout:1000,cancellable:false,run:async()=>{sent++;return {completed:true,sent:true};},verify:async result=>result.sent===true});
  await env.runtime.jobs.enqueue('test.payload',{},'separate-payload');
  await until(()=>env.runtime.jobs.snapshot().some(job=>job.kind==='test.payload'&&job.status==='completed'));
  assert.equal(sent,1);
  assert.equal(env.runtime.jobs.snapshot().find(job=>job.kind==='game.module.start').status,'interrupted');
  await assert.rejects(start(env,'no-duplicate-module'),{code:'MODULE_ALREADY_ATTEMPTED'});
});

test('manual module load waits out a brief native census collision without dispatching twice', async () => {
  const gate=deferred(),env=await setup({delay:()=>gate.promise});env.active(game);env.probe.busy=true;
  const pending=start(env);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(env.calls(),0);
  env.probe.busy=false;gate.resolve();await pending;
  await until(()=>env.runtime.jobs.snapshot()[0]?.status==='completed');assert.equal(env.calls(),1);
});

test('game changed during native contention never receives the queued module', async () => {
  const gate=deferred(),env=await setup({delay:()=>gate.promise});env.active(game);env.probe.busy=true;
  const pending=start(env),rejected=assert.rejects(pending,{code:'MODULE_GAME'});
  await new Promise(resolve=>setTimeout(resolve,10));env.active({...game,generation:boot+'/77/222:0'});
  env.probe.busy=false;gate.resolve();await rejected;assert.equal(env.calls(),0);
});

test('old autostart configuration and automatic API requests cannot launch a module', async () => {
 const env=await setup();env.active(game);
 await env.runtime.store.transaction(state=>{state.plugins[0].autostart=true;});
 assert.equal(env.plugins.entries()[0].autostart,false);
 await assert.rejects(autostart(env),{code:'PLUGIN_MANUAL_ONLY'});
 await assert.rejects(env.runtime.jobs.enqueue('game.module.start',{sha256:hash,source:'automatic'},'old-client'),{code:'PLUGIN_MANUAL_ONLY'});
 await env.plugins.refresh();assert.equal(env.calls(),0);assert.equal(env.runtime.jobs.snapshot().length,0);
 assert.equal(env.plugins.list()[0].controls.canStart,true);
});

test('simultaneous module requests are deduplicated after asynchronous file verification', async () => {
  const env=await setup(),gate=deferred();env.active(game);let verifies=0;
  env.runtime.inbox.verify=async()=>{if(++verifies<=2)await gate.promise;return {...info};};
  const first=start(env,'first-click'),second=start(env,'second-click');
  const results=Promise.allSettled([first,second]);await until(()=>verifies===2);gate.resolve();
  const settled=await results;assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(settled.find(r=>r.status==='rejected').reason.code,'MODULE_ALREADY_ATTEMPTED');
  await until(()=>env.runtime.jobs.snapshot()[0]?.status==='completed');assert.equal(env.calls(),1);
});

test('game lifecycle updates manual controls without loading code', async () => {
 const env=await setup(),listeners=new Set();env.runtime.gameLifecycle={subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
 env.plugins.start();await env.plugins.pending;
 try{env.active(game);await Promise.all([...listeners].map(fn=>fn({type:'start',game})));
 assert.equal(env.calls(),0);assert.equal(env.plugins.list()[0].controls.canStart,true);
 env.active(null);await Promise.all([...listeners].map(fn=>fn({type:'exit',game:null})));
 assert.equal(env.plugins.list()[0].controls.canStart,false);
 }finally{env.plugins.stop();}
});

test('shared development FSELF reaches native dispatch using its registered PS5 target', async () => {
  const env=await setup({}, {...info,container:'self',platform:null});
  assert.equal(env.plugins.entries()[0].platform,'ps5');env.active(game);await start(env);
  await until(()=>env.runtime.jobs.snapshot()[0]?.status==='completed');assert.equal(env.calls(),1);
});

test('a completed module from the closed game does not disable Load into game for a reopened instance', async () => {
  const env=await setup();env.active(game);await start(env);
  await until(()=>env.runtime.jobs.snapshot()[0]?.status==='completed');await env.plugins.refresh();
  assert.equal(env.plugins.list()[0].controls.canStart,false);
  // GameLifecycle identifies the new instance before the slower plugin poll.
  env.active({...game,generation:boot+'/77/222:0'});
  assert.equal(env.plugins.list()[0].controls.canStart,true);
  await start(env,'reopened-game');await until(()=>env.runtime.jobs.snapshot()[1]?.status==='completed');
  await env.plugins.refresh();assert.equal(env.calls(),2);assert.equal(env.plugins.list()[0].controls.canStart,false);
});

test('short owned controller exchange does not overwrite plugin status with an uncertain state', async () => {
  const env=await setup();env.active(game);await env.plugins.refresh();
  const before=env.plugins.list()[0].observation;env.probe.busy=true;
  env.runtime.gameInputRelay={observationBusy:()=>true};await env.plugins.refresh();
  assert.deepEqual(env.plugins.list()[0].observation,before);assert.equal(env.plugins.deferred,true);
  env.probe.busy=false;await env.plugins.refresh();assert.equal(env.plugins.deferred,false);
});

test('native module preparation failure keeps the actual reason instead of a generic operation failure', async () => {
  const env=await setup();env.active(game);
  env.native.gameModuleStart=()=>{throw Object.assign(Error('Native game module operation could not be completed'),{code:'MODULE_NATIVE'});};
  await start(env);await until(()=>env.runtime.jobs.snapshot()[0].status==='interrupted');
  assert.equal(env.runtime.jobs.snapshot()[0].error.code,'MODULE_NATIVE');
});

test('native modules register before a game, but only an exact platform/title/version can start them', async () => {
  const env = await setup(); assert.equal(env.plugins.entries()[0].format, 'sprx');
  await assert.rejects(start(env), { code: 'MODULE_GAME' });
  await env.plugins.refresh(); assert.equal(env.calls(), 0); assert.equal(env.plugins.list()[0].observation.phase, 'stopped');
  env.active({ ...game, version: '01.001.000' }); await assert.rejects(start(env), { code: 'MODULE_GAME' });
  env.active({ ...game, platform: 'ps4' }); await assert.rejects(start(env), { code: 'MODULE_GAME' });
  assert.equal(env.calls(), 0);
});
test('module initializer success is bound to one game instance and duplicate manual loads are blocked', async () => {
  const env = await setup(); env.active(game); const job = await start(env);
  await until(() => env.runtime.jobs.snapshot()[0].status === 'completed');
  const result = env.runtime.jobs.snapshot()[0].result;
  assert.equal(result.phase, 'module-started'); assert.equal(result.initialized, true); assert.equal(result.generation, game.generation);
  assert.equal((await start(env)).id, job.id); assert.equal(env.calls(), 1);
  await assert.rejects(start(env, 'another-module-request'), { code: 'MODULE_ALREADY_ATTEMPTED' });
  await env.plugins.refresh(); assert.equal(env.plugins.list()[0].observation.phase, 'module-started');
  await env.plugins.configure({ sha256: hash, autostart: false, revision: env.runtime.store.snapshot().revision });
  await env.plugins.refresh(); assert.equal(env.plugins.list()[0].observation.phase, 'module-started');
});
test('manual PRX loads once per game instance, then can load again after a verified new instance', async () => {
  const env = await setup(); env.active(game); await start(env);
  await until(() => env.runtime.jobs.snapshot()[0]?.status === 'completed');
  await env.plugins.refresh(); assert.equal(env.calls(), 1);
  env.active({ ...game, generation: boot + '/77/111:0' }); await env.plugins.refresh();await start(env,'new-instance');
  await until(() => env.runtime.jobs.snapshot()[1]?.status === 'completed'); assert.equal(env.calls(), 2);
});
test('a game changing during file verification or before native dispatch is not modified', async () => {
  const env = await setup(); env.active(game);
  env.runtime.inbox.verify = async () => { env.active({ ...game, generation: boot + '/77/111:0' }); return { ...info }; };
  await assert.rejects(start(env), { code: 'MODULE_CHANGED' }); assert.equal(env.calls(), 0);
});
test('changing the game while the native guard is busy prevents a delayed manual load', async () => {
 const gate=deferred(),env=await setup({delay:()=>gate.promise});env.active(game);let attempts=0;
 env.native.gameModuleStart=()=>{attempts++;throw Object.assign(Error('busy'),{code:'NATIVE_BUSY'});};
 await start(env);await until(()=>attempts===1);env.active(null);gate.resolve();
 await until(()=>env.runtime.jobs.snapshot()[0].status==='failed');assert.equal(attempts,1);
});

test('a positive module handle with failed initialization never becomes a successful load', async () => {
  const env = await setup(); env.active(game); let calls = 0;
  env.native.gameModuleStart = request => { calls++; env.setReceipt({ request, sha256: hash, pid: game.pid, generation: game.generation, stage: 5,
    handle: 12, startResult: -1, message: 'initializer failed' }); };
  await start(env); await until(() => env.runtime.jobs.snapshot()[0]?.status === 'interrupted');
  await env.plugins.refresh(); assert.equal(calls, 1);
  await assert.rejects(env.runtime.jobs.reconcile(env.runtime.jobs.snapshot()[0].id), { code: 'OUTCOME_UNKNOWN' });
  env.active(null); await env.runtime.jobs.reconcile(env.runtime.jobs.snapshot()[0].id);
  assert.equal(env.runtime.jobs.snapshot()[0].result.phase, 'game-ended'); assert.equal(env.runtime.jobs.snapshot()[0].result.initialized, false);
});
test('malformed or another game instance receipt cannot claim initialization', async () => {
  for (const altered of [{ generation: boot + '/77/111:0' }, { handle: -1 }, { startResult: -1 }, { sha256: 'd'.repeat(64) }]) {
    const env = await setup(); env.active(game);
    env.native.gameModuleStart = request => env.setReceipt({ request, sha256: hash, pid: game.pid, generation: game.generation, stage: 4, handle: 12, startResult: 0, ...altered });
    await start(env); await until(() => env.runtime.jobs.snapshot()[0].status === 'interrupted');
    assert.equal(env.runtime.jobs.snapshot()[0].error.code, 'MODULE_RECEIPT');
  }
});
test('module waiting for input can settle after a proven game exit, while unknown census holds it', async () => {
  const env = await setup(); env.active(game);
  env.native.gameModuleStart = request => env.setReceipt({ request, sha256: hash, pid: game.pid, generation: game.generation, stage: 3 });
  const handler = env.runtime.jobs.handlers.get('game.module.start'), input = await handler.validate({ sha256: hash, source: 'manual' });
  env.probe.processes = [{ pid: game.pid, generation: '' }]; assert.equal(env.plugins.modules.ended(input, 'request'), null);
  env.probe.busy = true; env.probe.processes = []; assert.equal(env.plugins.modules.ended(input, 'request'), null);
  env.probe.busy = false;
  const running = handler.run(input, { id: 'e'.repeat(32), signal: new AbortController().signal, progress: async () => {} });
  const result = await running; assert.equal(result.phase, 'game-ended'); assert.equal(result.initialized, false);
});
test('PRX cannot run through the process loader and wrong SELF platform cannot register', async () => {
  const env = await setup(); env.active(game);
  await assert.rejects(env.runtime.jobs.enqueue('plugin.start', { sha256: hash, source: 'manual' }, 'wrong-loader'), { code: 'PLUGIN_FORMAT' });
  env.runtime.inbox.verify = async () => ({ ...info, platform: 'ps4', sha256: 'f'.repeat(64) });
  await assert.rejects(env.plugins.register({ upload, scope: 'game', target: { titleId: game.titleId, version: game.version },
    revision: env.runtime.store.snapshot().revision }), { code: 'PLUGIN_TARGET' });
});

test('an ended game releases an unresolved module operation before a new manual load', async () => {
  const env = await setup(); env.active(game);
  const successful = env.native.gameModuleStart;
  env.native.gameModuleStart = request => env.setReceipt({ request, sha256: hash, pid: game.pid, generation: game.generation, stage: 6, message: 'Result unavailable' });
  await start(env); await until(() => env.runtime.jobs.snapshot()[0]?.status === 'interrupted');
  env.active({ ...game, generation: boot + '/77/111:0' });
  env.native.gameModuleStart = successful; await env.plugins.refresh();await start(env,'new-after-exit');
  await until(() => env.runtime.jobs.snapshot()[1]?.status === 'completed');
  assert.equal(env.runtime.jobs.snapshot()[0].result.phase, 'game-ended'); assert.equal(env.calls(), 1);
});

test('unknown receipt remains held across same-boot ambiguity, while a verified later boot proves the old game ended', async () => {
  const env = await setup(); env.active(game);
  const handler = env.runtime.jobs.handlers.get('game.module.start'), input = await handler.validate({ sha256: hash, source: 'manual' });
  env.probe.processes = [{ pid: game.pid, generation: '' }]; assert.equal(env.plugins.modules.ended(input, 'request'), null);
  env.probe.boot = '200:0';
  assert.equal(env.plugins.modules.ended(input, 'request').phase, 'game-ended');
  env.probe.boot = ''; assert.equal(env.plugins.modules.ended(input, 'request'), null);
});

test('module initialization timeout preserves an uncertain attempt instead of replaying it', async () => {
  const controller = new AbortController(), env = await setup({ delay: async () => controller.abort() }); env.active(game);
  env.native.gameModuleStart = request => env.setReceipt({ request, sha256: hash, pid: game.pid, generation: game.generation, stage: 3 });
  const handler = env.runtime.jobs.handlers.get('game.module.start'), input = await handler.validate({ sha256: hash, source: 'manual' });
  await assert.rejects(handler.run(input, { id: 'f'.repeat(32), signal: controller.signal, progress: async () => {} }), { code: 'MODULE_TIMEOUT' });
});


test('native contention preserves loaded instance identity so reopening does not grey out the module', async () => {
  const env=await setup();env.active(game);await start(env);
  await until(()=>env.runtime.jobs.snapshot()[0]?.status==='completed');await env.plugins.refresh();
  env.probe.busy=true;await env.plugins.refresh();
  assert.equal(env.plugins.list()[0].observation.generation,game.generation);
  assert.equal(env.plugins.list()[0].controls.canStart,false);
  env.active({...game,generation:boot+'/77/222:0'});
  assert.equal(env.plugins.list()[0].controls.canStart,true);
  env.probe.busy=false;await start(env,'after-contention');
  await until(()=>env.runtime.jobs.snapshot()[1]?.status==='completed');assert.equal(env.calls(),2);
});

test('proven game exit reconciles an unreadable old receipt without authorizing a same-instance retry', async () => {
  const env=await setup();env.active(game);
  env.native.gameModuleStart=request=>env.setReceipt({request,sha256:hash,pid:game.pid,generation:game.generation,stage:6,message:'Unknown'});
  await start(env);await until(()=>env.runtime.jobs.snapshot()[0]?.status==='interrupted');
  env.native.gameModulePoll=()=>{throw Error('Old receipt unavailable');};
  await assert.rejects(env.runtime.jobs.reconcile(env.runtime.jobs.snapshot()[0].id));
  env.active(null);await env.runtime.jobs.reconcile(env.runtime.jobs.snapshot()[0].id);
  assert.equal(env.runtime.jobs.snapshot()[0].result.phase,'game-ended');
});
