import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PayloadInbox} from '../src/inbox.mjs';
import {installDownloadLibrary} from '../src/download-library.mjs';
import {store,ids} from './helpers.mjs';
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tachen-delete-'));
 const inbox=await new PayloadInbox(root,{id:ids()}).init(),state=await store();
 const runtime={inbox,store:state,sequence:0,componentHashes:new Set()};installDownloadLibrary(runtime);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=await inbox.begin({name:'test.elf',bytes:128});
 return {runtime,inbox,file,remove:()=>runtime.downloadLibrary.remove({kind:'payload',id:file.id})};
}
test('download removal deletes only its owned files, preserves other downloads and refreshes catalog',async t=>{
 const f=await setup(t),other=await f.inbox.begin({name:'keep.elf',bytes:128});
 await f.remove();await assert.rejects(f.inbox.status(f.file.id),{code:'ENOENT'});
 assert.equal((await f.inbox.status(other.id)).name,'keep.elf');assert.equal(f.runtime.inboxItems.length,1);
 await assert.rejects(f.runtime.downloadLibrary.remove({kind:'payload',id:'../escape'}),{code:'UPLOAD_ID'});
});
test('running, interrupted and configured startup references prevent removal; cancelled work permits it',async t=>{
 const f=await setup(t);
 for(const status of ['queued','running','held','interrupted']){
  await f.runtime.store.transaction(s=>{s.jobs=[{id:'job',args:{id:f.file.id},status}];});
  await assert.rejects(f.remove(),{code:'DOWNLOAD_BUSY'});assert.equal((await f.inbox.status(f.file.id)).offset,0);
 }
 await f.runtime.store.transaction(s=>{s.jobs=[];s.startupPayloads=[{id:f.file.id,sha256:'b'.repeat(64),name:'test.elf',enabled:false,delayMs:2000}];});
 await assert.rejects(f.remove(),{code:'DOWNLOAD_STARTUP'});
 await f.runtime.store.transaction(s=>{s.startupPayloads=[];s.jobs=[{id:'job',args:{id:f.file.id},status:'cancelled'}];});await f.remove();
});
test('registered plugin files are preserved',async t=>{
 const f=await setup(t);await f.runtime.store.transaction(s=>{s.plugins=[{upload:f.file.id,sha256:'b'.repeat(64),name:'test.plugin',format:'plugin',pluginId:'TACP00001',pluginVersion:'1.00',scope:'system',target:null,autostart:false}];});
 await assert.rejects(f.remove(),{code:'DOWNLOAD_PLUGIN'});
});

test('bundled service files cannot be deleted through Downloads',async t=>{
 const f=await setup(t),metaPath=f.inbox.file(f.file.id,'.json'),meta=JSON.parse(await fs.readFile(metaPath,'utf8'));
 meta.expectedSha256='c'.repeat(64);await fs.writeFile(metaPath,JSON.stringify(meta));f.runtime.componentHashes.add(meta.expectedSha256);
 await assert.rejects(f.remove(),{code:'DOWNLOAD_COMPONENT'});
 assert.equal((await f.inbox.status(f.file.id)).name,'test.elf');
});
