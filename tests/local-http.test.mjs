import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { localGet, localRequest } from '../src/local-http.mjs';
async function server(t, reply) {
  const connections = new Set();
  const server = createServer(socket => { connections.add(socket); socket.on('error', () => {}); socket.once('close', () => connections.delete(socket)); socket.once('data', request => reply(socket, request)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of connections) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}
test('loopback client reads a real fragmented content-length service response', async t => {
  const port = await server(t, (socket, request) => {
    assert.match(request.toString(), /^GET \/version HTTP\/1.0/);
    socket.write('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n0.'); setTimeout(() => socket.end('5.2'), 3);
  });
  assert.equal((await localGet(port, '/version')).text, '0.5.2');
});
test('loopback client rejects truncated, redirected, encoded and oversized responses', async t => {
  for (const reply of ['HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nshort', 'HTTP/1.1 302 Found\r\nLocation: /other\r\n\r\n',
    'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n', 'HTTP/1.1 200 OK\r\n\r\n' + 'a'.repeat(9000)]) {
    const port = await server(t, socket => socket.end(reply));
    await assert.rejects(localGet(port, '/version', { maxBytes: 32 }));
  }
});
test('loopback client enforces a total deadline even if a listener never responds', async t => {
  const port = await server(t, () => {});
  await assert.rejects(localGet(port, '/version', { timeout: 20 }), { code: 'LOCAL_TIMEOUT' });
});
test('ShadowMount readiness uses its real POST-only JSON API contract', async t => {
  const port = await server(t, (socket, request) => {
    assert.match(request.toString(), /^POST \/api\/v1\/version HTTP\/1.0/);
    assert.match(request.toString(), /Content-Type: application\/json\r\nContent-Length: 2\r\n\r\n\{\}$/);
    socket.end('HTTP/1.1 200 OK\r\nContent-Length: 12\r\n\r\n{"status":0}');
  });
  assert.deepEqual(JSON.parse((await localRequest(port, '/api/v1/version', { method: 'POST', body: {} })).text), { status: 0 });
});
