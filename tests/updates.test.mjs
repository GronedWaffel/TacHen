import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {makeUpdatePackage,inspectUpdate,parseUpdateHeader} from '../src/update-format.mjs';
import {installUpdates} from '../src/updates.mjs';
import {TacRuntime} from '../src/runtime.mjs';
import {store,ids,until} from './helpers.mjs';
const root=path.resolve(import.meta.dirname,'..'),exe=path.join(root,'build/update-test.exe');
before(async()=>{
  await fs.mkdir(path.join(root,'build'),{recursive:true});
  const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const result=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/native','-Iplatform/loader','tests/update-runner.c','platform/native/update-core.c','platform/native/elf-image.c','platform/loader/sha256.c','-o',exe],
    {cwd:root,encoding:'utf8',env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')}});
  assert.equal(result.status,0,result.stderr||result.error?.message);
});
const make=async()=>makeUpdatePackage(await fs.readFile(path.join(root,'build/tachen-runtime.elf')),{source:'a'.repeat(64),label:'TacHen local fixture'});
async function native(t,bytes){const dir=await fs.mkdtemp(path.join(root,'build/update-case-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'case.tachen');await fs.writeFile(file,bytes);const result=spawnSync(exe,[file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;}
test('native and JavaScript update formats agree on the built runtime; native rollback and promotion transitions pass',async t=>{
  const bytes=await make(),header=inspectUpdate(bytes,{firmware:'13.60'});
  assert.equal(header.source,'a'.repeat(64));assert.equal(header.profiles.length,14);assert(!header.profiles.includes('11.40'));
  assert.match(await native(t,bytes),/transitions passed/);
  assert.throws(()=>inspectUpdate(bytes,{firmware:'11.40'}),{code:'UPDATE_FIRMWARE'});
});
test('both update parsers reject malformed headers, incompatible schemas and changed executable bytes',async t=>{
  const source=await make();
  for(const change of [b=>b[0]^=1,b=>b.writeUInt32LE(2,28),b=>b.writeUInt32LE(0x8000,24),b=>b.fill(65,96,160),b=>b[160]=1,b=>b.writeBigUInt64LE(1n<<40n,16),b=>b[b.length-1]^=1]){
    const bytes=Buffer.from(source);change(bytes);
    // Re-seal malformed fields: a checksum alone must not make them valid.
    createHash('sha256').update(bytes.subarray(0,224)).digest().copy(bytes,224);
    assert.throws(()=>inspectUpdate(bytes));assert.match(await native(t,bytes),/rejected/);
  }
  assert.throws(()=>parseUpdateHeader(source,{totalBytes:source.length+1}),{code:'UPDATE_SIZE'});
});

async function manager(t,{baseline=true}={}){
  const directory=await fs.mkdtemp(path.join(root,'build/update-manager-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let selection={revision:'0',phase:'idle',good:baseline?{sha256:'b'.repeat(64),source:'b'.repeat(64),label:'Previously verified fixture'}:null,previous:null,candidate:null,recovered:false,managed:false},stageCalls=0,acks=0;
  const native={updateStatus:()=>structuredClone(selection),updateStage(hash,revision){assert.equal(revision,selection.revision);stageCalls++;selection={...selection,revision:String(Number(revision)+1),phase:'staged',candidate:{sha256:hash,source:'a'.repeat(64),label:'fixture'}};return structuredClone(selection);},
    updateArm(revision){assert.equal(revision,selection.revision);selection={...selection,revision:String(Number(revision)+1),phase:'armed'};return structuredClone(selection);},updateAcknowledge(){acks++;return structuredClone(selection);}};
  const r=await new TacRuntime(await store(),{identity:async()=>({mode:'development',firmware:'13.60'}),install:runtime=>installUpdates(runtime,native,directory)},{id:ids()}).start();
  t.after(()=>r.close());return {r,directory,native,stageCalls:()=>stageCalls,acks:()=>acks};
}
async function upload(r,bytes){const entry=await r.execute('update.begin',{name:'fixture.tachen',bytes:bytes.length});for(let offset=0;offset<bytes.length;offset+=1024*1024)await r.updates.inbox.append(entry.id,offset,bytes.subarray(offset,offset+1024*1024));return entry.id;}
async function settled(r,id){await until(()=>!['queued','running'].includes(r.jobs.snapshot().find(j=>j.id===id)?.status));await until(()=>!r.jobs.running.size);return r.jobs.snapshot().find(j=>j.id===id);}
test('real file staging verifies immutable bytes, records a job and requires separate next-boot activation',async t=>{
  const f=await manager(t),bytes=await make(),id=await upload(f.r,bytes),header=inspectUpdate(bytes);
  // Broken native startup must still allow a repair package to be staged.
  f.r.graph.safe=true;
  const job=await f.r.jobs.enqueue('update.stage',{id,revision:'0'},'stage-one'),result=await settled(f.r,job.id);
  assert.equal(result.status,'completed',JSON.stringify(result.error));assert.equal(f.stageCalls(),1);assert.equal(f.acks(),0);
  assert.deepEqual(await fs.readFile(path.join(f.directory,header.sha256+'.tachen')),bytes);
  assert.equal(f.r.snapshot().updates.state.phase,'staged');
  await f.r.execute('update.arm',{revision:'1'});assert.equal(f.r.snapshot().updates.state.phase,'armed');
  assert.equal(f.acks(),0);assert.equal(f.stageCalls(),1);
});
test('corrupted executable bytes fail staging before native selection and never replace a retained build',async t=>{
  const f=await manager(t),bytes=await make(),header=parseUpdateHeader(bytes);bytes[bytes.length-1]^=1;
  const id=await upload(f.r,bytes),job=await f.r.jobs.enqueue('update.stage',{id,revision:'0'},'corrupt-one'),result=await settled(f.r,job.id);
  assert.equal(result.status,'failed');assert.equal(result.error.code,'UPDATE_CHECKSUM');assert.equal(f.stageCalls(),0);
  await assert.rejects(fs.stat(path.join(f.directory,header.sha256+'.tachen')),{code:'ENOENT'});
});
test('direct launch can stage an update but cannot activate it before a verified launcher baseline exists',async t=>{
  const f=await manager(t,{baseline:false}),bytes=await make(),id=await upload(f.r,bytes);
  const job=await f.r.jobs.enqueue('update.stage',{id,revision:'0'},'first-stage');assert.equal((await settled(f.r,job.id)).status,'completed');
  await assert.rejects(f.r.execute('update.arm',{revision:'1'}),{code:'UPDATE_BASELINE'});assert.equal(f.r.snapshot().updates.state.phase,'staged');assert.equal(f.acks(),0);
});
test('a retained file with a conflicting header is preserved and rejects staging',async t=>{
  const f=await manager(t),bytes=await make(),header=inspectUpdate(bytes),saved=Buffer.from(bytes);saved[80]^=1;createHash('sha256').update(saved.subarray(0,224)).digest().copy(saved,224);
  const file=path.join(f.directory,header.sha256+'.tachen');await fs.writeFile(file,saved);
  const id=await upload(f.r,bytes),job=await f.r.jobs.enqueue('update.stage',{id,revision:'0'},'retained-one'),result=await settled(f.r,job.id);
  assert.equal(result.status,'failed');assert.equal(result.error.code,'UPDATE_CHANGED');assert.equal(f.stageCalls(),0);assert.deepEqual(await fs.readFile(file),saved);
});
