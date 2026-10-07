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
test('native renderer availability is never inferred from phone availability', async t => {
  const runtime = await fixture(t);
  assert.equal(runtime.capabilities.get('deck').available, false); assert.equal(runtime.capabilities.get('phone').available, true);
  assert.ok(!JSON.stringify(runtime.snapshot()).includes('deckCredential'));
});
test('deck and phone share optimistic settings; stale controller selections do not overwrite phone changes', async t => {
  const runtime = await fixture(t), deck = runtime.consoleDeck;
  await deck.action(action(runtime, 'previous')); assert.equal(deck.frame().page, 5);
  await deck.action(action(runtime, 'previous')); assert.equal(deck.frame().page, 4);
  const old = action(runtime, 'select', 4);
  await runtime.settings({ appearance: { reducedMotion: true } }, runtime.snapshot().revision);
  await assert.rejects(deck.action(old), { code: 'DECK_STALE' });
  await deck.action(action(runtime, 'select', 4)); assert.equal(runtime.snapshot().settings.appearance.reducedMotion, false);
});
test('payload dispatch requires confirmation, duplicate controller requests execute once', async t => {
  const runtime = await fixture(t), deck = runtime.consoleDeck;
  runtime.capability('payloads', true); runtime.inboxItems = [{ id: runtime.id(), name: 'test.elf', status: 'verified' }];
  const calls = []; runtime.execute = async (...args) => calls.push(args);
  await deck.action(action(runtime, 'next'));
  await deck.action(action(runtime, 'select')); assert.equal(calls.length, 0); assert.match(deck.frame().title, /Confirm/);
  const confirm = action(runtime, 'select'); await Promise.all([deck.action(confirm), deck.action(confirm)]);
  assert.equal(calls.length, 1); assert.equal(calls[0][1].kind, 'payload.dispatch'); assert.equal(calls[0][1].key, confirm.request);
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
  await deck.action(action(runtime, 'select')); const calls = []; runtime.execute = async (...args) => calls.push(args);
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
});
test('actual C controller engine decodes JS wire and handles input/recovery without native console APIs', async () => {
  await fs.mkdir('build/tests', { recursive: true });
  const binary = encodeDeck({ sequence: 1, page: 0, ready: true, title: 'TacHen', subtitle: 'Native test', footer: 'Controls', ip: '127.0.0.1',
    rows: Array.from({ length: 3 }, (_, i) => ({ token: 'a'.repeat(32), label: i === 1 ? 'Payload 二' : 'Row ' + i, detail: '', enabled: true })) });
  await fs.writeFile('build/tests/deck-frame.bin', binary);
  const zig = process.env.ZIG || path.resolve('../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const compile = spawnSync(zig, ['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-Iplatform/deck', 'platform/deck/deck-core.c', 'tests/deck-core-runner.c', '-o', 'build/tests/deck-core.exe'], { encoding: 'utf8' });
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
