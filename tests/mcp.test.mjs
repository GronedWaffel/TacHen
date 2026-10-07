import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installMcp } from '../src/mcp.mjs';
import { installMemory } from '../src/memory-service.mjs';
import { installCheats } from '../src/cheat-service.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { serve } from '../src/server.mjs';
import { store, memoryStorage, ids, until } from './helpers.mjs';
async function fixture(t) {
  let time = Date.now();const calls = [], receipts = new Map();
  const game = { titleId: 'PPSA04263', version: '01.000.000', pid: 91, generation: '100:0/91/101:0', metadataHash: 'a'.repeat(64) };
  const native = { systemProbe: () => ({ boot: '100:0', kstuff: { injectionReady: true }, processes: [{ pid: 91, generation: game.generation }] }),
    inspectStart(request, pid, generation, title, metadata, module, wire) {
      calls.push('read');const packet = Buffer.from(wire), n = packet.readUInt32LE(8), bytes = new ArrayBuffer(n);
      receipts.set(request, { request, pid, generation, planHash: createHash('sha256').update(packet).digest('hex'), stage: 3, resumed: true, restored: true,
        writes: 0, base: '0x400000', size: '0x100000', bytes });
    }, inspectPoll: id => receipts.get(id),
    cheatStart(request, pid, generation, title, metadata, module, wire) {
      calls.push('write');receipts.set(request, { request, pid, generation, planHash: createHash('sha256').update(Buffer.from(wire)).digest('hex'),
        stage: 3, resumed: true, restored: false, writes: 1 });
    }, cheatPoll: id => receipts.get(id) };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    install(r) { installMemory(r, native);installCheats(r, native, memoryStorage());installMcp(r); }
  }, { id: ids(), now: () => time }).start();runtime.game = game;
  const entry = await runtime.cheats.packs.import({ ...game, source: JSON.stringify({ name: 'Fixture', process: 'eboot.bin',
    mods: [{ name: 'Fixture option', memory: [{ offset: '10', on: '90', off: '01' }] }] }) });
  const server = await serve(runtime, { host: '127.0.0.1', port: 0, id: runtime.id, uiRoot: path.resolve('ui') });
  t.after(async () => { server.closeAllConnections();await new Promise(resolve => server.close(resolve));await runtime.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin } });
  const cookie = response.headers.get('set-cookie').split(';')[0], { csrf } = await response.json();
  const phone = async (command, args = {}) => {
    const response = await fetch(origin + '/api/command', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-TacHen-CSRF': csrf,
      'Content-Type': 'application/json' }, body: JSON.stringify({ command, args }) });
    return { status: response.status, ...(await response.json()) };
  };
  const enable = () => phone('settings.update', { patch: { developer: { enabled: true } }, revision: runtime.snapshot().revision });
  let token, session;
  const rpc = (body, overrides = {}) => fetch(origin + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session, 'Mcp-Protocol-Version': '2025-06-18' } : {}), ...overrides }, body: JSON.stringify(body) });
  const connect = async () => {
    session = undefined;
    await enable();({ result: { token } } = await phone('developer.connect'));
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Test client', version: '1' }, capabilities: {} } });
    assert.equal(response.status, 200);assert.equal((await response.json()).result.protocolVersion, '2025-06-18');
    session = response.headers.get('mcp-session-id');assert.match(session, /^[a-f0-9]{32}$/);
    const ready = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });assert.equal(ready.status, 202);assert.equal(await ready.text(), '');
  };
  const call = async (name, args = {}) => {
    const response = await rpc({ jsonrpc: '2.0', id: runtime.id(), method: 'tools/call', params: { name, arguments: args } });
    assert.equal(response.status, 200);const result = (await response.json()).result;return { error: result.isError || false, value: JSON.parse(result.content[0].text) };
  };
  return { runtime, calls, entry, phone, origin, enable, connect, call, rpc, token: () => token, session: () => session, tick: ms => time += ms };
}
test('real MCP HTTP lifecycle lists tools and completes a native-read contract without exposing tokens', async t => {
  const f = await fixture(t);await f.connect();
  const list = await f.rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });assert.equal(list.status, 200);
  assert.ok((await list.json()).result.tools.some(tool => tool.name === 'memory_inspect'));
  const read = await f.call('memory_inspect', { mode: 'read', module: 'eboot.bin', offset: '0x10', length: 8, requestKey: 'read-request-1' });
  assert.equal(read.error, false);await until(() => f.runtime.jobs.snapshot().find(j => j.id === read.value.id)?.status === 'completed');
  assert.equal((await f.call('memory_result', { id: read.value.id })).value.bytes, '0000000000000000');
  await f.call('memory_inspect', { mode: 'read', module: 'eboot.bin', offset: '0x10', length: 8, requestKey: 'read-request-1' });assert.deepEqual(f.calls, ['read']);
  assert.equal(JSON.stringify(f.runtime.snapshot()).includes(f.token()), false);assert.equal(JSON.stringify(f.runtime.store.snapshot()).includes(f.token()), false);
});

test('MCP refinement narrows existing candidates without requiring or expanding the write grant', async t => {
  const f = await fixture(t);await f.connect();
  const scan = await f.call('memory_inspect', { mode: 'scan', module: 'eboot.bin', length: 16, pattern: '0000', alignment: 2, requestKey: 'refine-source-scan' });
  assert.equal(scan.error, false);await until(() => f.runtime.jobs.snapshot().find(j => j.id === scan.value.id)?.status === 'completed');
  const args = { source: scan.value.id, comparison: 'unchanged', requestKey: 'refine-first-pass' };
  const pass = await f.call('memory_refine', args);assert.equal(pass.error, false);
  await until(() => f.runtime.jobs.snapshot().find(j => j.id === pass.value.id)?.status === 'completed');
  const result = await f.call('memory_result', { id: pass.value.id });assert.equal(result.error, false);
  assert.equal(result.value.mode, 'refine');assert.equal(result.value.matches.length, 8);assert.equal(result.value.candidatesChecked, 8);
  assert.equal(f.runtime.snapshot().settings.developer.memoryWrites, false);assert.deepEqual(f.calls, ['read', 'read']);
  assert.equal((await f.call('memory_refine', args)).value.id, pass.value.id);assert.equal(f.calls.length, 2);
  await f.phone('developer.disconnect');await f.connect();
  const expired = await f.call('memory_refine', { ...args, requestKey: 'refine-after-revoke' });
  assert.equal(expired.error, true);assert.equal(expired.value.code, 'SCAN_SOURCE_EXPIRED');assert.equal(f.calls.length, 2);
});
test('MCP rejects missing auth, cross-site origins, protocol mismatches and expired or revoked grants', async t => {
  const f = await fixture(t);assert.equal((await f.rpc({})).status, 401);assert.equal((await f.phone('developer.connect')).status, 409);
  await f.connect();const ping = { jsonrpc: '2.0', id: 3, method: 'ping' };
  assert.equal((await f.rpc(ping, { Origin: 'https://outside.example' })).status, 403);
  assert.equal((await f.rpc(ping, { 'Mcp-Protocol-Version': '2099-01-01' })).status, 400);
  assert.equal((await f.rpc(ping, { Accept: 'application/json' })).status, 406);
  assert.equal((await fetch(f.origin + '/mcp', { headers: { Authorization: 'Bearer ' + f.token() } })).status, 405);
  f.tick(3600001);assert.equal((await f.rpc(ping)).status, 401);
  assert.equal(f.runtime.mcp.sessions.size, 0);assert.equal(f.runtime.mcp.secret, null);
});
test('MCP writes require the phone switch and revocation cancels a queued write before native execution', async t => {
  const f = await fixture(t);await f.connect();const args = { sha256: f.entry.sha256, cheatId: '0', enabled: true, requestKey: 'write-request-1' };
  assert.equal((await f.call('cheat_set', args)).value.code, 'MEMORY_WRITES_DISABLED');assert.equal(f.calls.length, 0);
  await f.phone('settings.update', { patch: { developer: { memoryWrites: true } }, revision: f.runtime.snapshot().revision });
  f.runtime.jobs.pumping = true;const queued = await f.call('cheat_set', args);assert.equal(queued.error, false);
  await f.phone('developer.disconnect');f.runtime.jobs.pumping = false;f.runtime.jobs.kick();
  await until(() => f.runtime.jobs.snapshot().find(j => j.id === queued.value.id)?.status === 'failed');assert.equal(f.calls.length, 0);
  assert.equal((await f.rpc({ jsonrpc: '2.0', id: 4, method: 'ping' })).status, 401);
});
test('MCP cannot enable its own write gate and deleted sessions must reinitialize', async t => {
  const f = await fixture(t);await f.connect();
  assert.equal((await f.call('settings.update', { developer: { memoryWrites: true } })).value.code, 'MCP_TOOL');
  assert.equal((await f.call('console_status', JSON.parse('{"__proto__":{}}'))).value.code, 'MCP_ARGUMENTS');
  const removed = await fetch(f.origin + '/mcp', { method: 'DELETE', headers: { Authorization: 'Bearer ' + f.token(), 'Mcp-Session-Id': f.session() } });
  assert.equal(removed.status, 204);assert.equal((await f.rpc({ jsonrpc: '2.0', id: 5, method: 'ping' })).status, 404);
});
