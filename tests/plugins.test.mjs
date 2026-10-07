import test from 'node:test';
import assert from 'node:assert/strict';
import { installPlugins } from '../src/plugins.mjs';
import { JobQueue } from '../src/jobs.mjs';
import { SessionHistory } from '../src/history.mjs';
import { validatePlugins } from '../src/plugin-schema.mjs';
import { store, ids, until, deferred } from './helpers.mjs';
const hash = 'a'.repeat(64), upload = 'b'.repeat(32), boot = '100:0';
const info = { id: upload, name: 'watcher.plugin', format: 'plugin', sha256: hash, pluginId: 'TACP00001', pluginVersion: '1.00' };
async function setup(options = {}) {
  const saved = await store(), id = ids(), runtime = { store: saved, id, graph: { safe: false }, sequence: 0, game: null,
    capability() {}, inbox: { verify: async () => ({ ...info }) }, jobs: new JobQueue(saved, { id }) };
  runtime.now = Date.now;runtime.session = id();runtime.changes = new SessionHistory(runtime);
  let calls = 0, receipt = null;
  const probe = { boot, processes: [], kstuff: { injectionReady: true } };
  const native = { systemProbe: () => probe, loaderPoll: () => receipt,
    pluginStart(request, file, sha256) {
      calls++; assert.equal(file, upload); receipt = { request, sha256, stage: 3, plugin: true,
        pluginId: info.pluginId, pluginVersion: info.pluginVersion, pid: 88, generation: boot + '/88/102:1' };
    } };
  const plugins = installPlugins(runtime, native, options);
  await plugins.register({ upload, scope: 'system', revision: saved.snapshot().revision });
  return { runtime, native, plugins, probe, calls: () => calls, receipt: () => receipt, setReceipt: value => receipt = value };
}
const start = env => env.runtime.jobs.enqueue('plugin.start', { sha256: hash, source: 'manual' }, 'manual-plugin');
const autostart = env => env.plugins.configure({ sha256: hash, autostart: true, revision: env.runtime.store.snapshot().revision });

test('plugin identity is separate from game target; duplicate identities and PRX cannot register as daemons', async () => {
  const env = await setup(); assert.equal(env.plugins.entries()[0].target, null);
  await assert.rejects(env.plugins.register({ upload, scope: 'system', revision: env.runtime.store.snapshot().revision }), { code: 'PLUGIN_CONFLICT' });
  env.runtime.inbox.verify = async () => ({ ...info, format: 'prx' });
  await assert.rejects(env.plugins.register({ upload, scope: 'system', revision: env.runtime.store.snapshot().revision }), { code: 'PLUGIN_FORMAT' });
  assert.throws(() => validatePlugins([{ ...env.plugins.entries()[0], scope: 'game', target: { titleId: 'TACP00001', version: '1.00' } }]), { code: 'PLUGIN_TARGET' });
});
test('manual plugin starts before a game and records dispatch without claiming feature initialization', async () => {
  const env = await setup(), job = await start(env);
  await until(() => env.runtime.jobs.snapshot()[0].status === 'completed');
  const result = env.runtime.jobs.snapshot()[0].result;
  assert.equal(result.initialized, false); assert.equal(result.request, job.id); assert.equal(env.calls(), 1);
  await start(env); assert.equal(env.calls(), 1);
  await assert.rejects(env.runtime.jobs.enqueue('plugin.start', { sha256: hash, source: 'manual' }, 'another-start'), { code: 'PLUGIN_ALREADY_ATTEMPTED' });
  env.probe.processes = [{ pid: 88, name: info.pluginId, generation: result.generation }];
  await env.plugins.refresh(); assert.equal(env.plugins.list()[0].observation.phase, 'process-active');
  env.probe.processes[0].generation = boot + '/88/103:0';
  await env.plugins.refresh(); assert.equal(env.plugins.list()[0].observation.phase, 'exited');
});
test('unknown census never claims exit and disabling autostart does not claim a process stopped', async () => {
  const env = await setup(); await start(env); await until(() => env.runtime.jobs.snapshot()[0].status === 'completed');
  env.probe.busy = true; await env.plugins.refresh(); assert.equal(env.plugins.list()[0].observation.phase, 'uncertain');
  env.probe.busy = false; env.probe.processes = [{ pid: 88, name: info.pluginId, generation: env.receipt().generation }];
  await env.plugins.configure({ sha256: hash, autostart: false, revision: env.runtime.store.snapshot().revision });
  await env.plugins.refresh(); assert.equal(env.plugins.list()[0].observation.phase, 'process-active');
});
test('safe startup and changed plugin hashes prevent native execution', async () => {
  const env = await setup(); env.runtime.graph.safe = true;
  await assert.rejects(start(env), { code: 'SAFE_STARTUP' }); env.runtime.graph.safe = false;
  env.runtime.inbox.verify = async () => ({ ...info, sha256: 'c'.repeat(64) });
  await assert.rejects(start(env), { code: 'PLUGIN_CHANGED' }); assert.equal(env.calls(), 0);
});
test('game autostart waits for exact version, dispatches once and does not duplicate after game relaunch', async () => {
  const env = await setup();
  await env.runtime.store.transaction(state => { Object.assign(state.plugins[0], { scope: 'game', target: { titleId: 'PPSA00001', version: '01.000.000' } }); });
  await autostart(env); await env.plugins.refresh(); assert.equal(env.calls(), 0);
  env.runtime.game = { titleId: 'PPSA00001', version: '01.001.000', generation: 'game:1' };
  await env.plugins.refresh(); assert.equal(env.calls(), 0);
  env.runtime.game.version = '01.000.000'; await env.plugins.refresh();
  await until(() => env.runtime.jobs.snapshot()[0]?.status === 'completed');
  env.runtime.game.generation = 'game:2'; await env.plugins.refresh(); assert.equal(env.calls(), 1);
});
test('disabling autostart while the native worker is busy prevents a delayed launch', async () => {
  const gate = deferred(), env = await setup({ delay: () => gate.promise });
  await autostart(env);
  let busyCalls = 0; env.native.pluginStart = () => { busyCalls++; throw Object.assign(Error('busy'), { code: 'LOADER_BUSY' }); };
  await env.plugins.refresh(); await until(() => busyCalls === 1);
  await env.plugins.configure({ sha256: hash, autostart: false, revision: env.runtime.store.snapshot().revision });
  gate.resolve(); await until(() => env.runtime.jobs.snapshot()[0].status === 'failed'); assert.equal(busyCalls, 1);
  assert.equal(env.runtime.jobs.snapshot()[0].error.code, 'PLUGIN_CONTEXT_CHANGED');
});
test('a receipt from another process generation stays interrupted and holds resources', async () => {
  const env = await setup();
  env.native.pluginStart = request => env.setReceipt({ request, sha256: hash, plugin: true, stage: 3,
    pluginId: info.pluginId, pluginVersion: info.pluginVersion, pid: 88, generation: '99:0/88/102:1' });
  await start(env); await until(() => env.runtime.jobs.snapshot()[0].status === 'interrupted');
  assert.equal(env.runtime.jobs.snapshot()[0].error.code, 'PLUGIN_RECEIPT');
});
test('unresolved native spawn does not automatically retry after further inspections', async () => {
  const env = await setup(); let calls = 0;
  env.native.pluginStart = request => { calls++; env.setReceipt({ request, sha256: hash, plugin: true, stage: 5, message: 'Uncertain launch' }); };
  await autostart(env); await env.plugins.refresh(); await until(() => env.runtime.jobs.snapshot()[0].status === 'interrupted');
  await env.plugins.refresh(); await env.plugins.refresh(); assert.equal(calls, 1);
});
test('a game disappearing during streamed verification cannot authorize game autostart', async () => {
  const env = await setup();
  await env.runtime.store.transaction(state => { Object.assign(state.plugins[0], { scope: 'game', autostart: true,
    target: { titleId: 'PPSA00001', version: '01.000.000' } }); });
  env.runtime.game = { titleId: 'PPSA00001', version: '01.000.000', generation: 'game:1' };
  env.runtime.inbox.verify = async () => { env.runtime.game = null; return { ...info }; };
  await assert.rejects(env.runtime.jobs.enqueue('plugin.start', { sha256: hash, source: 'automatic' }, 'game-disappeared'), { code: 'PLUGIN_GAME_CHANGED' });
  assert.equal(env.calls(), 0);
});
test('native start errors with an unknown effect retain the operation rather than becoming retryable failures', async () => {
  const env = await setup(); env.native.pluginStart = () => { throw Error('Native result unavailable'); };
  await start(env); await until(() => env.runtime.jobs.snapshot()[0].status === 'interrupted');
  assert.equal(env.runtime.jobs.snapshot()[0].status, 'interrupted');
});
