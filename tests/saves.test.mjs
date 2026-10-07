// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { installSaves } from '../src/saves.mjs';
import { ConsoleDeck } from '../src/deck.mjs';
import { ids, store, until } from './helpers.mjs';
const selection = { user: '123abc', titleId: 'PPSA00001', slot: 'sdimg_profile', platform: 5, stamp: 'a'.repeat(64), bytes: 8192 };
async function fixture({ mutate = () => {}, listing } = {}) {
  const nativeRequests = new Map();let starts = 0;
  const native = {
    systemProbe: () => ({ kstuff: { state: 'installed', injectionReady: true } }),
    saveStart(request, mode, user, titleId, slot, stamp, destination, volume, platform) {
      starts++;nativeRequests.set(request, { request, mode, user, titleId, slot, stamp, destination, volume, platform });
    },
    savePoll(request) {
      const input = nativeRequests.get(request);if (!input) return null;
      const r = { ...input, stage: 8, pid: 99, ageMs: 0, sameBoot: true, noSideEffects: true, mounted: false, error: 0,
        completedBytes: 8192, totalBytes: 8192, archiveBytes: 8192, files: 1, sha256: 'b'.repeat(64), message: 'Verified',
        output: input.mode === 1 ? `/data/tachen/save-export/${request}.catalog.json` :
          `${input.destination ? `/mnt/usb${input.destination - 1}/TacHen/Saves` : '/data/tachen/share/saves'}/${request}/save.tar` };
      mutate(r);return r;
    },
    saveCatalog: () => JSON.stringify(listing || { version: 1, saves: [selection], skipped: 0,
      volumes: [{ destination: 1, path: '/mnt/usb0', stamp: 'c'.repeat(64), freeBytes: 100000000 }] })
  };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', firmware: '13.60' }),
    install: r => { installSaves(r, native, { delay: () => new Promise(resolve => setTimeout(resolve, 1)) }); } }, { id: ids() }).start();
  let key = 0;
  async function queue(kind, input = {}) {
    const job = await runtime.jobs.enqueue(kind, input, `save-fixture-${++key}`);
    await until(() => ['completed', 'interrupted', 'failed'].includes(runtime.jobs.snapshot().find(j => j.id === job.id).status));
    return runtime.jobs.snapshot().find(j => j.id === job.id);
  }
  return { runtime, native, queue, starts: () => starts, exportInput: { ...selection, destination: 0, volume: '' } };
}
test('save catalog and export use actual queue intent, exact native selection and a verified output', async t => {
  const f = await fixture();t.after(() => f.runtime.close());
  assert.equal((await f.queue('save.refresh')).status, 'completed');
  const list = await f.runtime.execute('save.list', {});assert.deepEqual(list.entries, [selection]);assert.equal(list.volumes.length, 1);
  const job = await f.queue('save.export', f.exportInput);assert.equal(job.status, 'completed');assert.equal(f.starts(), 2);
  assert.equal(job.checkpoint.stamp, selection.stamp);assert.equal(job.result.ftpPath, `/saves/${job.id}/save.tar`);
  assert.equal(job.result.sha256, 'b'.repeat(64));
  const usb = await f.queue('save.export', { ...f.exportInput, destination: 1, volume: 'c'.repeat(64) });
  assert.equal(usb.result.output, `/mnt/usb0/TacHen/Saves/${usb.id}/save.tar`);assert.equal(usb.result.ftpPath, null);
});
test('save exports refuse a stale choice, swapped USB volume or running game before dispatch', async t => {
  const f = await fixture();t.after(() => f.runtime.close());await f.queue('save.refresh');
  await assert.rejects(f.queue('save.export', { ...f.exportInput, stamp: 'd'.repeat(64) }), { code: 'SAVE_CHANGED' });
  await assert.rejects(f.queue('save.export', { ...f.exportInput, destination: 1, volume: 'd'.repeat(64) }), { code: 'SAVE_VOLUME_CHANGED' });
  f.runtime.game = { titleId: selection.titleId };
  await assert.rejects(f.queue('save.export', f.exportInput), { code: 'SAVE_GAME_RUNNING' });assert.equal(f.starts(), 1);
});
test('save timeout keeps its accepted request and reconciles later completion without replay', async t => {
  let stale = true;const f = await fixture({ mutate: r => { if (r.mode === 2 && stale) { r.stage = 5;r.mounted = true;r.noSideEffects = false;r.ageMs = 91000; } } });
  t.after(() => f.runtime.close());await f.queue('save.refresh');const job = await f.queue('save.export', f.exportInput);
  assert.equal(job.status, 'interrupted');assert.equal(job.error.code, 'SAVE_UNCERTAIN');assert.equal(f.starts(), 2);
  await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });stale = false;
  await f.runtime.jobs.reconcile(job.id);assert.equal(f.runtime.jobs.snapshot().at(-1).status, 'completed');assert.equal(f.starts(), 2);
});
test('save completion must prove unmount and bind the exact destination and input identity', async t => {
  for (const corrupt of [r => { r.mounted = true; }, r => { r.output = '/data/unrelated'; }, r => { r.stamp = 'd'.repeat(64); }]) {
    const f = await fixture({ mutate: r => { if (r.mode === 2) corrupt(r); } });t.after(() => f.runtime.close());
    await f.queue('save.refresh');const job = await f.queue('save.export', f.exportInput);
    assert.equal(job.status, 'interrupted');assert.equal(job.error.code, 'SAVE_RECEIPT');
  }
});
test('save helper rejects cleanly but uncertain mount outcomes retain the queue lock', async t => {
  let uncertain = false;const f = await fixture({ mutate: r => { if (r.mode === 2) { r.stage = uncertain ? 10 : 9;r.noSideEffects = !uncertain;r.mounted = uncertain; } } });
  t.after(() => f.runtime.close());await f.queue('save.refresh');assert.equal((await f.queue('save.export', f.exportInput)).status, 'failed');
  uncertain = true;assert.equal((await f.queue('save.export', f.exportInput)).status, 'interrupted');
  const queued = await f.runtime.jobs.enqueue('save.refresh', {}, 'after-unknown-save');
  await new Promise(resolve => setTimeout(resolve, 15));assert.equal(f.runtime.jobs.snapshot().find(j => j.id === queued.id).status, 'queued');
});
test('save catalog validates nested identities rather than trusting helper JSON', async t => {
  const f = await fixture({ listing: { version: 1, saves: [{ ...selection, slot: 'sdimg_../../bad' }], volumes: [], skipped: 0 } });t.after(() => f.runtime.close());
  const job = await f.queue('save.refresh');assert.equal(job.status, 'interrupted');assert.equal(job.error.code, 'SAVE_CATALOG');assert.equal(f.runtime.saves.snapshot().count, 0);
});
test('controller save export reviews its destination and uses the same job as the phone', async t => {
  const f = await fixture();t.after(() => f.runtime.close());await f.queue('save.refresh');
  const deck = new ConsoleDeck(f.runtime);deck.page = 2;
  const select = async label => {
    const frame = deck.frame(), index = frame.rows.findIndex(r => r.label === label);assert.ok(index >= 0, label);
    return deck.action({ kind: 'select', sequence: frame.sequence, row: index, request: f.runtime.id() });
  };
  await select('Saved games');await select(selection.titleId);assert.equal(f.starts(), 1);
  await select('Export to FTP share');assert.equal(f.starts(), 1);
  await select('Confirm: Export to FTP share');
  await until(() => f.runtime.jobs.snapshot().at(-1).status === 'completed');
  assert.equal(f.starts(), 2);assert.equal(f.runtime.jobs.snapshot().at(-1).args.stamp, selection.stamp);
  await deck.action({ kind: 'back', sequence: deck.frame().sequence, request: f.runtime.id() });
  assert.ok(deck.frame().rows.some(r => r.label === 'Refresh saves'));
});
test('save helpers remain held during recovery startup even when called directly through the command API', async t => {
  const f = await fixture();t.after(() => f.runtime.close());f.runtime.graph.safe = true;
  await assert.rejects(f.runtime.execute('job.enqueue', { kind: 'save.refresh', input: {}, key: 'recovery-save-test' }), { code: 'SAFE_STARTUP' });
  assert.equal(f.starts(), 0);
});
