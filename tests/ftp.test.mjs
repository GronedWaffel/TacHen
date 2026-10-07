import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { Client } from 'basic-ftp';
import { startFtp } from '../src/ftp.mjs';
import { ids, store, checksum } from './helpers.mjs';
import { PayloadInbox } from '../src/inbox.mjs';
import { ftpInboxReceiver } from '../src/ftp-inbox.mjs';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-ftp-'));
  const server = await startFtp({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, id: ids(), ...options });
  const client = new Client(2000); await client.access({ host: '127.0.0.1', port: server.port, user: 'tachen', password: '' });
  t.after(async () => { client.close(); await server.stop(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, server, client };
}
test('real FTP client uploads, lists, downloads and atomically replaces files', async t => {
  const { root, client } = await fixture(t), bytes = Buffer.from('TacHen actual FTP round trip');
  await client.uploadFrom(Readable.from([bytes]), 'payload.elf');
  assert.deepEqual(await fs.readFile(path.join(root, 'payload.elf')), bytes);
  const entries = await client.list(); assert.equal(entries[0].name, 'payload.elf'); assert.equal(entries[0].size, bytes.length);
  const output = []; await client.downloadTo(new Writable({ write(chunk, _encoding, done) { output.push(chunk); done(); } }), 'payload.elf');
  assert.deepEqual(Buffer.concat(output), bytes);
  await client.uploadFrom(Readable.from([Buffer.from('replacement')]), 'payload.elf');
  assert.equal(await fs.readFile(path.join(root, 'payload.elf'), 'utf8'), 'replacement');
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.tachen-')), false);
});
test('FTP directories and renames work without exposing internal temporary files', async t => {
  const { root, client } = await fixture(t);
  await client.ensureDir('/mods'); await client.uploadFrom(Readable.from([Buffer.from('plugin')]), 'a.plugin');
  await client.rename('a.plugin', 'b.plugin'); assert.equal(await client.size('b.plugin'), 6);
  await fs.writeFile(path.join(root, 'mods', '.tachen-secret.part'), 'partial');
  assert.deepEqual((await client.list()).map(file => file.name), ['b.plugin']);
  await assert.rejects(client.downloadTo(new Writable({ write(_b, _e, cb) { cb(); } }), '.tachen-secret.part'));
  assert.equal(await client.pwd(), '/mods');
});
test('share path traversal remains rooted and cannot access sibling data', async t => {
  const { client } = await fixture(t);
  await client.cd('/'); await client.cd('../../../../'); assert.equal(await client.pwd(), '/');
  await assert.rejects(client.size('../../state/state-0.json'));
});

test('completed real FTP payload upload enters the verified inbox without execution', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-import-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  let executed = 0;
  const runtime = { inbox: await new PayloadInbox(folder, { id: ids() }).init(), store: await store(),
    id: ids(), now: Date.now, session: 'test', sequence: 0, jobs: { async enqueue() { executed++; } } };
  const { client, root } = await fixture(t, { onUpload: ftpInboxReceiver(runtime) });
  const bytes = await fs.readFile(new URL('../build/tachen-runtime.elf', import.meta.url));
  await client.uploadFrom(Readable.from([bytes]), '/payloads/real-runtime.elf');
  assert.equal(runtime.inboxItems.length, 1); assert.equal(runtime.inboxItems[0].status, 'verified');
  assert.equal((await runtime.inbox.verify(runtime.inboxItems[0].id)).sha256, checksum(bytes));
  assert.equal(executed, 0); assert.deepEqual(await fs.readFile(path.join(root, 'payloads/real-runtime.elf')), bytes);
  assert.match(runtime.store.snapshot().history[0].message, /added to the payload inbox/);
});

test('invalid FTP payload is preserved as a file, never queued, and reported in activity', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-import-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const runtime = { inbox: await new PayloadInbox(folder, { id: ids() }).init(), store: await store(),
    id: ids(), now: Date.now, session: 'test', sequence: 0, jobs: { enqueue() { assert.fail('Invalid payload dispatched'); } } };
  await runtime.store.transaction(state => { state.settings.services.inboxAutoRun = true; });
  const { client, root } = await fixture(t, { onUpload: ftpInboxReceiver(runtime) });
  await client.uploadFrom(Readable.from([Buffer.alloc(160)]), '/payloads/invalid.elf');
  assert.equal((await fs.stat(path.join(root, 'payloads/invalid.elf'))).size, 160);
  assert.deepEqual(await runtime.inbox.list(), []);
  assert.match(runtime.store.snapshot().history[0].message, /needs attention/);
  assert.match(runtime.store.snapshot().history[0].detail, /ELF/);
});
