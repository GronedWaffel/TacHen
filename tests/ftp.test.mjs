import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { Client } from 'basic-ftp';
import { startFtp } from '../src/ftp.mjs';
import { ids } from './helpers.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-ftp-'));
  const server = await startFtp({ root, host: '127.0.0.1', address: '127.0.0.1', port: 0, id: ids() });
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
