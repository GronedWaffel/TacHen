import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { StateStore } from '../src/store.mjs';
import { installNativeServices } from '../src/native-services.mjs';
import { installConsoleDeck } from '../src/native-deck.mjs';
import { ConsoleDeck } from '../src/deck.mjs';
import { checksum, memoryStorage, ids, until, deferred } from './helpers.mjs';
const sequence = ids(), hashes = { kstuff: 'a'.repeat(64), shadowmount: 'b'.repeat(64), 'payload-manager': 'c'.repeat(64) };
export async function fixture({ disk = memoryStorage(), safe = false, fail = null, model = null } = {}) {
  const state = model || { boot: 'boot-one', kstuff: { state: 'unmodified', injectionReady: false },
    processes: [{ pid: 77, name: 'SceShellUI', thread: '', generation: 'boot-one/77/start' }], ports: { shadowmount: 0, 'payload-manager': 0 }, receipts: new Map(), decks: new Map() };
  const calls = [], saved = await new StateStore(disk, checksum).open();
  if (safe) await saved.transaction(s => { s.startup.safe = true; });
  let r;
  const native = { systemProbe: () => ({ ...state, processes: state.processes.map(p => ({ ...p })), kstuff: { ...state.kstuff }, ports: { ...state.ports } }),
    managerPrepare: () => calls.push('config'),
    loaderStart(request, upload, hash) {
      assert(r.store.snapshot().startup.pending);const component = Object.keys(hashes).find(id => hashes[id] === hash);calls.push(component);
      const receipt = { request, sha256: hash, stage: 3, pid: 50, boot: state.boot };
      if (fail === 'clean-once') { fail = null;receipt.stage = 4;receipt.noSideEffects = true;receipt.message = 'Rejected before execution'; }
      else if (fail !== 'no-ready') {
        if (component === 'kstuff') state.kstuff = { state: 'installed', injectionReady: true };
        else { state.processes.push({ pid: component === 'shadowmount' ? 50 : 51, name: component === 'payload-manager' ? 'pldmgr.elf' : 'shadowmount.elf', thread: '', generation: state.boot + '/' + component });state.ports[component] = 1; }
      }
      state.receipts.set(request, receipt);
    }, loaderPoll: request => state.receipts.get(request) || null,
    deckStart(request, pid, generation) { calls.push('native-deck');state.decks.set(request, { request, boot: state.boot, pid, generation, stage: 3, ready: true, noSideEffects: false }); },
    deckPoll: request => state.decks.get(request) || null };
  const get = async (_, route) => ({ text: route === '/api/v1/version' ? JSON.stringify({ status: 0, api_version: 1, shadowmount_version: '1.7beta4', capabilities: ['list_games','storage_job_status','mount_game'] }) :
    route === '/version' ? '0.5.2' : JSON.stringify({ AUTOLOAD_ENABLED: false, AUTO_BROWSER_OPEN: false, KILL_DISC_PLAYER_ON_STARTUP: false, AUTO_INSTALL_APP: false }) });
  const assets = { get: id => ({ sha256: hashes[id] }), ensure: async id => ({ id: hashes[id].slice(0,32), sha256: hashes[id] }) };
  r = await new TacRuntime(saved, { identity: async () => ({ mode: 'development', firmware: '13.60', ip: '127.0.0.1' }), install(runtime) {
    runtime.inbox = { verify: async id => ({ id, sha256: Object.values(hashes).find(hash => hash.startsWith(id)), format: 'elf' }) };
    runtime.graph.register({ id: 'coordinator', start: () => ({}), verify: () => true });
    runtime.nativeServices = installNativeServices(runtime, native, assets, { get, timeout: 20, delay: () => new Promise(resolve => setTimeout(resolve, 1)) });
    installConsoleDeck(runtime, native, { timeout: 20, delay: () => new Promise(resolve => setTimeout(resolve, 1)) });
  } }, { id: sequence }).start();
  return { runtime: r, state, calls, disk, native };
}
const finish = async r => { await until(() => !r.recovery.pending && !r.jobs.running.size);return r.snapshot().recovery; };

test('ordered native startup promotes known-good preferences only after every configured service passes verification', async () => {
  const f = await fixture(), r = f.runtime;
  await r.settings({ appearance: { accent: 'ice' } }, r.snapshot().revision);
  assert.equal(r.snapshot().recovery.knownGood, null);
  const a = r.nativeServices.startConfigured(), b = r.nativeServices.startConfigured();assert.equal(a,b);await a;
  assert.deepEqual(f.calls, ['kstuff','native-deck','shadowmount','config','payload-manager']);
  assert.equal(r.store.snapshot().knownGood.appearance.accent, 'ice');assert.equal(r.store.snapshot().startup.pending, false);
  assert.equal(r.store.snapshot().knownGood.developer.enabled, false);assert.equal(r.snapshot().recovery.last.status, 'ready');await r.close();
});

test('safe startup is read-only until a reviewed confirmation; clean failures can retry once with a new durable request', async () => {
  const f = await fixture({ fail: 'clean-once' }), r = f.runtime;
  await r.nativeServices.startConfigured();assert(r.graph.safe);assert.equal(r.store.snapshot().knownGoodReceipt, null);
  const plan = await r.execute('startup.preview', {});assert(plan.available);assert.deepEqual(f.calls,['kstuff']);
  await r.execute('startup.resume', { proof: plan.proof });await finish(r);
  assert.equal(r.graph.safe,false);assert.equal(f.calls.filter(x => x === 'kstuff').length,2);
  const jobs=r.jobs.snapshot().filter(j=>j.kind==='component.start'&&j.args.component==='kstuff');assert.notEqual(jobs[0].key,jobs[1].key);
  assert.equal(jobs[0].status,'failed');assert.equal(jobs[1].status,'completed');await r.close();
});

test('absent-looking hooks with a dispatched but unconfirmed attempt remain blocked in the same boot', async () => {
  const f = await fixture({ fail: 'no-ready' }), r=f.runtime;await r.nativeServices.startConfigured();await finish(r);
  const plan=await r.recovery.preview();assert.equal(plan.available,false);assert(plan.blockers.some(b=>b.includes('uncertain')));
  await assert.rejects(r.recovery.resume({proof:plan.proof}),{code:'RECOVERY_BLOCKED'});assert.deepEqual(f.calls,['kstuff']);await r.close();
});

test('an observed new boot releases only expired kernel startup work without claiming its earlier result succeeded', async () => {
  const f=await fixture({fail:'no-ready'}), r=f.runtime;await r.nativeServices.startConfigured();await finish(r);await r.close();
  f.state.boot='boot-two';f.state.processes[0].generation='boot-two/77/start';
  const next=await fixture({disk:f.disk,model:f.state}), n=next.runtime;
  assert(n.graph.safe);const plan=await n.recovery.preview();assert(plan.available);
  await n.recovery.resume({proof:plan.proof});await finish(n);
  assert.equal(n.graph.safe,false);const old=n.jobs.snapshot().find(j=>j.session===r.session);
  assert.equal(old.error.code,'PREVIOUS_BOOT_ENDED');assert.equal(old.result.priorOutcome,'unknown');
  assert.equal(next.calls.filter(x=>x==='kstuff').length,1);await n.close();
});

test('a hot coordinator replacement cannot adopt a renderer carrying the earlier private credential', async () => {
  const f=await fixture();await f.runtime.nativeServices.startConfigured();await f.runtime.close();
  const next=await fixture({disk:f.disk,model:f.state,safe:true}), plan=await next.runtime.recovery.preview();
  assert(!plan.available);assert(plan.blockers.some(b=>b.includes('earlier coordinator')));assert.deepEqual(next.calls,[]);await next.runtime.close();
});

test('review proof is invalidated by settings changes, boot changes and replacement service identities', async () => {
  const f=await fixture(), r=f.runtime;await r.nativeServices.startConfigured();
  let plan=await r.recovery.preview();await r.settings({appearance:{accent:'ice'}},r.snapshot().revision);
  await assert.rejects(r.recovery.resume({proof:plan.proof}),{code:'RECOVERY_CHANGED'});
  plan=await r.recovery.preview();f.state.processes.find(p=>p.name==='shadowmount.elf').generation='replacement';
  await assert.rejects(r.recovery.resume({proof:plan.proof}),{code:'RECOVERY_CHANGED'});
  plan=await r.recovery.preview();f.state.boot='boot-two';
  await assert.rejects(r.recovery.resume({proof:plan.proof}),{code:'RECOVERY_CHANGED'});await r.close();
});

test('review rejects configuration changes while asynchronous service inspection is in progress', async () => {
  const f=await fixture({safe:true}),r=f.runtime,gate=deferred();let inspecting=false;
  const definition=r.graph.definitions.get('shadowmount'),inspect=definition.inspect;
  definition.inspect=async()=>{inspecting=true;await gate.promise;return inspect();};
  const review=r.recovery.preview(),rejected=assert.rejects(review,{code:'RECOVERY_CHANGED'});
  await until(()=>inspecting);await r.settings({services:{shadowmount:false}},r.snapshot().revision);
  gate.resolve();await rejected;assert.deepEqual(f.calls,[]);assert(!r.recovery.pending);await r.close();
});

test('reviewed revision is rechecked when the durable startup reservation commits', async () => {
  const f=await fixture({safe:true}),r=f.runtime,gate=deferred();
  const plan=await r.recovery.preview();
  // A previously accepted configuration write is still waiting on storage.
  const change=r.store.transaction(async state=>{await gate.promise;state.settings.services.shadowmount=false;});
  await r.recovery.resume({proof:plan.proof});assert(r.recovery.pending);gate.resolve();await change;await finish(r);
  assert.deepEqual(f.calls,[]);assert(r.graph.safe);assert.equal(r.snapshot().recovery.last.error.code,'STATE_CHANGED');
  assert.equal(r.store.snapshot().knownGoodReceipt,null);await r.close();
});

test('failed durable intent prevents launches and failed failure-journaling halts the queue', async () => {
  const f=await fixture();f.disk.fail=true;
  await assert.rejects(f.runtime.nativeServices.startConfigured(),/disk full/);
  assert.deepEqual(f.calls,[]);assert(f.runtime.graph.safe);assert(f.runtime.jobs.halted);assert.equal(f.runtime.store.snapshot().knownGoodReceipt,null);
  f.disk.fail=false;await f.runtime.close();
});

test('startup holds unrelated native jobs, while idempotent retries of accepted work keep their recorded identity', async () => {
  const f=await fixture(), r=f.runtime, gate=deferred();let entered=false;
  r.graph.definitions.get('kstuff').start=async()=>{entered=true;await gate.promise;return {ready:true};};
  r.jobs.register('test.native',{validate:async()=>({}),resources:()=>[],run:async()=>({completed:true}),verify:()=>true});
  const prior=await r.jobs.enqueue('test.native',{},'accepted-before-startup');await until(()=>r.jobs.snapshot().find(j=>j.id===prior.id)?.status==='completed');await until(()=>!r.jobs.running.size);
  const work=r.nativeServices.startConfigured();await until(()=>entered);
  await assert.rejects(r.jobs.enqueue('test.native',{},'unrelated-during-startup'),{code:'STARTUP_BUSY'});
  assert.equal((await r.jobs.enqueue('test.native',{},'accepted-before-startup')).id,prior.id);
  gate.resolve();await work;await r.close();
});

test('controller recovery review and confirmation use the same guarded startup API as the phone', async () => {
  const f=await fixture({safe:true}), r=f.runtime, deck=new ConsoleDeck(r);
  const select=async row=>deck.action({kind:'select',row,sequence:deck.frame().sequence,request:r.id()});
  await select(deck.frame().rows.findIndex(row=>row.command==='$startup-review'));
  assert.deepEqual(f.calls,[]);let row=deck.frame().rows.findIndex(row=>row.command==='startup.resume');assert(row>=0);
  await select(row);assert(deck.confirmation);assert.deepEqual(f.calls,[]);
  await select(0);await finish(r);assert.equal(r.graph.safe,false);assert.equal(f.calls.filter(x=>x==='native-deck').length,1);await r.close();
});

test('a job validating across startup reservation is rejected before durable acceptance or native execution', async () => {
  const f=await fixture(),r=f.runtime,validation=deferred(),startup=deferred();let entered=false,executions=0;
  r.jobs.register('test.native',{validate:async()=>{await validation.promise;return {};},resources:()=>[],run:async()=>{executions++;return {completed:true};},verify:()=>true});
  const operation=r.jobs.enqueue('test.native',{},'crossing-startup-validation');
  const rejected=assert.rejects(operation,{code:'STARTUP_BUSY'});
  r.graph.definitions.get('kstuff').start=async()=>{entered=true;await startup.promise;return {ready:true};};
  const launch=r.nativeServices.startConfigured();await until(()=>entered);validation.resolve();await rejected;
  assert(!r.jobs.snapshot().some(j=>j.kind==='test.native'));assert.equal(executions,0);startup.resolve();await launch;await r.close();
});
