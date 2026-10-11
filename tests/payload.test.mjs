import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectPayload } from '../src/payload-format.mjs';
import { PayloadInbox } from '../src/inbox.mjs';
import { ids, checksum } from './helpers.mjs';
import { store } from './helpers.mjs';
import { Plugins } from '../src/plugins.mjs';
import { SessionHistory } from '../src/history.mjs';

function elf() {
  const b = Buffer.alloc(160); Buffer.from([0x7f, 69, 76, 70, 2, 1, 1]).copy(b);
  b.writeUInt16LE(3, 16); b.writeUInt16LE(62, 18); b.writeUInt32LE(1, 20);
  b.writeBigUInt64LE(0x80n, 24); b.writeBigUInt64LE(64n, 32);
  b.writeUInt16LE(64, 52); b.writeUInt16LE(56, 54); b.writeUInt16LE(1, 56);
  b.writeUInt32LE(1, 64); b.writeUInt32LE(5, 68);
  b.writeBigUInt64LE(160n, 96); b.writeBigUInt64LE(160n, 104); b.writeBigUInt64LE(1n, 112);
  return b;
}
async function inbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-inbox-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new PayloadInbox(root, { id: ids() }).init();
}
function selfModule() {
  const module=Buffer.alloc(512);elf().copy(module);module.writeUInt16LE(0xfe18,16);module.writeUInt16LE(2,56);
  module.writeUInt32LE(2,120);module.writeBigUInt64LE(256n,128);module.writeBigUInt64LE(32n,152);
  const self=Buffer.alloc(576);self.writeUInt32LE(0x1d3d154f);self.writeBigUInt64LE(576n,16);self.writeUInt16LE(1,24);
  self.writeBigUInt64LE(64n,40);self.writeBigUInt64LE(512n,48);module.copy(self,64);return self;
}
test('shared FSELF wrapper registers and persists against either selected platform without guessing PS4', async t => {
  for (const target of [{titleId:'PPSA03865',version:'01.010.000'}, {titleId:'CUSA00411',version:'01.50'}]) {
    const bytes=selfModule(); bytes[64+7]=9; bytes[64+8]=2;
    const box=await inbox(t), upload=await box.begin({name:'menu.prx',bytes:bytes.length});
    await box.append(upload.id,0,bytes);
    const info=await box.verify(upload.id);assert.equal(info.platform,null);
    const saved=await store(), logs=[], runtime={store:saved,inbox:box,sequence:0,graph:{safe:false},
      jobs:{register(){}},id:ids(),now:Date.now,session:'test'};
    runtime.changes=new SessionHistory(runtime);
    const plugins=new Plugins(runtime,{}, {log:message=>logs.push(message)});
    await plugins.register({upload:upload.id,scope:'game',target,revision:saved.snapshot().revision});
    const reopened=new Plugins(runtime,{}), item=reopened.list()[0];
    assert.equal(item.platform,target.titleId.startsWith('PPSA')?'ps5':'ps4');
    assert.equal(item.sha256,checksum(bytes));assert.deepEqual(item.target,target);
    assert(logs.some(line=>line.includes('saved format=prx')));
    await assert.rejects(plugins.register({upload:upload.id,scope:'game',target,revision:saved.snapshot().revision}),{code:'PLUGIN_CONFLICT'});
    assert(logs.some(line=>line.includes('failed phase=save code=PLUGIN_CONFLICT')));
  }
});
test('PS5-specific wrapper still identifies PS5 and rejects a PS4 registration target', async t => {
  const bytes=selfModule();bytes.writeUInt32LE(0xeef51454);
  assert.equal(inspectPayload(bytes,'menu.prx').platform,'ps5');
  const box=await inbox(t),upload=await box.begin({name:'menu.prx',bytes:bytes.length});await box.append(upload.id,0,bytes);
  const saved=await store(),logs=[],runtime={store:saved,inbox:box,jobs:{register(){}}};
  const plugins=new Plugins(runtime,{}, {log:message=>logs.push(message)});
  await assert.rejects(plugins.register({upload:upload.id,scope:'game',target:{titleId:'CUSA00411',version:'01.50'},revision:saved.snapshot().revision}),{code:'PLUGIN_TARGET'});
  assert.equal(saved.snapshot().plugins.length,0);assert(logs.some(line=>line.includes('failed phase=target code=PLUGIN_TARGET')));
});
test('SELF modules retain trailing bytes and accept unwritten final alignment only outside every segment',async t=>{
  const self=selfModule(),extended=Buffer.concat([self,Buffer.from('toolchain trailer')]);
  assert.equal(inspectPayload(extended,'menu.prx').platform,null);
  const box=await inbox(t),meta=await box.begin({name:'menu.prx',bytes:extended.length});
  await box.append(meta.id,0,extended);const info=await box.verify(meta.id);
  assert.equal(info.sha256,checksum(extended));assert.equal(info.bytes,extended.length);
  // OpenOrbis aligns the declared final size but writes each segment at its offset.
  const unpadded=self.subarray(0,569);unpadded.writeBigUInt64LE(505n,48);
  assert.equal(inspectPayload(unpadded,'menu.sprx').platform,null);
  unpadded.writeBigUInt64LE(506n,48);assert.throws(()=>inspectPayload(unpadded,'bad.prx'),{code:'SELF_BOUNDS'});
  unpadded.writeBigUInt64LE(505n,48);unpadded.writeBigUInt64LE(592n,16);
  assert.throws(()=>inspectPayload(unpadded,'bad.prx'),{code:'SELF_HEADER'});
});
test('SELF trailers cannot supply missing container segments or embedded program headers',()=>{
  const self=Buffer.concat([selfModule(),Buffer.alloc(256)]);
  self.writeBigUInt64LE(513n,48);assert.throws(()=>inspectPayload(self,'bad.prx'),{code:'SELF_BOUNDS'});
  self.writeBigUInt64LE(512n,48);self.writeBigUInt64LE(480n,64+32);
  assert.throws(()=>inspectPayload(self,'bad.prx'),{code:'ELF_LAYOUT'});
  self.writeBigUInt64LE(0n,16);assert.throws(()=>inspectPayload(self,'bad.prx'),{code:'SELF_HEADER'});
});
test('ELF, real 29-byte plugin container and native module are distinguished', () => {
  const binary = elf(); assert.equal(inspectPayload(binary, 'test.elf').format, 'elf');
  const plugin = Buffer.concat([Buffer.from('etaHEN_PLUGIN\0TACP00001\0' + '1.00\0'), binary]);
  const info = inspectPayload(plugin, 'test.plugin'); assert.equal(info.pluginId, 'TACP00001'); assert.equal(info.pluginVersion, '1.00');
  assert.throws(() => inspectPayload(binary, 'renamed.prx'), { code: 'ELF_TYPE' });
});
test('malformed segments, bogus entrypoints and truncated containers fail closed', () => {
  const bounds = elf(); bounds.writeBigUInt64LE(999999n, 96);
  assert.throws(() => inspectPayload(bounds, 'bad.elf'), { code: 'ELF_BOUNDS' });
  const entry = elf(); entry.writeBigUInt64LE(0x4000n, 24);
  assert.throws(() => inspectPayload(entry, 'bad.elf'), { code: 'ELF_ENTRY' });
  const align = elf(); align.writeBigUInt64LE(3n, 112);
  assert.throws(() => inspectPayload(align, 'bad.elf'), { code: 'ELF_ALIGNMENT' });
  assert.throws(() => inspectPayload(elf().subarray(0, 70), 'bad.elf'), { code: 'ELF_LAYOUT' });
});
test('prefix inspection supports payloads larger than resident memory limits', () => {
  const binary = elf(); binary.writeBigUInt64LE(100n * 1024n * 1024n, 96); binary.writeBigUInt64LE(100n * 1024n * 1024n, 104);
  assert.equal(inspectPayload(binary, 'large.elf', { totalBytes: 100 * 1024 * 1024 }).bytes, 100 * 1024 * 1024);
});
test('resumable uploads reject duplicate chunks and verify a durable real file', async t => {
  const box = await inbox(t), binary = elf(), meta = await box.begin({ name: 'test.elf', bytes: binary.length, sha256: checksum(binary) });
  await box.append(meta.id, 0, binary.subarray(0, 80));
  await assert.rejects(box.append(meta.id, 0, binary.subarray(0, 80)), { code: 'UPLOAD_OFFSET' });
  const reopened = await new PayloadInbox(box.root, { id: ids() }).init();
  assert.equal((await reopened.status(meta.id)).offset, 80);
  await reopened.append(meta.id, 80, binary.subarray(80)); const receipt = await reopened.verify(meta.id);
  assert.equal(receipt.sha256, checksum(binary)); assert.equal(receipt.status, 'verified');
  assert.equal((await reopened.list())[0].status, 'verified');
  assert.equal((await reopened.verify(meta.id)).sha256, receipt.sha256);
});
test('incomplete, hash-mismatched and malformed payloads never become verified', async t => {
  const box = await inbox(t), binary = elf();
  const incomplete = await box.begin({ name: 'short.elf', bytes: binary.length });
  await assert.rejects(box.verify(incomplete.id), { code: 'UPLOAD_INCOMPLETE' });
  const mismatch = await box.begin({ name: 'hash.elf', bytes: binary.length, sha256: '0'.repeat(64) });
  await box.append(mismatch.id, 0, binary); await assert.rejects(box.verify(mismatch.id), { code: 'PAYLOAD_HASH_MISMATCH' });
  assert.equal((await box.status(mismatch.id)).status, 'uploading');
  const malformed = await box.begin({ name: 'malformed.elf', bytes: 160 }); await box.append(malformed.id, 0, Buffer.alloc(160));
  await assert.rejects(box.verify(malformed.id), { code: 'ELF_HEADER' });
});
test('simultaneous chunks at the same offset cannot corrupt each other', async t => {
  const box = await inbox(t), binary = elf(), meta = await box.begin({ name: 'test.elf', bytes: 160 });
  const results = await Promise.allSettled([box.append(meta.id, 0, binary), box.append(meta.id, 0, binary)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await box.verify(meta.id)).sha256, checksum(binary));
});
test('native build output passes the independent payload inspector when present', async t => {
  let bytes; try { bytes = await fs.readFile('build/tachen-runtime.elf'); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Native artifact has not been built'); return; } throw error; }
  assert.equal(inspectPayload(bytes.subarray(0, 16384), 'tachen-runtime.elf', { totalBytes: bytes.length }).format, 'elf');
});
