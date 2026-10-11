import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ConsoleDeck, encodeDeck, DECK_WIRE } from '../src/deck.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { serve } from '../src/server.mjs';
import { store, ids } from './helpers.mjs';
async function fixture(t) {
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }), install: async () => {} }, { id: ids() }).start();
  runtime.consoleDeck = new ConsoleDeck(runtime); runtime.deckCredential = runtime.id(); t.after(() => runtime.close());
  return runtime;
}
function action(runtime, kind, row = 0) { return { kind, row, sequence: runtime.consoleDeck.frame().sequence, request: runtime.id() }; }

for(const reject of [false,true])test(`native sync preserves heartbeats and exact-once action while slow work ${reject?'rejects':'completes'}`,async t=>{
 const runtime=await fixture(t),deck=runtime.consoleDeck;
 const server=await serve(runtime,{host:'127.0.0.1',port:0,id:runtime.id,uiRoot:path.resolve('ui')});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 let release,calls=0;const held=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 runtime.execute=async()=>{calls++;await held;if(reject)throw new Error('Checked action could not start');return {};};
 deck.confirmation={label:'Slow checked action',detail:'Test',command:'service.start',args:{id:'payload-manager'}};
 const request=action(runtime,'select'),headers={'X-TacHen-Native':runtime.deckCredential,'Content-Type':'application/json'};
 const send=async input=>{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/native/deck/sync`,{
   method:'POST',headers,body:JSON.stringify({action:input}),signal:AbortSignal.timeout(1000)});
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,DECK_WIRE.bytes);
  assert.equal(bytes.readUInt32LE(),DECK_WIRE.magic);return {status:response.status,text:bytes.toString()};
 };
 for(let i=0;i<4;i++){const response=await send(request);assert.equal(response.status,202);assert.match(response.text,/Working/);}
 assert.equal(calls,1);assert.equal((await send(null)).status,200);
 release();const response=await send(request);assert.equal(response.status,200);
 assert.match(response.text,reject?/Checked action could not start/:/Updated/);
 assert.equal((await send(request)).status,200);assert.equal(calls,1);
});

test('live metric updates preserve pending controller selections and action tokens', async t => {
  const runtime = await fixture(t), deck = runtime.consoleDeck;
  runtime.capability('fps', true);await runtime.settings({ overlay: { fps: true } }, runtime.snapshot().revision);
  runtime.game = { titleId: 'PPSA00001', version: '01.000.000', name: 'Test game', pid: 40, generation: 'one' };
  let fps = 60;runtime.telemetry = { snapshot: () => ({ fps, fpsSource: 'agc-ring' }), stop() {} };
  const first = deck.frame(), request = action(runtime, 'next');fps = 59.9;
  const next = deck.frame();assert.equal(next.sequence, first.sequence);assert.deepEqual(next.rows, first.rows);
  assert.notEqual(next.metricsSequence, first.metricsSequence);assert.match(next.metrics, /59.9/);
  await deck.action(request);assert.equal(deck.frame().page, 1);
});
test('native renderer availability is never inferred from phone availability', async t => {
  const runtime = await fixture(t);
  assert.equal(runtime.capabilities.get('deck').available, false); assert.equal(runtime.capabilities.get('phone').available, true);
  assert.ok(!JSON.stringify(runtime.snapshot()).includes('deckCredential'));
});

test('Home confirmations explicitly route Circle back instead of closing the native deck', async t => {
  const runtime=await fixture(t),deck=runtime.consoleDeck;
  assert.equal(deck.frame().canBack,false);
  deck.confirmation={label:'Example operation',detail:'Review before starting',command:'unused',args:{}};
  const nested=deck.frame();assert.equal(nested.canBack,true);assert.equal(encodeDeck(nested).readUInt16LE(6)&4,4);
  await deck.action(action(runtime,'back'));
  assert.equal(deck.confirmation,null);assert.equal(deck.frame().page,0);assert.equal(deck.frame().canBack,false);
});

test('package transfer step navigation returns to its parent before returning to the list',async t=>{
 const runtime=await fixture(t),deck=runtime.consoleDeck;deck.page=3;deck.transferView={section:'active'};
 const parent={id:runtime.id(),kind:'package.receive',status:'interrupted'},child={id:runtime.id(),kind:'package.install',status:'interrupted'};parent.checkpoint={install:child.id};
 runtime.jobs.snapshot=()=>[parent,child];
 await deck.action(action(runtime,'select',0));assert.equal(deck.transferView.id,parent.id);
 const row=deck.frame().rows.findIndex(x=>x.command==='$transfer-open');await deck.action(action(runtime,'select',row));assert.equal(deck.transferView.id,child.id);
 await deck.action(action(runtime,'back'));assert.equal(deck.transferView.id,parent.id);
 await deck.action(action(runtime,'back'));assert.equal(deck.transferView.id,undefined);
});
test('deck and phone share optimistic settings; stale controller selections do not overwrite phone changes', async t => {
  const runtime = await fixture(t), deck = runtime.consoleDeck;
  await deck.action(action(runtime, 'previous')); assert.equal(deck.frame().page, 5);
  await deck.action(action(runtime, 'previous')); assert.equal(deck.frame().page, 4);
  const motion=()=>deck.frame().rows.findIndex(row=>row.label==='Reduced motion');
  const old = action(runtime, 'select', motion());
  await runtime.settings({ appearance: { reducedMotion: true } }, runtime.snapshot().revision);
  await assert.rejects(deck.action(old), { code: 'DECK_STALE' });
  await deck.action(action(runtime, 'select', motion())); assert.equal(runtime.snapshot().settings.appearance.reducedMotion, false);
});
test('payload loads with one selection, duplicate controller requests execute once', async t => {
  const runtime = await fixture(t), deck = runtime.consoleDeck;
  runtime.capability('payloads', true); runtime.inboxItems = [{ id: runtime.id(), name: 'test.elf', status: 'verified' }];
  const calls = []; runtime.execute = async (...args) => calls.push(args);
  await deck.action(action(runtime, 'next'));
  await deck.action(action(runtime, 'select',deck.frame().rows.findIndex(r=>r.label==='Downloads')));
  await deck.action(action(runtime, 'select',deck.frame().rows.findIndex(r=>r.label==='test.elf')));
  const confirm = action(runtime, 'select',deck.frame().rows.findIndex(r=>r.label==='Load payload')); await Promise.all([deck.action(confirm), deck.action(confirm)]);
  assert.equal(deck.confirmation,null);assert.equal(calls.length, 1); assert.equal(calls[0][1].kind, 'payload.dispatch'); assert.equal(calls[0][1].key, confirm.request);
  assert.throws(() => deck.action({ ...confirm, row: 1 }), { code: 'DECK_REQUEST_REUSED' });
});
test('long game lists paginate and mount requests bind the displayed source identity', async t => {
  const runtime = await fixture(t), deck = runtime.consoleDeck;
  runtime.capability('shadowmount', true); runtime.library = {};
  runtime.libraryState = { error: null, games: Array.from({ length: 20 }, (_, i) => ({ name: 'Game ' + i, titleId: 'PPSA' + String(i).padStart(5, '0'),
    contentId: 'content' + i, path: '/data/games/' + i, platform: 'ps5', mounted: false, canMount: true, sourceAvailable: true })) };
  await deck.action(action(runtime, 'next')); await deck.action(action(runtime, 'next'));
  assert.equal(deck.frame().rows.length, 7); await deck.action(action(runtime, 'select', 6));
  assert.equal(deck.frame().rows.length, 8); assert.equal(deck.frame().rows[0].label, 'Game 5');
  await deck.action(action(runtime, 'select'));
  await deck.action(action(runtime,'select',deck.frame().rows.findIndex(r=>r.label==='Mount game'))); const calls = []; runtime.execute = async (...args) => calls.push(args);
  await deck.action(action(runtime, 'select'));
  assert.deepEqual(calls[0][1].input, { titleId: 'PPSA00005', path: '/data/games/5', contentId: 'content5', mounted: true });
});
test('private deck HTTP transport requires loopback credential and rejects browser origins and phone cookies', async t => {
  const runtime = await fixture(t), server = await serve(runtime, { host: '127.0.0.1', port: 0, id: runtime.id, uiRoot: path.resolve('ui') });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/native/deck')).status, 403);
  const headers = { 'X-TacHen-Native': runtime.deckCredential };
  assert.equal((await fetch(origin + '/native/deck', { headers: { ...headers, Origin: origin } })).status, 403);
  const response = await fetch(origin + '/native/deck', { headers }); assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.length, DECK_WIRE.bytes); assert.equal(bytes.readUInt32LE(), DECK_WIRE.magic);
  const update = await fetch(origin + '/native/deck/action', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(action(runtime, 'next')) });
  assert.equal(update.status, 200); assert.equal(Buffer.from(await update.arrayBuffer()).readUInt16LE(12), 1);
  const feedback = [], sync = { menuOpen:false, feedback: { epoch: 0, serial: 0, open: false, owner: -1, connection: 0, ready: true, renderedAt: 1000 } };
  runtime.gameInputRelay = { receive(value) { feedback.push(value); }, frame: () => undefined, stop() {} };
  const synced = await fetch(origin + '/native/deck/sync', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(sync) });
  assert.equal(synced.status, 200);assert.equal((await synced.arrayBuffer()).byteLength, DECK_WIRE.bytes);assert.deepEqual(feedback, [sync.feedback]);
  assert.equal((await fetch(origin + '/native/deck/sync', { method: 'POST', headers: { ...headers, Origin: origin }, body: JSON.stringify(sync) })).status, 403);
  assert.equal(feedback.length, 1);
  assert.equal(runtime.consoleDeck.visible,false);
});
test('actual C controller engine decodes JS wire and handles input/recovery without native console APIs', async () => {
  await fs.mkdir('build/tests', { recursive: true });
  const binary = encodeDeck({ sequence: 1, page: 0, ready: true, title: 'TacHen', subtitle: 'Native test', footer: 'Controls', ip: '127.0.0.1',
    rows: Array.from({ length: 3 }, (_, i) => ({ token: 'a'.repeat(32), label: i === 1 ? 'Payload 二' : 'Row ' + i, detail: '', enabled: true })) });
  await fs.writeFile('build/tests/deck-frame.bin', binary);
  const zig = process.env.ZIG || path.resolve('../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compile = spawnSync(zig, ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-Iplatform/deck', 'platform/deck/deck-core.c', 'platform/deck/deck-route.c', 'tests/deck-core-runner.c', '-o', 'build/tests/deck-core.exe'], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
  const result = spawnSync(path.resolve('build/tests/deck-core.exe'), ['build/tests/deck-frame.bin'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('native publication implementation preserves stopped-thread atomicity and rolls back partial writes', async () => {
  await fs.mkdir('build/tests', { recursive: true });
  const zig = process.env.ZIG || path.resolve('../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compile = spawnSync(zig, ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-Iplatform/deck', 'platform/deck/publication.c', 'tests/publication-runner.c', '-o', 'build/tests/publication.exe'], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
  const result = spawnSync(path.resolve('build/tests/publication.exe'), [], { encoding: 'utf8' });assert.equal(result.status, 0, result.stderr);
});


test('accent changes share state between phone and controller and invalidate stale selections', async t => {
  const runtime=await fixture(t),deck=runtime.consoleDeck;
  deck.page=4;
  await deck.action(action(runtime,'select',deck.frame().rows.findIndex(row=>row.command==='$next')));
  const accentRow=()=>deck.frame().rows.findIndex(row=>row.label.startsWith('Accent: '));
  const before=deck.frame(), stale=action(runtime,'select',accentRow());
  assert.equal(before.accent,'mint');
  await runtime.settings({appearance:{accent:'ice'}},runtime.snapshot().revision);
  const changed=deck.frame();assert.equal(changed.accent,'ice');
  assert.notEqual(changed.sequence,before.sequence);
  assert.equal(encodeDeck(changed).readUInt16LE(6)>>3,2);
  await assert.rejects(deck.action(stale),{code:'DECK_STALE'});
  assert.equal(changed.rows[accentRow()].label,'Accent: ice');
  await deck.action(action(runtime,'select',accentRow()));
  assert.equal(runtime.snapshot().settings.appearance.accent,'mint');
  await deck.action(action(runtime,'select',accentRow()));
  assert.equal(runtime.snapshot().settings.appearance.accent,'amber');
  assert.equal(encodeDeck(deck.frame()).readUInt16LE(6)>>3,1);
  assert.throws(()=>encodeDeck({...changed,accent:'unknown'}),{code:'DECK_ACCENT'});
});
