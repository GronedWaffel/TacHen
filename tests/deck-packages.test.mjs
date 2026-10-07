import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TacRuntime } from '../src/runtime.mjs';
import { ConsoleDeck, encodeDeck } from '../src/deck.mjs';
import { packageDeckRows } from '../src/deck-packages.mjs';
import { installPackageInbox } from '../src/package-inbox.mjs';
import { installPackageInstaller } from '../src/package-install.mjs';
import { store, ids, until } from './helpers.mjs';
async function fixture(t, firmware = '13.60') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-controller-pkg-'));
  let starts = 0, polls = 0, submitted;
  const native = { systemProbe: () => ({ kstuff: { state: 'installed', injectionReady: true } }),
    packageStart(request, upload, sha256, contentId, _type, _platform, _patch, bytes) {
      starts++; submitted = { request, upload, sha256, contentId, bytes };
    },
    packagePoll() { polls++; return { ...submitted, stage: 6, error: 0, ageMs: 0, accepted: true, observed: true, sameBoot: true }; } };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', firmware }),
    async install(r) { await installPackageInbox(r, root); installPackageInstaller(r, native); } }, { id: ids() }).start();
  t.after(async () => { await runtime.close(); await fs.rm(root, { recursive: true, force: true }); });
  const bytes = Buffer.alloc(8192); bytes.writeUInt32BE(0x7f434e54); bytes.write('UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP', 0x40);
  bytes.writeUInt32BE(0x1a, 0x74); bytes.writeBigUInt64BE(BigInt(bytes.length), 0x430);
  const item = await runtime.execute('package.begin', { name: 'test.pkg', bytes: bytes.length });
  await runtime.packageInbox.append(item.id, 0, bytes); runtime.packageItems = await runtime.packageInbox.list();
  const deck = new ConsoleDeck(runtime);
  return { runtime, deck, item, starts: () => starts, polls: () => polls };
}
const action = (f, kind, row = 0) => ({ kind, row, sequence: f.deck.frame().sequence, request: f.runtime.id() });
async function choose(f, label) {
  for (let i = 0; i < 20; i++) {
    const rows = f.deck.frame().rows, at = rows.findIndex(row => typeof label === 'string' ? row.label === label : label.test(row.label));
    if (at >= 0) return f.deck.action(action(f, 'select', at));
    const next = rows.findIndex(row => row.label === 'More items'); assert(next >= 0, 'Missing: ' + label);
    await f.deck.action(action(f, 'select', next));
  }
  assert.fail('Too many pages');
}
async function open(f) { await f.deck.action(action(f, 'next')); await f.deck.action(action(f, 'next')); await choose(f, 'Packages'); await choose(f, 'test.pkg'); }
async function verify(f) { await choose(f, 'Verify package'); await until(() => f.runtime.jobs.snapshot().some(j => j.kind === 'package.verify' && j.status === 'completed')); }

test('controller package verification and install confirmation share the existing native job handler', async t => {
  const f = await fixture(t); await open(f); await verify(f); assert.equal(f.starts(), 0);
  await choose(f, 'Install package'); assert.equal(f.starts(), 0);
  const confirmation = action(f, 'select'); await Promise.all([f.deck.action(confirmation), f.deck.action(confirmation)]);
  await until(() => f.runtime.jobs.snapshot().some(j => j.kind === 'package.install' && j.status === 'completed'));
  assert.equal(f.starts(), 1);
  assert.equal(f.runtime.jobs.snapshot().at(-1).args.sha256, f.runtime.jobs.snapshot()[0].result.sha256);
  const before = f.polls(); for (let i = 0; i < 5; i++) encodeDeck(f.deck.frame()); assert.equal(f.polls(), before);
  assert(f.deck.frame().rows.some(row => row.detail.includes('full installation')));
});

test('Circle unwinds package confirmation, detail, list and games without submitting an install', async t => {
  const f = await fixture(t); await open(f); await verify(f); await choose(f, 'Install package');
  await f.deck.action(action(f, 'back')); assert.equal(f.deck.packageView.id, f.item.id); assert.equal(f.deck.confirmation, null);
  await f.deck.action(action(f, 'back')); assert.deepEqual(f.deck.packageView, {});
  await f.deck.action(action(f, 'back')); assert.equal(f.deck.packageView, null); assert.equal(f.deck.page, 2); assert.equal(f.starts(), 0);
});

test('lower firmware enables controller installation while recovery still prevents submission', async t => {
  const f = await fixture(t, '12.40'); await open(f); f.runtime.graph.safe = true; await verify(f);
  let install = f.deck.frame().rows.find(row => row.label === 'Install package'); assert.equal(install.enabled, false); assert.match(install.detail, /recovery/);
  f.runtime.graph.safe = false; install = f.deck.frame().rows.find(row => row.label === 'Install package');
  assert.equal(install.enabled, true); assert.equal(f.starts(), 0);
  await choose(f, 'Install package'); assert(f.deck.confirmation); assert.equal(f.starts(), 0);
});

test('phone activity or changed verification invalidates a pending controller install review', async t => {
  const f = await fixture(t); await open(f); await verify(f); await choose(f, 'Install package');
  await f.runtime.store.transaction(state => { state.jobs[0].result.sha256 = 'e'.repeat(64); });
  await assert.rejects(choose(f, /^Confirm:/), { code: 'PACKAGE_REVIEW_CHANGED' }); assert.equal(f.starts(), 0);
  await choose(f, 'Install package');
  await f.runtime.store.transaction(state => state.jobs.push({ id: f.runtime.id(), kind: 'package.install', args: { id: f.item.id },
    resources: ['package-file:' + f.item.id], status: 'interrupted', createdAt: 0, updatedAt: 0 }));
  await assert.rejects(choose(f, /^Confirm:/), { code: 'PACKAGE_REVIEW_CHANGED' }); assert.equal(f.starts(), 0);
});

test('package job controls distinguish held work, running installs and unknown outcomes', () => {
  const id = 'a'.repeat(32), state = { packages: [{ id, name: 'staged.pkg', status: 'verified', bytes: 8192, offset: 8192 }], capabilities: [] };
  const rows = (status, kind = 'package.install') => packageDeckRows(state, { id }, [{ id: 'job', kind, status, resources: ['package-file:' + id] }]);
  assert(rows('held').some(r => r.command === 'job.resume'));
  assert(rows('queued').some(r => r.command === 'job.cancel'));
  assert(!rows('running').some(r => r.command === 'job.cancel'));
  assert(rows('running', 'package.verify').some(r => r.command === 'job.cancel'));
  const interrupted = rows('interrupted'); assert(interrupted.some(r => r.command === 'job.reconcile'));
  assert(!interrupted.some(r => r.enabled && r.command === 'job.enqueue'));
  const legacy = packageDeckRows(state, { id }, [{ kind: 'package.verify', status: 'completed', resources: ['package-file:' + id], result: { sha256: 'b'.repeat(64) } }]);
  assert(legacy.some(r => r.enabled && r.args?.kind === 'package.verify'), 'Incomplete old evidence must offer reverification');
});
