import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {installFileManager} from '../src/file-manager.mjs';
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tachen-browser-')),console=path.join(root,'console'),usb=path.join(root,'usb');
 await fs.mkdir(console);await fs.mkdir(usb);await fs.mkdir(path.join(console,'private'));await fs.writeFile(path.join(console,'test.bin'),Buffer.alloc(180000,37));
 let mounted=true;const handlers=new Map(),runtime={jobs:{register:(k,v)=>handlers.set(k,v)}};
 const io={...fs,statfs:async p=>({...await fs.statfs(p),mountPoint:mounted?usb:root})};
 installFileManager(runtime,{io,roots:[{label:'Console storage',path:console},{label:'USB 1',path:usb,usb:true}],protectedPaths:[path.join(console,'private')]});
 const input=async()=>({...((await runtime.fileManager.browse({source:console})).entries.find(x=>x.name==='test.bin')),destination:usb,move:false});
 const context={signal:new AbortController().signal,progress:async()=>{},checkpoint:async()=>{}};
 t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,console,usb,runtime,io,handlers,handler:handlers.get('file.transfer'),input,context,unplug:()=>mounted=false};
}
test('browser discovers mounted USB and copies/verifies arbitrary files without changing originals',async t=>{
 const f=await setup(t);assert.equal((await f.runtime.fileManager.browse()).entries.length,2);
 const listing=await f.runtime.fileManager.browse({source:f.console});assert(!listing.entries.some(x=>x.name==='private'));
 const input=await f.handler.validate(await f.input()),result=await f.handler.run(input,f.context);
 assert(await f.handler.verify(result));assert.deepEqual(await fs.readFile(input.source),await fs.readFile(result.output));
 await assert.rejects(f.handler.validate(await f.input()),{code:'FILE_EXISTS'});
 f.unplug();assert.equal((await f.runtime.fileManager.browse()).usbMissing,true);
 await assert.rejects(f.handler.validate(await f.input()),{code:'USB_DISCONNECTED'});
});
test('move removes source only after durable verified copy and retains its evidence',async t=>{
 const f=await setup(t),input=await f.handler.validate({...await f.input(),move:true});let checkpoint;
 const result=await f.handler.run(input,{...f.context,checkpoint:async value=>{checkpoint=value;assert.equal((await fs.stat(input.source)).size,input.bytes);}});
 await assert.rejects(fs.stat(input.source),{code:'ENOENT'});assert(await f.handler.verify(result));assert.equal(checkpoint.sha256,result.sha256);
 assert.equal((await f.handler.reconcile({args:input,checkpoint})).message,'Moved to '+input.output);
});
test('changed source, root escapes and symlinks cannot be moved',async t=>{
 const f=await setup(t),input=await f.input();await fs.appendFile(input.source,'changed');
 await assert.rejects(f.handler.validate(input),{code:'FILE_CHANGED'});
 await assert.rejects(f.runtime.fileManager.browse({source:f.root}),{code:'FILE_PROTECTED'});
 await fs.symlink(f.usb,path.join(f.console,'link'),'junction');
 await assert.rejects(f.runtime.fileManager.browse({source:path.join(f.console,'link')}),{code:'FILE_LINK'});
});
test('cancellation and destination corruption retain source and remove only the new partial copy',async t=>{
 const f=await setup(t),input=await f.handler.validate({...await f.input(),move:true}),abort=new AbortController();abort.abort();
 const result=await f.handler.run(input,{...f.context,signal:abort.signal});assert(result.cancelled);assert.equal((await fs.stat(input.source)).size,input.bytes);await assert.rejects(fs.stat(input.output),{code:'ENOENT'});
 await assert.rejects(f.handler.run(input,{...f.context,progress:async p=>{if(p.phase==='Verifying copied file')await fs.writeFile(input.output,'corrupt');}}),{code:'FILE_VERIFY'});
 assert.equal((await fs.stat(input.source)).size,input.bytes);
});

test('USB removal after verification keeps the original of a move',async t=>{
 const f=await setup(t),input=await f.handler.validate({...await f.input(),move:true});
 await assert.rejects(f.handler.run(input,{...f.context,checkpoint:async()=>f.unplug()}),{code:'USB_DISCONNECTED'});
 assert.equal((await fs.stat(input.source)).size,input.bytes);
 assert.deepEqual(await fs.readFile(input.source),await fs.readFile(input.output));
});

test('rename copies and verifies to an exclusive new name before removing the original',async t=>{
 const f=await setup(t),input=await f.handler.validate({...await f.input(),destination:f.console,destinationName:'renamed.bin',move:true});
 const result=await f.handler.run(input,f.context);assert(await f.handler.verify(result));await assert.rejects(fs.stat(input.source),{code:'ENOENT'});
 assert.equal(path.basename(result.output),'renamed.bin');
});
test('new folders and deletion recheck identity and refuse root deletion, nonempty folders and path escapes',async t=>{
 const f=await setup(t),mkdir=f.handlers.get('file.mkdir'),remove=f.handlers.get('file.delete');
 for(const name of ['../escape','/bad','.','..'])await assert.rejects(mkdir.validate({destination:f.usb,name}),{code:'FILE_NAME'});
 const folder=await mkdir.validate({destination:f.usb,name:'Backups'}),made=await mkdir.run(folder,f.context);assert(await mkdir.verify(made));await assert.rejects(mkdir.validate(folder),{code:'FILE_EXISTS'});
 const original=await f.input();await fs.appendFile(original.source,'changed');await assert.rejects(remove.validate(original),{code:'FILE_CHANGED'});
 let entry=(await f.runtime.fileManager.browse({source:f.usb})).entries[0];await fs.writeFile(path.join(entry.source,'keep'),'keep');await assert.rejects(remove.validate(entry));
 await fs.unlink(path.join(entry.source,'keep'));entry=(await f.runtime.fileManager.browse({source:f.usb})).entries[0];const valid=await remove.validate(entry),removed=await remove.run(valid,f.context);assert(await remove.verify(removed));
 await assert.rejects(remove.validate({...original,source:f.console}),{code:'FILE_CHANGED'});
});

async function folderInput(f){
 const source=path.join(f.console,'Backup');
 await fs.mkdir(path.join(source,'nested','empty'),{recursive:true});
 await fs.writeFile(path.join(source,'a.bin'),Buffer.alloc(150000,19));
 await fs.writeFile(path.join(source,'nested','unicode Ω.bin'),Buffer.alloc(70000,41));
 await fs.writeFile(path.join(source,'zero.bin'),'');
 const entry=(await f.runtime.fileManager.browse({source:f.console})).entries.find(e=>e.name==='Backup');
 return {...entry,destination:f.usb,move:false};
}

test('folder copies preserve nested files, zero-byte files and empty folders with a compact recoverable receipt',async t=>{
 const f=await setup(t),input=await f.handler.validate(await folderInput(f));let checkpoint;const progress=[];
 const result=await f.handler.run(input,{...f.context,checkpoint:async value=>checkpoint=value,progress:async value=>progress.push(value)});
 assert(await f.handler.verify(result));assert.equal(result.files,3);assert.equal(result.folders,3);assert.equal(result.bytes,220000);
 assert.deepEqual(await fs.readFile(path.join(result.output,'nested','unicode Ω.bin')),Buffer.alloc(70000,41));
 assert.equal((await fs.stat(path.join(result.output,'nested','empty'))).isDirectory(),true);
 assert.equal((await fs.stat(path.join(result.output,'zero.bin'))).size,0);
 assert(progress.some(p=>p.total===220000&&p.completed===220000));assert(progress.every(p=>p.completed<=p.total));
 assert(JSON.stringify(checkpoint).length<1024);assert((await f.handler.reconcile({args:input,checkpoint})).completed);
 // The source is retained; copying the same name again must never merge/overwrite.
 assert((await fs.stat(input.source)).isDirectory());await assert.rejects(f.handler.validate(input),{code:'FILE_EXISTS'});
 await fs.writeFile(path.join(result.output,'a.bin'),Buffer.alloc(150000,20));
 assert.equal(await f.handler.reconcile({args:input,checkpoint}),null);
});

test('empty folder copies and USB-to-console folder copies use the same verified path',async t=>{
 const f=await setup(t);await fs.mkdir(path.join(f.usb,'Empty'));
 const entry=(await f.runtime.fileManager.browse({source:f.usb})).entries[0];
 const input=await f.handler.validate({...entry,destination:f.console,move:false});let checkpoint;
 const result=await f.handler.run(input,{...f.context,checkpoint:async c=>checkpoint=c});
 assert.equal(result.bytes,0);assert.equal(result.files,0);assert.equal(result.folders,1);assert(await f.handler.verify(result));
 assert((await f.handler.reconcile({args:input,checkpoint})).completed);
});

test('folder copy rejects descendants, folder moves and insufficient total free space before creating anything',async t=>{
 const f=await setup(t),raw=await folderInput(f);
 await assert.rejects(f.handler.validate({...raw,destination:path.join(raw.source,'nested')}),{code:'FILE_RECURSIVE'});
 await assert.rejects(f.handler.validate({...raw,move:true}),{code:'FILE_FOLDER_MOVE'});
 const input=await f.handler.validate(raw),statfs=f.io.statfs;
 f.io.statfs=async p=>({...await statfs(p),bsize:1,bavail:16*1048576+200000});
 await assert.rejects(f.handler.run(input,f.context),{code:'NO_SPACE'});
 await assert.rejects(fs.stat(input.output),{code:'ENOENT'});
});

test('folder scan refuses nested symlinks and cancellation without changing source or destination',async t=>{
 const f=await setup(t),raw=await folderInput(f);await fs.symlink(f.usb,path.join(raw.source,'nested','link'),'junction');
 const input=await f.handler.validate(raw);
 await assert.rejects(f.handler.run(input,f.context),{code:'FILE_LINK'});await assert.rejects(fs.stat(input.output),{code:'ENOENT'});
 const abort=new AbortController();abort.abort();
 const result=await f.handler.run(input,{...f.context,signal:abort.signal});assert(result.cancelled);assert.match(result.message,/Original/);
 await assert.rejects(fs.stat(input.output),{code:'ENOENT'});
});

test('cancelled folder copy identifies the partial destination and never deletes originals',async t=>{
 const f=await setup(t),input=await f.handler.validate(await folderInput(f)),abort=new AbortController();
 const result=await f.handler.run(input,{...f.context,signal:abort.signal,progress:async p=>{if(p.phase.startsWith('Copying 2/'))abort.abort();}});
 assert(result.cancelled);assert.equal(result.output,input.output);assert.match(result.message,/Partial copy kept/);
 assert.deepEqual(await fs.readFile(path.join(input.output,'a.bin')),await fs.readFile(path.join(input.source,'a.bin')));
 assert.deepEqual(await fs.readFile(path.join(input.source,'nested','unicode Ω.bin')),Buffer.alloc(70000,41));
});

test('folder copying detects files added after the initial scan instead of declaring a complete backup',async t=>{
 const f=await setup(t),input=await f.handler.validate(await folderInput(f));let added=false;
 await assert.rejects(f.handler.run(input,{...f.context,progress:async p=>{
  if(!added&&p.phase.startsWith('Copying ')){added=true;await fs.writeFile(path.join(input.source,'late.bin'),'new');}
 }}),{code:'FILE_CHANGED'});
 assert.equal(await fs.readFile(path.join(input.source,'late.bin'),'utf8'),'new');
});

test('USB disconnection during folder copying fails with a partial-copy location and preserves originals',async t=>{
 const f=await setup(t),input=await f.handler.validate(await folderInput(f));
 await assert.rejects(f.handler.run(input,{...f.context,progress:async p=>{if(p.phase.startsWith('Copying '))f.unplug();}}),e=>e.code==='USB_DISCONNECTED'&&e.message.includes(input.output));
 assert.equal((await fs.stat(path.join(input.source,'a.bin'))).size,150000);
});
