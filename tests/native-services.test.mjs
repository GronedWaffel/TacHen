import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceInspector, installNativeServices } from '../src/native-services.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store, ids, until } from './helpers.mjs';
const hash = { kstuff: 'a'.repeat(64), shadowmount: 'b'.repeat(64), 'payload-manager': 'c'.repeat(64) };
const fresh = () => ({ boot: 'boot-one', firmware: '13.60', kstuff: { state: 'installed', injectionReady: true },
  processes: [], ports: { shadowmount: 0, 'payload-manager': 0 } });
const running = (state, id, pid = 30) => {
  state.processes.push({ pid, name: id === 'payload-manager' ? 'pldmgr.elf' : id + '.elf', thread: '', generation: 'instance-' + pid }); state.ports[id] = 1;
};
const response = async (_port, route) => ({ text: route === '/api/v1/version' ? JSON.stringify({ status: 0, api_version: 1,
  shadowmount_version: '1.7beta4', capabilities: ['list_games', 'storage_job_status', 'mount_game'] }) :
  route === '/version' ? '0.5.2' : JSON.stringify({ AUTOLOAD_ENABLED: false, AUTO_BROWSER_OPEN: false, KILL_DISC_PLAYER_ON_STARTUP: false, AUTO_INSTALL_APP: false }) });
test('native service readiness requires kernel hooks, matching process and the pinned API', async () => {
  const state = fresh(); const inspect = serviceInspector({ systemProbe: () => structuredClone(state) }, { get: response });
  assert.equal((await inspect('kstuff')).ready, true);
  assert.equal((await inspect('shadowmount')).absent, true);
  state.ports.shadowmount = 1; assert.equal((await inspect('shadowmount')).ready, false);
  running(state, 'shadowmount'); assert.equal((await inspect('shadowmount')).ready, true);
  state.kstuff.injectionReady = false; assert.equal((await inspect('shadowmount')).ready, false);
  assert.equal((await inspect('kstuff')).ready, false);
});
test('PID reuse or component restart during an HTTP request cannot publish ready', async () => {
  const state = fresh(); running(state, 'shadowmount');
  const inspect = serviceInspector({ systemProbe: () => structuredClone(state) }, { get: async (...args) => {
    const result = await response(...args); state.processes[0].generation = 'reused-pid'; return result;
  } });
  assert.equal((await inspect('shadowmount')).ready, false);
});
test('wrong API version, independent manager autoload, duplicate processes and worker activity are withheld', async () => {
  const state = fresh(); running(state, 'payload-manager');
  const api = { systemProbe: () => structuredClone(state) };
  const inspect = serviceInspector(api, { get: response });
  assert.equal((await inspect('payload-manager')).ready, true);
  const unsafe = serviceInspector(api, { get: async (...args) => args[1] === '/get_config' ?
    { text: JSON.stringify({ AUTOLOAD_ENABLED: true }) } : response(...args) });
  assert.equal((await unsafe('payload-manager')).ready, false);
  const wrong = serviceInspector(api, { get: async () => ({ text: '0.6.0' }) });
  assert.equal((await wrong('payload-manager')).ready, false);
  running(state, 'payload-manager', 99); assert.equal((await inspect('payload-manager')).ready, false);
  state.busy = true; assert.equal((await inspect('kstuff')).ready, false);
});
async function environment({ spawn = true, timeout = 1000 } = {}) {
  const state = fresh(), receipts = new Map(), calls = [], sequence = ids();
  const native = { systemProbe: () => structuredClone(state), managerPrepare: () => calls.push('config'),
    loaderStart(request, upload, sha256) {
      const component = Object.keys(hash).find(key => hash[key] === sha256); calls.push(component);
      receipts.set(request, { request, sha256, stage: 3, pid: 50 });
      if (spawn) { if (component === 'kstuff') state.kstuff = { state: 'installed', injectionReady: true }; else running(state, component, 50); }
    }, loaderPoll: request => receipts.get(request) || null };
  const assets = { get: component => ({ sha256: hash[component] }), ensure: async component => ({ id: hash[component].slice(0, 32), sha256: hash[component] }) };
  const runtime = new TacRuntime(await store(), { identity: async () => ({ mode: 'development' }), install: async runtime => {
    runtime.inbox = { verify: async id => ({ id, sha256: Object.values(hash).find(h => h.startsWith(id)), format: 'elf' }) };
    runtime.graph.register({ id: 'coordinator', start: async () => ({ ready: true }), verify: async () => true });
    runtime.nativeServices = installNativeServices(runtime, native, assets, { get: response, delay: () => new Promise(r => setTimeout(r, 1)), timeout });
  } }, { id: sequence });
  await runtime.start(); return { runtime, state, calls, receipts };
}
test('existing verified components are adopted without another launch or configuration mutation', async () => {
  const { runtime, state, calls } = await environment(); running(state, 'shadowmount'); running(state, 'payload-manager', 31);
  await runtime.nativeServices.startConfigured(); assert.deepEqual(calls, []);
  assert.equal(runtime.graph.ready('shadowmount'), true); assert.equal(runtime.graph.ready('payload-manager'), true);
  assert.equal(runtime.store.snapshot().startup.pending, false);
});
test('startup serializes kstuff then ShadowMount then manager, config before manager spawn', async () => {
  const { runtime, state, calls } = await environment(); state.kstuff = { state: 'unmodified', injectionReady: true };
  await runtime.nativeServices.startConfigured();
  assert.deepEqual(calls, ['kstuff', 'shadowmount', 'config', 'payload-manager']);
  assert.equal(runtime.jobs.snapshot().length, 3); assert.ok(runtime.jobs.snapshot().every(job => job.status === 'completed'));
  assert.equal(runtime.graph.ready('payload-manager'), true);
});
test('a spawn without readiness is interrupted and cannot release its resource or autostart the next service', async () => {
  const { runtime, calls } = await environment({ spawn: false, timeout: 10 });
  await runtime.nativeServices.startConfigured();
  assert.deepEqual(calls, ['shadowmount']); assert.equal(runtime.graph.safe, true);
  assert.equal(runtime.jobs.snapshot()[0].status, 'interrupted');
  await assert.rejects(runtime.jobs.reconcile(runtime.jobs.snapshot()[0].id), { code: 'OUTCOME_UNKNOWN' });
});
test('service preflight rejects an occupied port and unknown hooks before dispatch', async () => {
  const { runtime, state, calls } = await environment(); state.ports.shadowmount = 1;
  await runtime.nativeServices.startConfigured(); assert.deepEqual(calls, []); assert.equal(runtime.graph.safe, true);
  state.kstuff = { state: 'unknown', injectionReady: false };
  assert.equal((await runtime.nativeServices.inspect('kstuff')).absent, false);
});
test('saved recovery mode skips every automatic native start', async () => {
  const { runtime, calls } = await environment(); runtime.graph.safe = true;
  await runtime.nativeServices.startConfigured(); assert.deepEqual(calls, []);
  await assert.rejects(runtime.jobs.enqueue('component.start', { component: 'shadowmount' }, 'unsafe-retry'), { code: 'SAFE_START' });
});
test('readiness monitoring tolerates one missed check and invalidates a lost dependency without respawning it', async () => {
  const { runtime, state, calls } = await environment();
  await runtime.nativeServices.startConfigured(); const count = calls.length;
  state.kstuff = { state: 'unknown', injectionReady: false };
  await runtime.nativeServices.checkResident(); assert.equal(runtime.graph.ready('kstuff'), true);
  await runtime.nativeServices.checkResident();
  assert.equal(runtime.graph.ready('kstuff'), false); assert.equal(runtime.graph.ready('shadowmount'), false);
  assert.equal(runtime.graph.ready('payload-manager'), false); assert.equal(calls.length, count);
});
