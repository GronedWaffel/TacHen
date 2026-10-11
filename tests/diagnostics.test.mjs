import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { StateStore } from '../src/store.mjs';
import { TacError } from '../src/errors.mjs';
import { payloadDispatchHandler } from '../src/payload-loader.mjs';
import { diagnosticEvidence } from '../src/diagnostics.mjs';
import { checksum, ids, memoryStorage, until, deferred } from './helpers.mjs';
const id = ids();
test('module diagnostics retain loader and initializer codes without exporting module paths',()=>{
 assert.deepEqual(diagnosticEvidence({handle:-2147352563,startResult:0,path:'/private/module.prx',request:'private'}),{handle:-2147352563,startResult:0});
});
async function make(storage = memoryStorage(), configure = null, install = () => {}) {
  const saved = await new StateStore(storage, checksum).open();
  if (configure) await saved.transaction(configure);
  return new TacRuntime(saved, { identity: async () => ({ mode: 'development', firmware: '12.40', ip: '192.168.1.99' }), install }, { id }).start();
}
async function toggle(r, enabled) { await r.settings({ developer: { diagnostics: enabled } }, r.store.snapshot().revision); }

test('capture defaults off, stays independent of MCP and preserves stopped evidence for explicit export', async () => {
  const r = await make(), files = r.store.storage.files;
  assert.equal(r.snapshot().diagnostics.enabled, false);assert(![...files.keys()].some(k => k.startsWith('diagnostics')));
  await assert.rejects(r.execute('diagnostics.export', {}), { code: 'CAPTURE_EMPTY' });
  await toggle(r, true);assert.equal(r.snapshot().settings.developer.enabled, false);
  r.diagnostics.record('test', { status: 'captured' });await toggle(r, false);
  const before = (await r.diagnostics.export()).runs.at(-1);r.diagnostics.record('test', { status: 'after-disable' });
  assert.equal(before.startupIncluded, false);assert.equal(before.ended, 'disabled');
  assert.deepEqual((await r.diagnostics.export()).runs.at(-1), before);await r.close();
});

test('startup service ordering, earliest failure and native rejected receipt survive coordinator reopen', async () => {
  const storage = memoryStorage();let r;
  await assert.rejects(make(storage, s => { s.settings.developer.diagnostics = true; }, async runtime => {
    r = runtime;
    runtime.graph.register({ id: 'shellui', start: async () => { throw new TacError('BOOT_SIGNATURE_REJECTED', 'private path here'); }, verify: () => true });
    await runtime.graph.start('shellui');
  }), { code: 'BOOT_SIGNATURE_REJECTED' });
  const report = await r.diagnostics.export();
  const events = report.runs[0].events;assert.equal(report.runs[0].startupIncluded, true);
  assert.equal(report.runs[0].ended, 'startup-failed');
  assert(events.find(e => e.type === 'service' && e.status === 'starting'));
  assert(events.find(e => e.type === 'service' && e.code === 'BOOT_SIGNATURE_REJECTED'));
  const next = await make(storage);const resumed = await next.diagnostics.export();
  assert.equal(resumed.runs.length, 2);assert.equal(resumed.runs[0].ended, 'startup-failed');
  assert(resumed.runs[1].events.some(e => e.status === 'coordinator-ready'));
  assert.equal(next.snapshot().safe, true);await next.close();
});

test('actual payload dispatch adapter records stage/errno before rejection without exporting upload identity or native prose', async () => {
  const r = await make();await toggle(r, true);let request;
  r.inbox = { verify: async () => ({ format: 'elf', sha256: 'a'.repeat(64) }) };
  r.jobs.register('payload.dispatch', payloadDispatchHandler(r, {
    loaderStart: value => { request = value; }, loaderPoll: () => ({ request, sha256: 'a'.repeat(64), stage: 4, noSideEffects: true,
      errno: 22, message: 'SECRET_NATIVE_MESSAGE /private/customer/file', data: 'SECRET_MEMORY', credential: 'SECRET_CREDENTIAL' })
  }));
  const job = await r.jobs.enqueue('payload.dispatch', { id: 'SECRET_UPLOAD' }, 'SECRET_CUSTOMER_KEY');
  await until(() => r.jobs.snapshot().find(j => j.id === job.id)?.status === 'failed');
  const report = await r.execute('diagnostics.export', {}), text = JSON.stringify(report), events = report.runs.at(-1).events;
  assert(!text.includes('SECRET_'));assert(!text.includes('192.168.1.99'));assert(!text.includes('a'.repeat(64)));
  const native = events.find(e => e.type === 'native.payload.dispatch');assert.equal(native.evidence.stage, 4);assert.equal(native.evidence.errno, 22);
  const failed = events.find(e => e.type === 'job.payload.dispatch' && e.status === 'failed');
  assert.equal(failed.code, 'PAYLOAD_REJECTED');assert.equal(failed.target, native.target);assert.equal(failed.origin, 'current-session');
  assert(events.some(e => e.type === 'job.payload.dispatch' && e.status === 'running'));await r.close();
});

test('capture slots recover a torn latest write and an abrupt stop is not labelled a proven crash', async () => {
  const storage = memoryStorage(), r = await make(storage);await toggle(r, true);
  r.diagnostics.record('test', { status: 'first-durable' });await r.diagnostics.flush();
  r.diagnostics.record('test', { status: 'second-durable' });await r.diagnostics.flush();
  storage.files.set(`diagnostics-${r.diagnostics.revision % 2}.json`, '{torn');
  // Simulate process loss after durable writes; no old coordinator will be closed or reused.
  r.jobs.stopDispatch();
  const next = await make(storage);const report = await next.diagnostics.export();
  assert(report.persistence.recovered);assert.equal(report.runs[0].ended, 'unconfirmed-stop');
  assert(report.runs[0].events.some(e => e.status === 'first-durable'));
  assert(!report.runs[0].events.some(e => e.status === 'second-durable'));await next.close();
});

test('both corrupt capture slots are preserved; clearing both slots resets recording explicitly', async () => {
  const storage = memoryStorage();storage.files.set('diagnostics-0.json', 'bad-zero');storage.files.set('diagnostics-1.json', 'bad-one');
  const r = await make(storage, s => { s.settings.developer.diagnostics = true; });
  assert.equal(r.snapshot().diagnostics.fault, 'CAPTURE_CORRUPT');assert.equal(storage.files.get('diagnostics-0.json'), 'bad-zero');
  const result = await r.execute('diagnostics.clear', {});assert(result.enabled);assert.equal(result.fault, null);
  assert.equal((await r.diagnostics.export()).runs.length, 1);await r.close();
});

test('disk failures cannot halt jobs; export retries and reports persistence failure honestly', async () => {
  const storage = memoryStorage(), baseReplace = storage.replace.bind(storage);let fail = false;
  storage.replace = (name, text) => { if (fail && name.startsWith('diagnostics')) throw Error('disk full');return baseReplace(name, text); };
  const r = await make(storage);await toggle(r, true);fail = true;
  r.jobs.register('test.run', { validate: async () => ({}), resources: () => [], run: async () => ({ completed: true }), verify: () => true });
  const job = await r.jobs.enqueue('test.run', {}, 'diagnostic-disk-failure');
  await until(() => r.jobs.snapshot().find(j => j.id === job.id)?.status === 'completed');
  const report = await r.diagnostics.export();assert.equal(report.persistence.fault, 'CAPTURE_WRITE_FAILED');assert.equal(r.jobs.halted, false);
  fail = false;assert.equal((await r.diagnostics.export()).persistence.fault, null);await r.close();
});

test('bounded recorder retains startup and latest evidence, annotates omissions and coalesces a slow disk', async () => {
  const storage = memoryStorage(), r = await make(storage);await toggle(r, true);
  const gate = deferred(), baseReplace = storage.replace.bind(storage);let calls = 0;
  storage.replace = async (name, text) => { if (name.startsWith('diagnostics')) { calls++;await gate.promise; }return baseReplace(name, text); };
  r.diagnostics.record('test', { status: 'before-burst' });await Promise.resolve();
  for (let i = 0; i < 3000; i++) r.diagnostics.record('test', { evidence: { stage: i, evidence: { pid: 55, credential: 'SECRET' } } });
  assert.equal(calls, 1);gate.resolve();const report = await r.diagnostics.export();
  assert(calls <= 2);const run = report.runs.at(-1);assert.equal(run.events.length, 512);assert(run.omitted > 2400);
  assert.equal(run.events[0].type, 'capture');assert.equal(run.events.at(-1).evidence.stage, 2999);
  assert(!JSON.stringify(report).includes('SECRET'));await r.close();
});

test('disable persists across recovery, clear prevents old-slot resurrection and only three captures are kept', async () => {
  const r = await make();for (let n = 0; n < 5; n++) { await toggle(r, true);await toggle(r, false); }
  assert.equal(r.snapshot().diagnostics.captures, 3);
  await r.diagnostics.clear();assert.equal(r.snapshot().diagnostics.captures, 0);
  await r.store.transaction(s => { s.startup.pending = true;s.knownGood.developer.diagnostics = true; });
  const next = await make(r.store.storage);assert.equal(next.snapshot().settings.developer.diagnostics, false);
  assert.equal(next.snapshot().diagnostics.captures, 0);await next.close();
});

test('continued activity cannot starve an explicit report export behind a permanently extending writer', async () => {
  const r = await make();await toggle(r, true);
  const storage = r.store.storage, replace = storage.replace.bind(storage);let writes = 0;
  storage.replace = async (name, text) => {
    if (name.startsWith('diagnostics') && ++writes < 40) {
      await Promise.resolve();r.diagnostics.record('test', { evidence: { stage: writes } });
    }
    return replace(name, text);
  };
  r.diagnostics.record('test', { status: 'start-stream' });
  const report = await r.diagnostics.export();assert(writes < 40);assert(report.persistence.pending);
  await r.close();
});

test('old terminal jobs are not replayed as fresh failures and recovered jobs identify their earlier session', async () => {
  const r = await make();
  r.jobs.register('test.run', { validate: async () => ({}), resources: () => [], run: async () => ({ completed: true }), verify: () => true });
  // Create valid durable intents before simulating the old coordinator's loss.
  const a = await r.jobs.enqueue('test.run', {}, 'old-terminal-job');
  await until(() => r.jobs.snapshot().find(j => j.id === a.id)?.status === 'completed');
  r.jobs.kick = () => {};const b = await r.jobs.enqueue('test.run', {}, 'old-interrupted-job');r.jobs.stopDispatch();
  await r.jobs.patch(b.id, { status: 'interrupted' });
  await r.store.transaction(s => { s.settings.developer.diagnostics = true; });
  const next = await make(r.store.storage), events = (await next.diagnostics.export()).runs.at(-1).events.filter(e => e.type === 'job.test.run');
  assert.equal(events.length, 1);assert.equal(events[0].status, 'interrupted');assert.equal(events[0].origin, 'previous-session');
  await next.close();
});

test('worst-case projected native receipts stay within the per-event bound with explicit truncation', async () => {
  const r = await make();await toggle(r, true);
  const evidence = Object.fromEntries(['pid','appId','errno','error','status','result','returnCode','code','stage','completed','total','completedBytes','totalBytes','bytes','count'].map(k => [k, Number.MAX_SAFE_INTEGER]));
  Object.assign(evidence, Object.fromEntries(['ready','absent','busy','verified','installed','initialized','adopted','injectionReady','noSideEffects','safe','halted','accepted','observed','mounted','sameBoot'].map(k => [k,true])));
  r.diagnostics.record('t'.repeat(80), { target: 'x'.repeat(80), status: 's'.repeat(80), code: 'E'.repeat(80),
    evidence: { ...evidence, receipt: evidence, progress: evidence, evidence }, game: { titleId: 'PPSA00001', version: '01.000.000', pid: 99999 } });
  const event = (await r.diagnostics.export()).runs.at(-1).events.at(-1);
  assert(JSON.stringify(event).length <= 1024);assert(event.evidenceTruncated);assert.equal(event.evidence.stage, Number.MAX_SAFE_INTEGER);
  await r.close();
});
