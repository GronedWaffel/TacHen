import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { ConsoleDeck } from '../src/deck.mjs';
import { installLoadouts } from '../src/loadouts.mjs';
import { installPlugins } from '../src/plugins.mjs';
import { store, ids } from './helpers.mjs';
async function fixture(t) {
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }), install() {} }, { id: ids() }).start();
  t.after(() => runtime.close());return runtime;
}
const update = (r, patch) => r.settings(patch, r.store.snapshot().revision);
const latest = r => r.store.snapshot().history.at(-1);
const undo = (r, entry) => r.execute('history.undo', r.changes.preview({ id: entry.id }));

test('undo restores only changed preferences, preserves unrelated later choices and deduplicates concurrent requests', async t => {
  const r = await fixture(t);
  await update(r, { appearance: { accent: 'ice' } });const original = latest(r);
  await update(r, { appearance: { reducedMotion: true } });
  const result = await Promise.all([undo(r, original), undo(r, original)]);
  assert.ok(result.every(v => v.reversed));assert.equal(r.snapshot().settings.appearance.accent, 'mint');
  assert.equal(r.snapshot().settings.appearance.reducedMotion, true);
  assert.equal(r.store.snapshot().history.filter(e => e.reversalOf === original.id).length, 1);
  assert.equal(r.changes.preview(original).available, false);
});

test('same-field ABA edits require reverse order and completed reversals release earlier undo', async t => {
  const r = await fixture(t);
  await update(r, { appearance: { accent: 'ice' } });const first = latest(r);
  await update(r, { appearance: { accent: 'mint' } });const second = latest(r);
  await update(r, { appearance: { accent: 'ice' } });const third = latest(r);
  assert.equal(r.changes.preview(first).available, false);
  await assert.rejects(undo(r, first), { code: 'HISTORY_CONFLICT' });
  await undo(r, third);await undo(r, second);assert.equal(r.changes.preview(first).available, true);
  await undo(r, first);assert.equal(r.snapshot().settings.appearance.accent, 'mint');
});

test('a stale review, corrupted proof, previous session and developer permission changes cannot be undone', async t => {
  const r = await fixture(t);
  await update(r, { appearance: { accent: 'ice' } });const entry = latest(r), reviewed = r.changes.preview(entry);
  await update(r, { appearance: { accent: 'mint' } });
  await assert.rejects(r.execute('history.undo', reviewed), { code: 'HISTORY_CONFLICT' });
  await assert.rejects(r.execute('history.undo', { ...reviewed, proof: 'a'.repeat(64) }), { code: 'HISTORY_CHANGED' });
  r.capability('mcp', true);await update(r, { developer: { enabled: true } });const grant = latest(r);
  assert.equal(r.changes.preview(grant).available, false);await assert.rejects(undo(r, grant), { code: 'HISTORY_CONFLICT' });
  r.session = r.id();assert.equal(r.changes.preview(entry).available, false);assert.deepEqual(r.snapshot().history, []);
});

test('failed persistence or unavailable renderer does not record an undo or invoke overlay side effects', async t => {
  const r = await fixture(t);let resets = 0, overrides = 0;
  r.capability('fps', true);r.telemetry = { reset() { resets++; }, snapshot() { return null; }, stop() {} };
  r.loadouts = { overrideOverlay() { overrides++; }, overlay() { return {}; }, snapshot() { return null; }, stop() {} };
  await update(r, { overlay: { fps: true } });const first = latest(r);
  await update(r, { overlay: { fps: false } });const second = latest(r);
  r.capability('fps', false, 'Renderer unavailable');
  await assert.rejects(undo(r, second), { code: 'FEATURE_UNAVAILABLE' });assert.equal(latest(r).undone, null);
  r.capability('fps', true);r.store.storage.fail = true;
  await assert.rejects(undo(r, second), /disk full/);assert.equal(latest(r).undone, null);
  assert.equal(resets, 2);assert.equal(overrides, 2);r.store.storage.fail = false;
  await undo(r, second);await undo(r, first);assert.equal(resets, 4);assert.equal(overrides, 4);
});

test('saved loadout create/remove reversals preserve applied native state and validate original identity', async t => {
  const r = await fixture(t);installLoadouts(r, {});
  const profile = { titleId: 'PPSA00001', version: '01.000.000', name: 'My game', plugins: [], cheats: [], overlay: { fps: true }, autostart: true };
  await r.execute('loadout.save', { profile, revision: r.snapshot().revision });const saved = latest(r);
  await r.execute('loadout.remove', { titleId: profile.titleId, version: profile.version, revision: r.snapshot().revision });const removed = latest(r);
  await undo(r, removed);assert.equal(Object.values(r.store.snapshot().profiles)[0].autostart, true);
  await undo(r, saved);assert.deepEqual(r.store.snapshot().profiles, {});assert.equal(r.jobs.snapshot().length, 0);
});

test('plugin autostart undo restores its choice without unloading or starting code', async t => {
  const r = await fixture(t), hash = 'a'.repeat(64), upload = 'b'.repeat(32);
  r.inbox = { verify: async () => ({ id: upload, name: 'test.plugin', format: 'plugin', sha256: hash, pluginId: 'TACP00001', pluginVersion: '1.00' }) };
  installPlugins(r, {});await r.plugins.register({ upload, scope: 'system', revision: r.snapshot().revision });
  assert.equal(r.changes.preview(latest(r)).available, false);
  await r.plugins.configure({ sha256: hash, autostart: true, revision: r.snapshot().revision });const entry = latest(r);
  r.plugins.observations.set(hash, { phase: 'running', pid: 90 });await undo(r, entry);
  assert.equal(r.plugins.list()[0].autostart, false);assert.equal(r.plugins.list()[0].observation.phase, 'running');assert.equal(r.jobs.snapshot().length, 0);
});

test('controller reviews and confirms history; Circle unwinds to Activity and concurrent changes reject stale undo', async t => {
  const r = await fixture(t), deck = new ConsoleDeck(r);
  const action = (kind, row = 0) => deck.action({ kind, row, request: r.id(), sequence: deck.frame().sequence });
  await update(r, { appearance: { reducedMotion: true } });
  await action('next');await action('next');await action('next');await action('select');await action('select');
  assert.match(deck.frame().title, /Session history/);
  await action('select', 2);assert.match(deck.frame().title, /Confirm action/);
  await action('back');assert.match(deck.frame().title, /Session history/);assert.equal(r.snapshot().settings.appearance.reducedMotion, true);
  await action('select', 2);await action('select');assert.equal(r.snapshot().settings.appearance.reducedMotion, false);
  await action('back');await action('back');assert.match(deck.frame().title, /Activity/);
  await update(r, { appearance: { reducedMotion: true } });await action('select');await action('select');await action('select', 2);
  await update(r, { appearance: { reducedMotion: false } });
  await assert.rejects(action('select'), { code: 'HISTORY_CONFLICT' });assert.equal(r.snapshot().settings.appearance.reducedMotion, false);
});

test('same-value edits do not grow history and bounded history can expire an open controller entry safely', async t => {
  const r = await fixture(t);await update(r, { appearance: { accent: 'mint' } });assert.equal(r.snapshot().history.length, 0);
  await update(r, { appearance: { accent: 'ice' } });const entry = latest(r), deck = new ConsoleDeck(r);deck.page = 3;deck.historyView = { id: entry.id };
  await r.store.transaction(state => {
    for (let i = 0; i < 260; i++) r.changes.record(state, { change: 'test', after: i, message: 'Recorded' });
  });
  assert.equal(r.store.snapshot().history.length, 256);assert.match(deck.frame().rows[0].label, /no longer available/);
});
