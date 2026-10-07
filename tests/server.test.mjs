import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import { PayloadInbox } from '../src/inbox.mjs';
import { installPackageInbox } from '../src/package-inbox.mjs';
import { serve } from '../src/server.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store, ids, until } from './helpers.mjs';

async function fixture(t) {
  const id = ids(), runtime = await new TacRuntime(await store(), {
    identity: async () => ({ mode: 'development', ip: '127.0.0.1', firmware: null }), install: async () => {}
  }, { id }).start();
  const server = await serve(runtime, { host: '127.0.0.1', port: 0, id, uiRoot: path.resolve('ui') });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await runtime.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { runtime, origin, async connect() {
    const response = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin } });
    assert.equal(response.status, 200); return { cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()) };
  } };
}
test('browser can connect without codes and settings are shared across two devices', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  const response = await fetch(f.origin + '/api/command', { method: 'POST', headers: {
    Origin: f.origin, Cookie: a.cookie, 'X-TacHen-CSRF': a.csrf, 'Content-Type': 'application/json'
  }, body: JSON.stringify({ command: 'settings.update', args: { revision: a.state.revision, patch: { appearance: { accent: 'ice' } } } }) });
  assert.equal(response.status, 200);
  const snapshot = await (await fetch(f.origin + '/api/state', { headers: { Cookie: b.cookie } })).json();
  assert.equal(snapshot.settings.appearance.accent, 'ice');
  assert.equal(snapshot.identity.mode, 'development'); assert.equal(snapshot.capabilities.find(x => x.id === 'kstuff').available, false);
});
test('cross-site pages, DNS rebinding, missing sessions and missing write token are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/api/session', { method: 'POST', headers: { Origin: 'https://attacker.example' } })).status, 403);
  const rebound = await new Promise((resolve, reject) => {
    const request = http.get(f.origin + '/', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(rebound, 403);
  assert.equal((await fetch(f.origin + '/api/state')).status, 401);
  const a = await f.connect();
  assert.equal((await fetch(f.origin + '/api/command', { method: 'POST', headers: { Origin: f.origin, Cookie: a.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});
test('disconnect revokes only that device', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect();
  assert.equal((await fetch(f.origin + '/api/disconnect', { method: 'POST', headers: { Origin: f.origin, Cookie: a.cookie, 'X-TacHen-CSRF': a.csrf } })).status, 200);
  assert.equal((await fetch(f.origin + '/api/state', { headers: { Cookie: a.cookie } })).status, 401);
  assert.equal((await fetch(f.origin + '/api/state', { headers: { Cookie: b.cookie } })).status, 200);
});
test('unsupported controls cannot silently save a pretend native success', async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.settings({ overlay: { fps: true } }, f.runtime.snapshot().revision), { code: 'FEATURE_UNAVAILABLE' });
  assert.equal(f.runtime.snapshot().settings.overlay.fps, false);
});
test('phone API uploads and verifies the built ELF in bounded chunks without executing it', async t => {
  let binary; try { binary = await fs.readFile('build/tachen-runtime.elf'); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Native artifact not built'); return; } throw error; }
  const f = await fixture(t), session = await f.connect();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-api-upload-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  f.runtime.inbox = await new PayloadInbox(root, { id: ids() }).init();
  const headers = { Origin: f.origin, Cookie: session.cookie, 'X-TacHen-CSRF': session.csrf };
  const begin = await fetch(f.origin + '/api/command', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'inbox.begin', args: { name: 'tachen-runtime.elf', bytes: binary.length } }) });
  assert.equal(begin.status, 200); const { result } = await begin.json();
  for (let offset = 0; offset < binary.length;) {
    const chunk = binary.subarray(offset, offset + 512 * 1024);
    const response = await fetch(f.origin + `/api/uploads/${result.id}?offset=${offset}`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: chunk });
    assert.equal(response.status, 200); offset = (await response.json()).offset;
  }
  const verified = await fetch(f.origin + '/api/command', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'inbox.verify', args: { id: result.id } }) });
  assert.equal(verified.status, 200); assert.equal((await verified.json()).result.status, 'verified');
  assert.equal(f.runtime.snapshot().jobs.length, 0);
});

test('phone package upload requires its session, supports resume and queues verification separately', async t => {
  const f = await fixture(t), session = await f.connect(), root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-api-pkg-'));
  t.after(async () => { assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  await installPackageInbox(f.runtime, root);
  const headers = { Origin: f.origin, Cookie: session.cookie, 'X-TacHen-CSRF': session.csrf };
  async function command(command, args) {
    const response = await fetch(f.origin + '/api/command', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ command, args }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  }
  const bytes = Buffer.alloc(8192); bytes.writeUInt32BE(0x7f434e54); bytes.write('UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP', 0x40);
  bytes.writeUInt32BE(0x1a, 0x74); bytes.writeBigUInt64BE(BigInt(bytes.length), 0x430);
  const entry = await command('package.begin', { name: 'phone.pkg', bytes: bytes.length });
  const route = at => f.origin + `/api/package-uploads/${entry.id}?offset=${at}`;
  assert.equal((await fetch(route(0), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).status, 401);
  for (let at = 0; at < bytes.length; at += 4096) {
    const response = await fetch(route(at), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes.subarray(at, at + 4096) });
    assert.equal(response.status, 200); assert.equal((await command('package.status', { id: entry.id })).offset, at + 4096);
  }
  const job = await command('job.enqueue', { kind: 'package.verify', input: { id: entry.id }, key: 'phone-verify' });
  await until(() => f.runtime.jobs.snapshot().find(item => item.id === job.id)?.status === 'completed');
  assert.equal((await command('package.status', { id: entry.id })).package.titleId, 'CUSA00001');
  assert.equal(f.runtime.capabilities.get('packages').available, false);
});
