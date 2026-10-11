import test from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../src/jobs.mjs';
import { installPayloadLoader } from '../src/payload-loader.mjs';
import { ids, store, until, deferred } from './helpers.mjs';
const digest = 'a'.repeat(64), upload = 'b'.repeat(32);
test('bundled component bytes cannot bypass managed startup through the generic payload loader', async () => {
  const runtime = await setup({ loaderStart() { assert.fail('Should not dispatch'); } });
  runtime.componentHashes = new Set([digest]);
  await assert.rejects(runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'component-bypass'), { code: 'MANAGED_COMPONENT' });
});
async function setup(native, options) {
  const runtime = { jobs: new JobQueue(await store(), { id: ids() }),
    inbox: { verify: async id => ({ id, format: 'elf', sha256: digest }) }, capability() {} };
  installPayloadLoader(runtime, native, options); return runtime;
}
test('native dispatch completes with a durable identity but never claims initialization', async () => {
  let receipt, calls = 0;
  const runtime = await setup({ loaderStart(id, file, sha256) {
    calls++; assert.equal(file, upload); receipt = { request: id, sha256, stage: 3, pid: 42 };
  }, loaderPoll: () => receipt });
  const job = await runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'dispatch-one');
  await until(() => runtime.jobs.snapshot()[0].status === 'completed');
  const result = runtime.jobs.snapshot()[0].result;
  assert.equal(result.request, job.id); assert.equal(result.phase, 'dispatched'); assert.equal(result.initialized, false);
  await runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'dispatch-one'); assert.equal(calls, 1);
});

test('a short native busy response waits and dispatches an ELF once when the worker is free', async () => {
  let receipt,calls=0,delays=0;
  const runtime=await setup({loaderStart(request,file,sha256){
    if(++calls===1)throw Object.assign(Error('Native operation in progress'),{code:'LOADER_BUSY'});
    receipt={request,sha256,stage:3,pid:42};
  },loaderPoll:()=>receipt},{delay:async()=>{delays++;}});
  await runtime.jobs.enqueue('payload.dispatch',{id:upload},'busy-payload');
  await until(()=>runtime.jobs.snapshot()[0].status==='completed');
  assert.equal(calls,2);assert.equal(delays,1);assert.equal(runtime.jobs.snapshot()[0].error,null);
});

test('native start failure keeps its real code and an uncertain outcome is never silently retried', async () => {
  let calls=0;const runtime=await setup({loaderStart(){calls++;throw Object.assign(Error('Native payload preparation failed'),{code:'LOADER_NATIVE'});}});
  await runtime.jobs.enqueue('payload.dispatch',{id:upload},'native-failure');
  await until(()=>runtime.jobs.snapshot()[0].status==='interrupted');
  assert.equal(runtime.jobs.snapshot()[0].error.code,'LOADER_NATIVE');assert.equal(calls,1);
});
test('native preflight rejection is terminal without claiming a launch', async () => {
  let receipt;
  const runtime = await setup({ loaderStart(request, file, sha256) {
    receipt = { request, sha256, stage: 4, noSideEffects: true, message: 'Payload changed' };
  }, loaderPoll: () => receipt });
  await runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'rejected-one');
  await until(() => runtime.jobs.snapshot()[0].status === 'failed');
  assert.equal(runtime.jobs.snapshot()[0].error.code, 'PAYLOAD_REJECTED');
});
test('uncertain native launch retains resource exclusion until its receipt is reconciled', async () => {
  let receipt, calls = 0;
  const runtime = await setup({ loaderStart(request, file, sha256) {
    calls++; receipt = { request, sha256, stage: 5, message: 'Interrupted after spawning' };
  }, loaderPoll: () => receipt });
  const job = await runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'uncertain-one');
  await until(() => runtime.jobs.snapshot()[0].status === 'interrupted');
  await runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'uncertain-two');
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(calls, 1);
  await assert.rejects(runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' });
  runtime.jobs.stopDispatch(); receipt = { ...receipt, stage: 3, pid: 55 };
  await runtime.jobs.reconcile(job.id); assert.equal(runtime.jobs.snapshot()[0].status, 'completed');
});
test('a queue deadline does not release a still-running native worker', async () => {
  const gate = deferred(); let receipt, calls = 0;
  const runtime = await setup({ loaderStart(request, file, sha256) {
    calls++; receipt = { request, sha256, stage: 2 };
  }, loaderPoll: () => receipt }, { delay: () => gate.promise });
  runtime.jobs.handlers.get('payload.dispatch').timeout = 15;
  await runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'deadline-one');
  await until(() => runtime.jobs.snapshot()[0].status === 'uncertain');
  await runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'deadline-two');
  assert.equal(calls, 1); assert.equal(runtime.jobs.running.size, 1);
  receipt = { ...receipt, stage: 3, pid: 45 }; gate.resolve();
  await until(() => runtime.jobs.snapshot()[0].status === 'interrupted');
  assert.equal(calls, 1); runtime.jobs.stopDispatch();
});
test('changed inbox content and plugin containers never reach standalone native dispatch', async () => {
  let calls = 0; const runtime = await setup({ loaderStart() { calls++; }, loaderPoll() {} });
  await assert.rejects(runtime.jobs.enqueue('payload.dispatch', { id: upload, sha256: 'c'.repeat(64) }, 'changed-one'), { code: 'PAYLOAD_CHANGED' });
  runtime.inbox.verify = async () => ({ format: 'plugin', sha256: digest });
  await assert.rejects(runtime.jobs.enqueue('payload.dispatch', { id: upload }, 'plugin-one'), { code: 'PAYLOAD_KIND' });
  assert.equal(calls, 0);
});
