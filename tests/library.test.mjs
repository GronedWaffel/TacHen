import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { installLibrary } from '../src/library.mjs';
import { localRequest } from '../src/local-http.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store, ids, until } from './helpers.mjs';
async function fixture(t) {
  const evidence = { ready: true, id: 'shadowmount', boot: 'one', pid: 30, generation: 'process-one', version: '1.7beta4' };
  const game = { title_id: 'PPSA00001', title_name: 'Test game', content_id: 'CONTENT00001', platform: 'ps5',
    path: '/data/games/test.ffpkg', source_type: 'image', installed: true, mounted: false, installed_pkg: false,
    source_available: true, can_manage_source: true, app_db_size_bytes: 1000000 };
  const calls = [], state = { game, evidence, busy: false, games: null };
  const server = createServer(async (req, res) => {
    assert.equal(req.method, 'POST'); assert.equal(req.headers['content-type'], 'application/json');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push({ route: req.url, body });
    let response;
    if (req.url === '/api/v1/games') {
      assert.equal(body.include_size, false);
      response = { status: 0, count: state.games?.length ?? 1, games: state.games || [game] };
    } else {
      assert.equal(body.title_id, game.title_id);
      if (state.busy) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end('{"status":16,"error":"Device busy"}'); }
      game.mounted = req.url === '/api/v1/games/mount'; response = { status: 0, title_id: game.title_id, mounted: game.mounted };
    }
    const data = JSON.stringify(response); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }); res.end(data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const runtime = new TacRuntime(await store(), { identity: async () => ({ mode: 'development' }), async install(runtime) {
    runtime.nativeServices = { inspect: async () => structuredClone(evidence) };
    installLibrary(runtime, { request: (_port, route, options) => localRequest(server.address().port, route, options) });
  } }, { id: ids() });
  await runtime.start(); return { runtime, state, calls };
}
test('game library uses ShadowMount POST contract without recursively measuring game directories', async t => {
  const { runtime, calls } = await fixture(t);
  const page = await runtime.execute('library.refresh', {});
  assert.equal(page.games[0].titleId, 'PPSA00001'); assert.equal(page.games[0].canMount, true);
  assert.deepEqual(calls, [{ route: '/api/v1/games', body: { include_size: false } }]);
  assert.equal(runtime.snapshot().library.count, 1); assert.equal(runtime.snapshot().library.games, undefined);
});
test('mount and unmount complete only after independent observation and bind the game source', async t => {
  const { runtime, state, calls } = await fixture(t);
  await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'mount-one');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed'); assert.equal(state.game.mounted, true);
  const repeated = await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'mount-one');
  assert.equal(repeated.id, runtime.jobs.snapshot()[0].id); assert.equal(runtime.jobs.snapshot().length, 1);
  await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: false }, 'unmount-one');
  await until(() => runtime.jobs.snapshot()[1].status === 'completed'); assert.equal(state.game.mounted, false);
  assert.equal(calls.filter(item => item.route.endsWith('/mount')).length, 1);
  assert.equal(calls.filter(item => item.route.endsWith('/unmount')).length, 1);
});
test('installed packages and unavailable sources cannot enter mount queue', async t => {
  const { runtime, state } = await fixture(t); state.game.installed_pkg = true;
  await assert.rejects(runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'package-mount'), { code: 'LIBRARY_SOURCE' });
  state.game.installed_pkg = false; state.game.source_available = false;
  await assert.rejects(runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'missing-mount'), { code: 'LIBRARY_SOURCE' });
});
test('busy mount remains interrupted until the unchanged prior state is independently reconciled', async t => {
  const { runtime, state, calls } = await fixture(t); state.busy = true;
  const job = await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'busy-mount');
  await until(() => runtime.jobs.snapshot()[0].status === 'interrupted');
  await runtime.jobs.reconcile(job.id); assert.equal(runtime.jobs.snapshot()[0].status, 'failed');
  assert.equal(calls.filter(item => item.route.endsWith('/mount')).length, 1);
});
test('queued mount rejects replacement game content and never sends the write', async t => {
  const { runtime, state, calls } = await fixture(t); runtime.jobs.concurrency = 0;
  await runtime.jobs.enqueue('library.mount', { titleId: 'PPSA00001', mounted: true }, 'changed-mount');
  state.game.path = '/data/games/replacement.ffpkg'; runtime.jobs.concurrency = 2; runtime.jobs.kick();
  await until(() => runtime.jobs.snapshot()[0].status === 'failed');
  assert.equal(runtime.jobs.snapshot()[0].error.code, 'LIBRARY_CHANGED'); assert.equal(calls.filter(item => item.route.endsWith('/mount')).length, 0);
});
test('library search is paged and periodic runtime state never duplicates the catalog', async t => {
  const { runtime, state } = await fixture(t);
  state.games = Array.from({ length: 250 }, (_, index) => ({ ...state.game, title_id: 'PPSA' + String(index).padStart(5, '0'), title_name: 'Game ' + index }));
  const page = await runtime.library.refresh(); assert.equal(page.games.length, 100); assert.equal(page.total, 250);
  const next = runtime.library.page({ offset: 200 }); assert.equal(next.games.length, 50);
  const found = runtime.library.page({ search: 'PPSA00149' }); assert.equal(found.games.length, 1); assert.equal(found.games[0].name, 'Game 149');
  assert.equal(runtime.snapshot().library.count, 250); assert.equal(runtime.snapshot().library.games, undefined);
});
