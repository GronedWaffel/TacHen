import test from 'node:test';
import assert from 'node:assert/strict';
import { TacRuntime } from '../src/runtime.mjs';
import { installPackageInstaller } from '../src/package-install.mjs';
import { FIRMWARES } from '../src/firmware.mjs';
import { ids, store, until } from './helpers.mjs';
const upload = 'a'.repeat(32), hash = 'b'.repeat(64), contentId = 'UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP';
async function fixture({ firmware = '13.60', mutate = () => {}, stages = [2, 4, 5, 6] } = {}) {
  const backing = await store(), id = ids(); let starts = 0, polls = 0, currentRequest;
  await backing.transaction(s => s.jobs.push({ id: 'verify', kind: 'package.verify', args: { id: upload }, status: 'completed',
    resources: ['package-file:' + upload], result: { sha256: hash }, createdAt: 0, updatedAt: 0 }));
  const native = {
    systemProbe: () => ({ kstuff: { state: 'installed', injectionReady: true } }),
    packageStart(request, givenUpload, givenHash, givenContent, type, platform, patch, bytes) {
      assert.equal(givenUpload, upload); assert.equal(givenHash, hash); assert.equal(givenContent, contentId);
      assert.equal(type, 0x1a); assert.equal(platform, 4); assert.equal(patch, 0); assert.equal(bytes, 8192); starts++; currentRequest = request;
    },
    packagePoll(request) {
      const stage = stages[Math.min(polls++, stages.length - 1)];
      const value = { request, upload, sha256: hash, contentId, bytes: 8192, stage, pid: 81, error: 0,
        ageMs: 0, sameBoot: true, noSideEffects: stage === 7, accepted: stage >= 5, observed: stage === 6,
        completedBytes: stage === 6 ? 8192 : 4096, totalBytes: 8192, message: 'Installer status' };
      mutate(value); return value;
    }
  };
  const runtime = await new TacRuntime(backing, { identity: async () => ({ mode: 'development', firmware }), install(r) {
    r.packageInbox = { async describe(given) { assert.equal(given, upload); return { id: upload, status: 'verified', bytes: 8192,
      package: { contentId, titleId: 'CUSA00001', type: 0x1a, patch: false, platform: 'ps4' } }; } };
    installPackageInstaller(r, native, { delay: () => new Promise(resolve => setTimeout(resolve, 1)) });
  } }, { id }).start();
  const enqueue = () => runtime.jobs.enqueue('package.install', { id: upload }, 'package-test-one');
  return { runtime, native, enqueue, starts: () => starts, polls: () => polls, request: () => currentRequest };
}
async function settled(f) { await until(() => ['completed', 'failed', 'interrupted'].includes(f.runtime.jobs.snapshot().at(-1).status)); return f.runtime.jobs.snapshot().at(-1); }
test('package install job submits once and only completes after native completion evidence', async () => {
  const f = await fixture(); await f.enqueue(); const job = await settled(f);
  assert.equal(job.status, 'completed'); assert.equal(f.starts(), 1); assert.ok(f.polls() >= 5);
  assert.equal(job.checkpoint.contentId, contentId); assert.equal(job.result.evidence.observed, true);
  await f.enqueue(); assert.equal(f.starts(), 1);
});
test('a stale installer receipt retains the job as interrupted and is never resubmitted', async () => {
  const f = await fixture({ stages: [5], mutate: r => { r.ageMs = 61000; } }); await f.enqueue(); const job = await settled(f);
  assert.equal(job.status, 'interrupted'); assert.equal(job.error.code, 'PACKAGE_UNCERTAIN'); assert.equal(f.starts(), 1);
  await assert.rejects(f.runtime.jobs.reconcile(job.id), { code: 'OUTCOME_UNKNOWN' }); assert.equal(f.starts(), 1);
});

test('only a prior boot clean preflight can reconcile as never submitted',async()=>{
 for(const [stage,sameBoot,clean,accepted,absent] of [[3,false,true,false,true],[3,true,true,false,false],[3,false,false,false,false],[4,false,false,false,false],[5,false,false,true,false]]){
  const f=await fixture({stages:[stage],mutate:r=>{r.ageMs=61000;r.sameBoot=sameBoot;r.noSideEffects=clean;r.accepted=accepted;}});
  await f.enqueue();const job=await settled(f);assert.equal(job.status,'interrupted');
  if(absent){await f.runtime.jobs.reconcile(job.id);assert.equal(f.runtime.jobs.snapshot().at(-1).status,'failed');}
  else if(!sameBoot){await f.runtime.jobs.reconcile(job.id);const ended=f.runtime.jobs.snapshot().at(-1);assert.equal(ended.status,'failed');assert.equal(ended.error.code,'PREVIOUS_BOOT_ENDED');assert.equal(ended.result.priorOutcome,'unknown');}
  else await assert.rejects(f.runtime.jobs.reconcile(job.id),{code:'OUTCOME_UNKNOWN'});
  assert.equal(f.starts(),1);await f.runtime.close();
 }
});
test('an installer receipt for other bytes cannot complete an accepted job', async () => {
  const f = await fixture({ stages: [6], mutate: r => { r.sha256 = 'c'.repeat(64); } }); await f.enqueue(); const job = await settled(f);
  assert.equal(job.status, 'interrupted'); assert.equal(job.error.code, 'PACKAGE_RECEIPT');
});
test('a pre-submission native rejection is a clean failed job', async () => {
  const f = await fixture({ stages: [7] }); await f.enqueue(); const job = await settled(f);
  assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'PACKAGE_REJECTED');
});
test('package installation admits every exact target profile and rejects excluded firmware', async () => {
  for (const firmware of FIRMWARES) {
    const f = await fixture({ firmware }); assert.equal(f.runtime.capabilities.get('packages').available, true, firmware);
    await f.enqueue();assert.equal((await settled(f)).status, 'completed', firmware);assert.equal(f.starts(), 1);
  }
  for (const firmware of ['1.03', '10.61', '12.41', '13.61', '14.00']) {
    const f = await fixture({ firmware }); assert.equal(f.runtime.capabilities.get('packages').available, false);
    await assert.rejects(f.enqueue(), { code: 'PACKAGE_FIRMWARE' }); assert.equal(f.starts(), 0);
  }
});
test('interrupted installer can reconcile its own later completion without another launch', async () => {
  let stale = true; const f = await fixture({ stages: [6], mutate: r => { if (stale) { r.stage = 5; r.ageMs = 61000; r.observed = false; } } });
  await f.enqueue(); const job = await settled(f); assert.equal(job.status, 'interrupted'); stale = false;
  await f.runtime.jobs.reconcile(job.id); assert.equal(f.runtime.jobs.snapshot().at(-1).status, 'completed'); assert.equal(f.starts(), 1);
});
test('kstuff readiness is checked before helper dispatch', async () => {
  const f = await fixture(); f.native.systemProbe = () => ({ kstuff: { state: 'unknown' } });
  await f.enqueue(); const job = await settled(f); assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'PACKAGE_DEPENDENCY'); assert.equal(f.starts(), 0);
});

test('package recovery releases a previous boot without retrying or claiming success',async()=>{
 let ended=false;const f=await fixture({stages:[8],mutate:r=>{r.sameBoot=!ended;r.ageMs=61000;}});
 await f.enqueue();const first=await settled(f);assert.equal(first.status,'interrupted');
 await f.runtime.packageRecovery();assert.equal((await f.runtime.jobs.get(first.id)).status,'interrupted');
 ended=true;await f.runtime.packageRecovery();const recovered=await f.runtime.jobs.get(first.id);
 assert.equal(recovered.status,'failed');assert.equal(recovered.result.priorOutcome,'unknown');assert.equal(f.starts(),1);
 await f.runtime.close();
});
test('unknown boot identity does not release a live installer reservation',async()=>{
 const f=await fixture({stages:[8],mutate:r=>{r.sameBoot=null;}});await f.enqueue();const job=await settled(f);
 await f.runtime.packageRecovery();assert.equal((await f.runtime.jobs.get(job.id)).status,'interrupted');assert.equal(f.starts(),1);await f.runtime.close();
});
