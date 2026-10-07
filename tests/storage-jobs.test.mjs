import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { installLibrary } from '../src/library.mjs';
import { installStorageJobs } from '../src/storage-jobs.mjs';
import { localRequest } from '../src/local-http.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store, ids, until } from './helpers.mjs';
async function fixture(t) {
  const evidence = { ready: true, boot: 'boot1', pid: 31, generation: 'one', version: '1.7beta4' };
  const game = { title_id: 'PPSA00001', title_name: 'Game', content_id: 'CONTENT1', platform: 'ps5',
    path: '/data/homebrew/game.ffpkg', source_type: 'image', installed: true, mounted: false,
    installed_pkg: false, source_available: true, can_manage_source: true, app_db_size_bytes: 180e9 };
  const volume = { path: '/mnt/usb0/homebrew', mount_point: '/mnt/usb0', source: '/dev/usb0',
    filesystem: 'exfat', available_bytes: 269e9, total_bytes: 1e12, read_only: false };
  const state = { current: null, starts: 0, cancels: 0, evidence, game, volume, autoFinish: true, dropAccept: false, wrongId: false };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); let response, code = 200;
    if (req.url.endsWith('/games')) response = { status: 0, count: 1, games: [game] };
    else if (req.url.endsWith('/storage') && !req.url.includes('/games/')) response = { status: 0, destinations: [volume] };
    else if (/\/games\/(copy|move|unpack)$/.test(req.url)) {
      state.starts++; const operation = req.url.split('/').pop(); code = 202;
      assert.equal(body.title_id, game.title_id); assert.equal(body.destination_dir, volume.path);
      if (operation === 'unpack') assert.equal(body.delete_source, false);
      state.current = { status: 0, job_id: 5, operation, state: 'transferring', active: true,
        cancellable: true, title_id: game.title_id, source_type: game.source_type, source: game.path,
        destination: volume.path + '/' + (operation === 'unpack' ? game.title_id : 'game.ffpkg'),
        delete_source: false, processed_bytes: 0, total_bytes: 180e9, result_status: 0 };
      if (state.dropAccept) return req.socket.destroy();
      response = state.current;
    } else if (req.url.endsWith('/cancel')) {
      state.cancels++; assert.equal(body.job_id, 5);
      Object.assign(state.current, { state: 'cancelled', active: false }); response = state.current;
    } else if (req.url.endsWith('/status')) {
      assert.equal(body.job_id, 5);
      if (state.autoFinish) Object.assign(state.current, { state: 'completed', active: false, processed_bytes: 180e9 });
      response = { ...state.current, job_id: state.wrongId ? 6 : 5 };
    } else throw Error('Unexpected test route: ' + req.url);
    const data = JSON.stringify(response); res.writeHead(code, { 'Content-Length': Buffer.byteLength(data) }); res.end(data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const runtime = new TacRuntime(await store(), { identity: async () => ({ mode: 'development' }), async install(runtime) {
    runtime.nativeServices = { inspect: async () => structuredClone(evidence) };
    installLibrary(runtime, { request: (_port, route, options) => localRequest(server.address().port, route, options) });
    installStorageJobs(runtime, { pollMs: 3 });
  } }, { id: ids() });
  await runtime.start();
  const input = { operation: 'copy', titleId: game.title_id, path: game.path, contentId: game.content_id, destination: volume.path };
  return { runtime, state, input };
}
test('large storage copy accepts 202 and confirms native completion without invented space multipliers', async t => {
  const { runtime, state, input } = await fixture(t);
  await runtime.jobs.enqueue('library.storage', input, 'copy-once');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed');
  assert.equal(runtime.jobs.snapshot()[0].checkpoint.jobId, 5);
  assert.equal(runtime.snapshot().jobs[0].checkpoint, undefined);
  await runtime.jobs.enqueue('library.storage', input, 'copy-once'); assert.equal(state.starts, 1);
});
test('image extraction keeps original image and requires an exact source identity', async t => {
  const { runtime, state, input } = await fixture(t); input.operation = 'unpack';
  await assert.rejects(runtime.jobs.enqueue('library.storage', { ...input, path: '/data/other' }, 'changed-path'), { code: 'LIBRARY_CHANGED' });
  await runtime.jobs.enqueue('library.storage', input, 'extract-one');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed');
  assert.equal(state.current.destination, '/mnt/usb0/homebrew/PPSA00001'); assert.equal(state.current.delete_source, false);
});
test('queued move rejects a replaced destination volume before starting work', async t => {
  const { runtime, state, input } = await fixture(t); runtime.jobs.concurrency = 0; input.operation = 'move';
  await runtime.jobs.enqueue('library.storage', input, 'move-once'); state.volume.source = '/dev/other';
  runtime.jobs.concurrency = 2; runtime.jobs.kick();
  await until(() => runtime.jobs.snapshot()[0].status === 'failed'); assert.equal(state.starts, 0);
  assert.equal(runtime.jobs.snapshot()[0].error.code, 'STORAGE_CHANGED');
});
test('cancellation waits for upstream confirmation and does not duplicate start requests', async t => {
  const { runtime, state, input } = await fixture(t); state.autoFinish = false;
  const job = await runtime.jobs.enqueue('library.storage', input, 'cancel-copy');
  await until(() => runtime.jobs.snapshot()[0].checkpoint?.jobId === 5);
  await runtime.jobs.cancel(job.id); await until(() => runtime.jobs.snapshot()[0].status === 'cancelled');
  assert.equal(state.starts, 1); assert.equal(state.cancels, 1);
});
test('lost acceptance keeps resource locked without guessing a remote operation identity', async t => {
  const { runtime, state, input } = await fixture(t); state.dropAccept = true;
  const job = await runtime.jobs.enqueue('library.storage', input, 'lost-accept');
  await until(() => runtime.jobs.snapshot()[0].status === 'interrupted');
  await assert.rejects(runtime.jobs.reconcile(job.id), { code: 'STORAGE_RECEIPT_MISSING' });
  await runtime.jobs.enqueue('library.storage', input, 'second-request');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(state.starts, 1); assert.equal(runtime.jobs.snapshot()[1].status, 'queued');
});
test('foreign remote receipt is rejected and known receipt can later be reconciled', async t => {
  const { runtime, state, input } = await fixture(t); state.wrongId = true;
  const job = await runtime.jobs.enqueue('library.storage', input, 'wrong-receipt');
  await until(() => runtime.jobs.snapshot()[0].status === 'interrupted');
  assert.equal(runtime.jobs.snapshot()[0].error.code, 'STORAGE_RECEIPT');
  state.wrongId = false; await runtime.jobs.reconcile(job.id);
  assert.equal(runtime.jobs.snapshot()[0].status, 'completed'); assert.equal(state.starts, 1);
});
test('unsafe destinations and folders disguised as images cannot enter the storage queue', async t => {
  const { runtime, state, input } = await fixture(t);
  for (const destination of ['/mnt/usb0/../system_data', '/mnt//usb0', '/mnt/usb0\\bad', '/system_data'])
    await assert.rejects(runtime.jobs.enqueue('library.storage', { ...input, destination }, 'bad-destination'));
  state.game.source_type = 'folder';
  await assert.rejects(runtime.jobs.enqueue('library.storage', { ...input, operation: 'unpack' }, 'bad-format'), { code: 'STORAGE_FORMAT' });
  assert.equal(state.starts, 0);
});
