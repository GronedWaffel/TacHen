import test from 'node:test';
import assert from 'node:assert/strict';
import { ServiceGraph } from '../src/services.mjs';
import { TacError } from '../src/errors.mjs';
import { deferred, until } from './helpers.mjs';

test('concurrent starts spawn once and respect dependency readiness', async () => {
  const graph = new ServiceGraph(), gate = deferred(), order = [];
  graph.register({ id: 'kernel', start: async () => { order.push('kernel'); await gate.promise; return { pid: 1 }; }, verify: e => e.pid === 1 });
  graph.register({ id: 'plugins', dependencies: ['kernel'], start: async () => { order.push('plugins'); return { pid: 2 }; }, verify: e => e.pid === 2 });
  const a = graph.start('plugins'), b = graph.start('plugins'); assert.equal(a, b);
  await until(() => order.length === 1); assert.deepEqual(order, ['kernel']); gate.resolve();
  await Promise.all([a, b]); assert.deepEqual(order, ['kernel', 'plugins']);
});
test('failed native verification cannot publish ready', async () => {
  const graph = new ServiceGraph();
  graph.register({ id: 'loader', start: async () => ({ sent: true }), verify: () => false });
  await assert.rejects(graph.start('loader'), { code: 'SERVICE_UNVERIFIED' }); assert.equal(graph.ready('loader'), false);
});
test('timeout holds exclusion and late readiness is not accepted', async () => {
  const gate = deferred(), graph = new ServiceGraph({ timeout: 15 }); let count = 0;
  graph.register({ id: 'kstuff', conflicts: ['other-kstuff'], start: async () => { count++; await gate.promise; return { ready: true }; }, verify: e => e.ready,
    inspect: async () => ({ ready: true }) });
  graph.register({ id: 'other-kstuff', start: async () => ({}), verify: () => true });
  await assert.rejects(graph.start('kstuff'), { code: 'SERVICE_TIMEOUT' });
  await assert.rejects(graph.start('kstuff'), { code: 'SERVICE_TIMEOUT' }); assert.equal(count, 1);
  assert.throws(() => graph.start('other-kstuff'), { code: 'SERVICE_CONFLICT' });
  await assert.rejects(graph.reconcile('kstuff'), { code: 'SERVICE_BUSY' });
  gate.resolve(); await until(() => !graph.pending.has('kstuff'));
  assert.equal(graph.ready('kstuff'), false); await graph.reconcile('kstuff'); assert.equal(graph.ready('kstuff'), true);
});
test('dependency loss invalidates consumers and their in-flight acknowledgements', async () => {
  const graph = new ServiceGraph(), gate = deferred();
  graph.register({ id: 'kernel', start: async () => ({}), verify: () => true });
  graph.register({ id: 'plugin', dependencies: ['kernel'], start: () => gate.promise, verify: () => true });
  const operation = graph.start('plugin'); await until(() => graph.ready('kernel'));
  graph.invalidate('kernel', new TacError('PROCESS_GONE', 'The process exited.'));
  await assert.rejects(operation, { code: 'DEPENDENCY_LOST' }); gate.resolve({});
  await until(() => !graph.pending.has('plugin')); assert.equal(graph.ready('plugin'), false);
});
test('cycles and safe-start optional work are blocked before native execution', () => {
  const graph = new ServiceGraph();
  graph.register({ id: 'a', dependencies: ['b'], start: () => assert.fail('must not run') });
  graph.register({ id: 'b', dependencies: ['a'], start: () => assert.fail('must not run') });
  assert.throws(() => graph.start('a'), { code: 'SERVICE_CYCLE' });
  const safe = new ServiceGraph(); safe.safe = true;
  safe.register({ id: 'plugin', optional: true, start: () => assert.fail('must not run') });
  assert.throws(() => safe.start('plugin'), { code: 'SAFE_START' });
});
