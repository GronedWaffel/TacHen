import test from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../src/jobs.mjs';
import { deferred, store, ids, until } from './helpers.mjs';

const handler = run => ({ validate: value => value, resources: value => [value.resource || 'installer'], run, verify: result => result.receipt === 42 });
test('repeated phone submission is idempotent and mismatched reuse is rejected', async () => {
  const state = await store(), queue = new JobQueue(state, { id: ids() }); let executions = 0;
  queue.register('install', handler(async () => { executions++; return { completed: true, receipt: 42 }; }));
  const [a, b] = await Promise.all([queue.enqueue('install', {}, 'same-request'), queue.enqueue('install', {}, 'same-request')]);
  assert.equal(a.id, b.id); await until(() => queue.snapshot()[0].status === 'completed'); assert.equal(executions, 1);
  await assert.rejects(queue.enqueue('install', { different: true }, 'same-request'), { code: 'JOB_KEY_REUSED' });
});
test('resource locks serialize conflicting operations but allow independent jobs', async () => {
  const state = await store(), queue = new JobQueue(state, { id: ids(), concurrency: 2 });
  const gates = [deferred(), deferred(), deferred()], started = [];
  queue.register('install', handler(async ({ number }) => { started.push(number); await gates[number].promise; return { completed: true, receipt: 42 }; }));
  await queue.enqueue('install', { number: 0, resource: 'disk-a' }, 'request-0');
  await queue.enqueue('install', { number: 1, resource: 'disk-a' }, 'request-1');
  await queue.enqueue('install', { number: 2, resource: 'disk-b' }, 'request-2');
  await until(() => started.length === 2); assert.deepEqual(started, [0, 2]);
  gates[0].resolve(); await until(() => started.length === 3); assert.deepEqual(started, [0, 2, 1]);
  gates[1].resolve(); gates[2].resolve(); await until(() => queue.running.size === 0);
});
test('timeout never unlocks a still-running or unreconciled native operation', async () => {
  const state = await store(), queue = new JobQueue(state, { id: ids(), timeout: 20 });
  const gate = deferred(); let calls = 0;
  queue.register('install', { ...handler(async () => { calls++; await gate.promise; return { completed: true, receipt: 42 }; }),
    reconcile: async () => ({ completed: true, receipt: 42 }) });
  const a = await queue.enqueue('install', {}, 'request-1'); await queue.enqueue('install', {}, 'request-2');
  await until(() => queue.snapshot()[0].status === 'uncertain'); assert.equal(calls, 1);
  await assert.rejects(queue.reconcile(a.id), { code: 'JOB_BUSY' }); gate.resolve();
  await until(() => queue.snapshot()[0].status === 'interrupted' && queue.running.size === 0); assert.equal(calls, 1);
  await queue.reconcile(a.id); await until(() => queue.snapshot()[1].status === 'completed'); assert.equal(calls, 2);
});
test('acceptance alone is interrupted, not falsely completed', async () => {
  const queue = new JobQueue(await store(), { id: ids() });
  queue.register('install', handler(async () => ({ accepted: true })));
  await queue.enqueue('install', {}, 'request-1'); await until(() => queue.running.size === 0 && queue.snapshot()[0].status !== 'queued');
  assert.equal(queue.snapshot()[0].status, 'interrupted'); assert.equal(queue.snapshot()[0].error.code, 'JOB_UNVERIFIED');
});
test('failed intent commit prevents all side effects', async () => {
  const state = await store(), queue = new JobQueue(state, { id: ids() }); let executions = 0;
  queue.register('install', handler(async () => { executions++; }));
  queue.stopped = true;
  // Permit enqueue but hold dispatch until the first snapshot is durable.
  queue.stopped = false; queue.pumping = true;
  await queue.enqueue('install', {}, 'request-1'); state.storage.fail = true; queue.pumping = false;
  queue.kick(); await until(() => queue.halted); assert.equal(executions, 0);
});
test('restart holds queued work and never automatically replays an interrupted install', async () => {
  const state = await store();
  await state.transaction(s => { s.jobs = [
    { id: 'a', status: 'running', resources: ['install'] }, { id: 'b', status: 'queued', resources: ['install'] }
  ]; });
  const queue = new JobQueue(state, { id: ids() }); await queue.recover();
  assert.deepEqual(queue.snapshot().map(j => j.status), ['interrupted', 'held']);
});
test('cancellation request does not report cancelled until confirmed', async () => {
  const gate = deferred(), queue = new JobQueue(await store(), { id: ids() });
  queue.register('transfer', { ...handler(async () => gate.promise), cancellable: true });
  const job = await queue.enqueue('transfer', {}, 'request-1'); await until(() => queue.running.size === 1);
  await queue.cancel(job.id); assert.equal(queue.snapshot()[0].status, 'cancelling');
  gate.resolve({ cancelled: true }); await until(() => queue.running.size === 0);
  assert.equal(queue.snapshot()[0].status, 'cancelled');
});
