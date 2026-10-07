import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TacRuntime } from '../src/runtime.mjs';
import { installPlugins } from '../src/plugins.mjs';
import { installCheats } from '../src/cheat-service.mjs';
import { installLoadouts } from '../src/loadouts.mjs';
import { ConsoleDeck } from '../src/deck.mjs';
import { store, memoryStorage, ids, until } from './helpers.mjs';
const boot = '100:0', pluginHash = 'b'.repeat(64), moduleHash = 'c'.repeat(64);
const game = { titleId: 'PPSA00001', version: '01.000.000', platform: 'ps5', pid: 91,
  generation: boot + '/91/101:0', metadataHash: 'a'.repeat(64) };
const files = [{ id: 'd'.repeat(32), sha256: pluginHash, name: 'Watcher.plugin', format: 'plugin', pluginId: 'TACP00001', pluginVersion: '1.00' },
  { id: 'e'.repeat(32), sha256: moduleHash, name: 'Game.sprx', format: 'sprx', platform: 'ps5' }];
async function fixture(t) {
  const calls = [], receipts = new Map(), probe = { boot, kstuff: { injectionReady: true }, processes: [{ pid: game.pid, generation: game.generation }] };
  const native = {
    systemProbe: () => structuredClone(probe), loaderPoll: id => receipts.get(id), gameModulePoll: id => receipts.get(id), cheatPoll: id => receipts.get(id),
    pluginStart(request) {
      calls.push('plugin');const generation = boot + '/99/102:0';
      receipts.set(request, { request, sha256: pluginHash, plugin: true, pluginId: 'TACP00001', pluginVersion: '1.00', stage: 3, pid: 99, generation });
      probe.processes.push({ pid: 99, generation, name: 'TACP00001' });
    },
    gameModuleStart(request, file, sha256, pid, generation) {
      calls.push('module');receipts.set(request, { request, sha256, pid, generation, stage: 4, handle: 4, startResult: 0 });
    },
    cheatStart(request, pid, generation, title, metadata, module, packet) {
      calls.push('cheat');receipts.set(request, { request, pid, generation, stage: 3, resumed: true, restored: false, writes: 1, busy: false,
        planHash: createHash('sha256').update(Buffer.from(packet)).digest('hex') });
    }
  };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    install(r) {
      r.inbox = { verify: async id => structuredClone(files.find(f => f.id === id)) };
      const options = { delay: () => new Promise(resolve => setTimeout(resolve, 1)) };
      installPlugins(r, native, options);installCheats(r, native, memoryStorage(), options);installLoadouts(r, native, options);
    } }, { id: ids() }).start();
  t.after(() => runtime.close());runtime.game = structuredClone(game);
  for (const feature of ['fps', 'resources', 'ip-overlay']) runtime.capability(feature, true);
  for (const item of files) await runtime.plugins.register({ upload: item.id, scope: item.format === 'plugin' ? 'system' : 'game',
    target: item.format === 'plugin' ? null : { titleId: game.titleId, version: game.version }, revision: runtime.store.snapshot().revision });
  const pack = await runtime.cheats.packs.import({ ...game, source: JSON.stringify({ name: 'Fixture', process: 'eboot.bin',
    mods: [{ name: 'Test option', memory: [{ offset: '10', on: '9090', off: '0102' }] }] }) });
  const profile = { titleId: game.titleId, version: game.version, name: 'Match setup', plugins: [pluginHash, moduleHash],
    cheats: [{ pack: pack.sha256, id: '0' }], overlay: { fps: true, ip: true }, autostart: false };
  const save = async changes => runtime.execute('loadout.save', { profile: { ...profile, ...changes }, revision: runtime.store.snapshot().revision });
  await save();
  const apply = () => runtime.jobs.enqueue('loadout.apply', { titleId: game.titleId, version: game.version }, runtime.id());
  const settled = async id => { await until(() => ['completed', 'failed', 'interrupted'].includes(runtime.jobs.snapshot().find(j => j.id === id)?.status));
    return runtime.jobs.snapshot().find(j => j.id === id); };
  return { runtime, native, probe, calls, receipts, pack, profile, save, apply, settled };
}

test('loadouts preflight every entry before any native action and enforce saved revision and exact target', async t => {
  const f = await fixture(t);
  await f.save({ plugins: [pluginHash, 'f'.repeat(64)] });
  const preview = await f.runtime.execute('loadout.preview', {});assert.equal(preview.canApply, false);
  assert.equal(preview.issues[0].code, 'PLUGIN_MISSING');assert.ok(preview.steps.every(s => !s.args));
  await assert.rejects(f.apply(), { code: 'PROFILE_PREFLIGHT' });assert.deepEqual(f.calls, []);
  await assert.rejects(f.runtime.loadouts.save({ profile: f.profile, revision: 0 }), { code: 'STATE_CHANGED' });
  f.runtime.game.version = '01.001.000';await assert.rejects(f.apply(), { code: 'PROFILE_MISSING' });
});

test('loadout queue executes real plugin, module and cheat adapters and keeps overlays local to the game instance', async t => {
  const f = await fixture(t), baseline = structuredClone(f.runtime.store.snapshot().settings.overlay);
  const job = await f.apply(), result = await f.settled(job.id);
  assert.equal(result.status, 'completed');assert.equal(result.result.fullyApplied, true);
  assert.deepEqual(f.calls, ['plugin', 'module', 'cheat']);assert.equal(result.result.steps.length, 3);
  assert.equal(f.runtime.overlaySettings().fps, true);assert.deepEqual(f.runtime.store.snapshot().settings.overlay, baseline);
  f.runtime.game = { ...game, generation: boot + '/91/199:0' };assert.deepEqual(f.runtime.overlaySettings(), baseline);
  assert.equal(f.runtime.loadouts.snapshot().active, null);
});

test('two loadout coordinators share the second queue slot with children and adopt completed operations without repeat dispatch', async t => {
  const f = await fixture(t);f.runtime.jobs.pumping = true;
  const first = await f.apply(), second = await f.apply();f.runtime.jobs.pumping = false;f.runtime.jobs.kick();
  assert.equal((await f.settled(first.id)).result.fullyApplied, true);
  const after = await f.settled(second.id);assert.equal(after.result.fullyApplied, true);
  assert.ok(after.result.steps.every(s => s.adopted));assert.deepEqual(f.calls, ['plugin', 'module', 'cheat']);
  f.probe.processes = f.probe.processes.filter(p => p.pid !== 99);
  await assert.rejects(f.apply(), { code: 'PROFILE_PREFLIGHT' });assert.equal(f.calls.length, 3);
});

test('a failed child retains prior work and explicitly reports a partial loadout without starting later steps', async t => {
  const f = await fixture(t), start = f.native.gameModuleStart;
  f.native.gameModuleStart = (...args) => { start(...args);Object.assign(f.receipts.get(args[0]), { stage: 7, noSideEffects: true, message: 'Rejected before loading' }); };
  const job = await f.apply(), result = await f.settled(job.id);
  assert.equal(result.status, 'completed');assert.equal(result.result.phase, 'loadout-stopped');assert.equal(result.result.fullyApplied, false);
  assert.deepEqual(f.calls, ['plugin', 'module']);assert.equal(f.runtime.loadouts.snapshot().active, null);
  assert.match(result.result.message, /Remaining steps were not started/);
});

test('uncertain child preserves parent checkpoint and reconciliation never replays remaining work', async t => {
  const f = await fixture(t), start = f.native.gameModuleStart;
  f.native.gameModuleStart = (...args) => { start(...args);Object.assign(f.receipts.get(args[0]), { stage: 6, message: 'Unknown module outcome' }); };
  const job = await f.apply(), result = await f.settled(job.id);assert.equal(result.status, 'interrupted');
  assert.equal(result.error.code, 'PROFILE_CHILD_UNCERTAIN');assert.deepEqual(f.calls, ['plugin', 'module']);
  await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });
  const child = f.runtime.jobs.snapshot().find(j => j.kind === 'game.module.start');
  Object.assign(f.receipts.get(child.id), { stage: 4, handle: 4, startResult: 0 });
  await f.runtime.jobs.reconcile(child.id);await f.runtime.jobs.reconcile(job.id);
  assert.equal((await f.settled(job.id)).result.fullyApplied, false);assert.deepEqual(f.calls, ['plugin', 'module']);
  assert.equal(f.runtime.loadouts.active, null);
});

test('changed game during a completed child stops remaining steps; queued contexts do not rebind to new games', async t => {
  const f = await fixture(t), start = f.native.pluginStart;
  f.native.pluginStart = (...args) => { start(...args);f.runtime.game = { ...game, generation: boot + '/91/199:0' }; };
  const job = await f.apply();assert.equal((await f.settled(job.id)).result.fullyApplied, false);assert.deepEqual(f.calls, ['plugin']);
  await f.save({ plugins: [], cheats: [], overlay: {} });f.runtime.jobs.pumping = true;
  const queued = await f.apply();f.runtime.game = { ...game, generation: boot + '/91/299:0' };
  f.runtime.jobs.pumping = false;f.runtime.jobs.kick();assert.equal((await f.settled(queued.id)).status, 'failed');
});

test('automatic loadouts own selected plugin startup, retry unavailable readiness and run once per game generation', async t => {
  const f = await fixture(t);await f.save({ autostart: true });
  for (const sha256 of [pluginHash, moduleHash]) await f.runtime.plugins.configure({ sha256, autostart: true, revision: f.runtime.store.snapshot().revision });
  await f.runtime.plugins.refresh();assert.equal(f.calls.length, 0);
  f.runtime.capability('fps', false, 'Renderer pending');await f.runtime.loadouts.refresh();assert.equal(f.calls.length, 0);
  assert.equal(f.runtime.loadouts.observation.error.code, 'PROFILE_READINESS');
  f.runtime.capability('fps', true);await f.runtime.loadouts.refresh();
  const parent = f.runtime.jobs.snapshot().find(j => j.kind === 'loadout.apply');assert.equal((await f.settled(parent.id)).result.fullyApplied, true);
  await f.runtime.loadouts.refresh();await f.runtime.plugins.refresh();assert.deepEqual(f.calls, ['plugin', 'module', 'cheat']);
  f.runtime.graph.safe = true;f.runtime.game = { ...game, generation: boot + '/91/199:0' };await f.runtime.loadouts.refresh();
  assert.equal(f.runtime.jobs.snapshot().filter(j => j.kind === 'loadout.apply').length, 1);
});

test('recovery finds a child accepted between intent and receipt writes without enqueueing any replacement', async t => {
  const f = await fixture(t), accepted = await f.runtime.jobs.handlers.get('loadout.apply').validate({});
  const child = await f.runtime.jobs.enqueue('plugin.start', { sha256: pluginHash, source: 'profile' }, 'recover-child');await f.settled(child.id);
  const outcome = f.runtime.jobs.handlers.get('loadout.apply').reconcile({ args: accepted, checkpoint: { childKey: 'recover-child', steps: [], name: f.profile.name } });
  assert.equal(outcome.fullyApplied, false);assert.equal(outcome.steps[0].id, child.id);assert.deepEqual(f.calls, ['plugin']);
});

test('a later cheat change invalidates adoption and explicit overlay preferences override the current loadout', async t => {
  const f = await fixture(t), job = await f.apply();await f.settled(job.id);
  const plan = await f.runtime.loadouts.plan({}), cheatStep = plan.steps.find(s => s.kind === 'cheat.set');
  const off = await f.runtime.jobs.enqueue('cheat.set', { sha256: f.pack.sha256, cheatId: '0', enabled: false }, f.runtime.id());await f.settled(off.id);
  assert.equal(f.runtime.loadouts.adoptionCurrent(cheatStep, game), false);
  await f.runtime.settings({ overlay: { fps: false } }, f.runtime.store.snapshot().revision);
  assert.equal(f.runtime.overlaySettings().fps, false);assert.equal(f.runtime.overlaySettings().ip, true);
  f.runtime.loadouts.releaseOverlay();assert.equal(f.runtime.overlaySettings().ip, false);
});

test('controller loadout preview requires confirmation, binds reviewed choices, and Circle returns to Games', async t => {
  const f = await fixture(t), deck = new ConsoleDeck(f.runtime);
  const act = (kind, row = 0) => deck.action({ kind, row, request: f.runtime.id(), sequence: deck.frame().sequence });
  await act('next');await act('next');assert.equal(deck.frame().page, 2);
  await act('select', 0);assert.equal(deck.frame().rows[1].label, 'Apply loadout');assert.equal(f.calls.length, 0);
  await act('select', 1);assert.match(deck.frame().rows[0].label, /^Confirm:/);
  await act('back');assert.equal(deck.frame().rows[1].label, 'Apply loadout');
  await act('select', 1);await f.save({ name: 'Changed on phone' });
  await assert.rejects(act('select', 0), { code: 'PROFILE_CHANGED' });assert.equal(f.calls.length, 0);
  await act('back');assert.equal(deck.frame().page, 2);assert.match(deck.frame().rows[0].label, /^Loadout:/);
  await act('select', 0);await act('select', 1);await act('select', 0);
  const parent = f.runtime.jobs.snapshot().find(j => j.kind === 'loadout.apply');assert.equal((await f.settled(parent.id)).result.fullyApplied, true);
});

test('malformed saved loadouts never commit, and deleting a profile preserves already applied state until release', async t => {
  const f = await fixture(t), revision = f.runtime.store.snapshot().revision;
  await assert.rejects(f.runtime.store.transaction(state => { state.profiles.wrong = f.profile; }), { code: 'PROFILE_IDENTITY' });
  assert.equal(f.runtime.store.snapshot().revision, revision);
  const job = await f.apply();await f.settled(job.id);
  await f.runtime.execute('loadout.remove', { ...game, revision: f.runtime.store.snapshot().revision });
  assert.equal(f.runtime.loadouts.profile(), null);assert.equal(f.runtime.overlaySettings().fps, true);
  f.runtime.loadouts.releaseOverlay();assert.equal(f.runtime.overlaySettings().fps, false);
});
