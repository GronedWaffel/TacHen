import test from 'node:test';
import assert from 'node:assert/strict';
import { installPlugins } from '../src/plugins.mjs';
import { JobQueue } from '../src/jobs.mjs';
import { SessionHistory } from '../src/history.mjs';
import { store, ids, until, deferred } from './helpers.mjs';
const hash = 'a'.repeat(64), upload = 'b'.repeat(32), boot = '100:0';
const game = { pid: 77, generation: boot + '/77/110:0', titleId: 'PPSA00001', version: '01.000.000', platform: 'ps5', metadataHash: 'c'.repeat(64) };
const info = { id: upload, sha256: hash, name: 'test.sprx', format: 'sprx', platform: 'ps5' };
async function setup(options = {}) {
  const saved = await store(), id = ids(), runtime = { store: saved, id, graph: { safe: false }, sequence: 0, game: null,
    capability() {}, inbox: { verify: async () => ({ ...info }) }, jobs: new JobQueue(saved, { id }) };
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

test('native modules register before a game, but only an exact platform/title/version can start them', async () => {
  const env = await setup(); assert.equal(env.plugins.entries()[0].format, 'sprx');
  await assert.rejects(start(env), { code: 'MODULE_GAME' });
  await autostart(env); await env.plugins.refresh(); assert.equal(env.calls(), 0); assert.equal(env.plugins.list()[0].observation.phase, 'armed');
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
test('armed PRX loads once per game instance, then loads again after a verified new instance', async () => {
  const env = await setup(); await autostart(env); env.active(game); await env.plugins.refresh();
  await until(() => env.runtime.jobs.snapshot()[0]?.status === 'completed');
  await env.plugins.refresh(); assert.equal(env.calls(), 1);
  env.active({ ...game, generation: boot + '/77/111:0' }); await env.plugins.refresh();
  await until(() => env.runtime.jobs.snapshot()[1]?.status === 'completed'); assert.equal(env.calls(), 2);
});
test('a game changing during file verification or before native dispatch is not modified', async () => {
  const env = await setup(); env.active(game);
  env.runtime.inbox.verify = async () => { env.active({ ...game, generation: boot + '/77/111:0' }); return { ...info }; };
  await assert.rejects(start(env), { code: 'MODULE_CHANGED' }); assert.equal(env.calls(), 0);
});
test('disabling module autostart while the native guard is busy prevents delayed execution', async () => {
  const gate = deferred(), env = await setup({ delay: () => gate.promise }); env.active(game); await autostart(env);
  let attempts = 0; env.native.gameModuleStart = () => { attempts++; throw Object.assign(Error('busy'), { code: 'NATIVE_BUSY' }); };
  await env.plugins.refresh(); await until(() => attempts === 1);
  await env.plugins.configure({ sha256: hash, autostart: false, revision: env.runtime.store.snapshot().revision });
  gate.resolve(); await until(() => env.runtime.jobs.snapshot()[0].status === 'failed'); assert.equal(attempts, 1);
});
test('a positive module handle with failed initialization never becomes a successful load', async () => {
  const env = await setup(); env.active(game); let calls = 0;
  env.native.gameModuleStart = request => { calls++; env.setReceipt({ request, sha256: hash, pid: game.pid, generation: game.generation, stage: 5,
    handle: 12, startResult: -1, message: 'initializer failed' }); };
  await autostart(env); await env.plugins.refresh(); await until(() => env.runtime.jobs.snapshot()[0]?.status === 'interrupted');
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

test('an ended game releases an unresolved module operation before autostart in a new instance', async () => {
  const env = await setup(); env.active(game); await autostart(env);
  const successful = env.native.gameModuleStart;
  env.native.gameModuleStart = request => env.setReceipt({ request, sha256: hash, pid: game.pid, generation: game.generation, stage: 6, message: 'Result unavailable' });
  await env.plugins.refresh(); await until(() => env.runtime.jobs.snapshot()[0]?.status === 'interrupted');
  env.active({ ...game, generation: boot + '/77/111:0' });
  env.native.gameModuleStart = successful; await env.plugins.refresh();
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
