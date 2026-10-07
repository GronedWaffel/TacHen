import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from '../src/store.mjs';
import { FileStorage } from '../src/storage.mjs';
import { mergeSettings, defaults } from '../src/settings.mjs';
import { requireFirmware } from '../src/firmware.mjs';
import { checksum, memoryStorage, store } from './helpers.mjs';

test('concurrent state writes preserve every accepted change', async () => {
  const state = await store();
  await Promise.all(Array.from({ length: 30 }, (_, i) => state.transaction(s => {
    const titleId = 'PPSA' + String(i).padStart(5, '0');
    s.profiles[titleId + '@01.000.000'] = { titleId, version: '01.000.000', name: 'Game ' + i,
      plugins: [], cheats: [], overlay: {}, autostart: false };
  })));
  assert.equal(state.snapshot().revision, 30); assert.equal(Object.keys(state.snapshot().profiles).length, 30);
  for (let i = 0; i < 30; i++) assert.equal(state.snapshot().profiles['PPSA' + String(i).padStart(5, '0') + '@01.000.000'].name, 'Game ' + i);
});
test('stale phone revisions cannot overwrite newer preferences', async () => {
  const state = await store();
  await state.transaction(s => { s.settings.appearance.accent = 'ice'; }, 0);
  await assert.rejects(state.transaction(s => { s.settings.appearance.accent = 'amber'; }, 0), { code: 'STATE_CHANGED' });
  assert.equal(state.snapshot().settings.appearance.accent, 'ice');
});
test('damaged newest snapshot recovers previous committed state', async () => {
  const disk = memoryStorage(), state = await new StateStore(disk, checksum).open();
  await state.transaction(s => { s.settings.appearance.accent = 'ice'; });
  await state.transaction(s => { s.settings.appearance.accent = 'amber'; });
  disk.files.set('state-0.json', '{torn');
  const restored = await new StateStore(disk, checksum).open();
  assert.equal(restored.snapshot().settings.appearance.accent, 'ice'); assert.equal(restored.recovered, true);
});
test('total corruption is preserved instead of silently reset', async () => {
  const disk = memoryStorage(); disk.files.set('state-0.json', 'broken'); disk.files.set('state-1.json', 'broken');
  await assert.rejects(new StateStore(disk, checksum).open(), { code: 'STATE_CORRUPT' });
  assert.equal(disk.files.get('state-0.json'), 'broken');
});
test('failed durable commit never updates visible state', async () => {
  const state = await store(); state.storage.fail = true;
  await assert.rejects(state.transaction(s => { s.settings.overlay.ip = true; }), /disk full/);
  assert.equal(state.snapshot().revision, 0); assert.equal(state.snapshot().settings.overlay.ip, false);
});
test('filesystem store survives reopening with no temporary state exposure', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-state-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = await new StateStore(await new FileStorage(root).init(), checksum).open();
  await state.transaction(s => { s.settings.appearance.accent = 'ice'; });
  await fs.writeFile(path.join(root, 'state-0.json.new'), 'interrupted');
  const reopened = await new StateStore(await new FileStorage(root).init(), checksum).open();
  assert.equal(reopened.snapshot().settings.appearance.accent, 'ice');
  await reopened.transaction(s => { s.settings.appearance.reducedMotion = true; });
  assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.new')).length, 0);
});
test('settings reject prototype keys and invalid types; disabling developer clears write gate', () => {
  assert.throws(() => mergeSettings(defaults, JSON.parse('{"__proto__":{"x":true}}')), { code: 'BAD_SETTINGS' });
  assert.throws(() => mergeSettings(defaults, { overlay: { fps: 'true' } }), { code: 'BAD_SETTINGS' });
  assert.equal(mergeSettings(defaults, { developer: { enabled: false, memoryWrites: true } }).developer.memoryWrites, false);
});
test('firmware gate uses exact supported profiles, including explicit 11.40 exclusion', () => {
  for (const fw of ['11.00', '11.20', '12.40', '13.60']) assert.equal(requireFirmware(fw), fw);
  for (const fw of ['10.01', '11.40', '13.61', '13.6', null]) assert.throws(() => requireFirmware(fw), { code: 'FIRMWARE_UNSUPPORTED' });
});
