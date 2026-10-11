import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TacRuntime } from '../src/runtime.mjs';
import { ConsoleDeck } from '../src/deck.mjs';
import { installLocalFiles } from '../src/local-files.mjs';
import { installPackageInbox } from '../src/package-inbox.mjs';
import { installPackageInstaller } from '../src/package-install.mjs';
import { installPackageReceiving } from '../src/package-receive.mjs';
import { store, ids, until } from './helpers.mjs';
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tachen-local-')),source=path.join(root,'usb');await fs.mkdir(source);
 const bytes=Buffer.alloc(8192);bytes.writeUInt32BE(0x7f434e54);bytes.write('UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP',0x40);bytes.writeUInt32BE(0x1a,0x74);bytes.writeBigUInt64BE(BigInt(bytes.length),0x430);
 await fs.writeFile(path.join(source,'game.pkg'),bytes);await fs.writeFile(path.join(source,'ignored.txt'),'keep');
 let starts=0,receipt;
 const native={systemProbe:()=>({kstuff:{state:'installed',injectionReady:true}}),
  packageStart(request,upload,sha256,contentId,type,platform,patch,bytes,name,mode){assert.equal(mode,1);starts++;receipt={request,upload,sha256,contentId,bytes,verification:'header'};},
  packagePoll:()=>({...receipt,stage:6,error:0,ageMs:0,accepted:true,observed:true,sameBoot:true})};
 const runtime=await new TacRuntime(await store(),{identity:async()=>({mode:'development',firmware:'13.60'}),
  async install(r){await installPackageInbox(r,path.join(root,'inbox'));installPackageInstaller(r,native);installLocalFiles(r,{roots:[{label:'USB drive',path:source,requireMounted:true}],volumeStat:async()=>({mountPoint:source})});installPackageReceiving(r,{delay:()=>new Promise(resolve=>setTimeout(resolve,1))});}}, {id:ids()}).start();
 const deck=new ConsoleDeck(runtime);t.after(async()=>{await runtime.close();await fs.rm(root,{recursive:true,force:true});});
 const choose=label=>{const f=deck.frame(),row=f.rows.findIndex(r=>r.label===label);assert(row>=0,'Missing '+label);return deck.action({kind:'select',row,sequence:f.sequence,request:runtime.id()});};
 return {root,source,bytes,runtime,deck,choose,starts:()=>starts};
}
test('controller can choose a USB package, verify without copying and install once without another device',async t=>{
 const f=await setup(t);assert.equal(f.deck.frame().grid,true);assert.equal(f.deck.frame().rows.length,8);assert(f.deck.frame().rows.every(r=>r.enabled));
 await f.choose('Packages');await f.choose('Install from storage');
 assert.equal(f.deck.fileView.source,f.source,'Single USB opens directly');
 assert(!f.deck.frame().rows.some(r=>r.label==='ignored.txt'));
 const frame=f.deck.frame(),input={kind:'select',row:frame.rows.findIndex(r=>r.label==='game.pkg'),sequence:frame.sequence,request:f.runtime.id()};
 await Promise.all([f.deck.action(input),f.deck.action(input)]);
 assert.equal(f.deck.confirmation,null);assert.equal(f.deck.fileView,null);assert(f.deck.packageView.workflow);
 await until(()=>f.runtime.jobs.snapshot().some(j=>j.kind==='package.receive'&&j.status==='completed'));
 assert.equal(f.starts(),1);assert(f.deck.frame().rows.some(r=>r.label==='Installed'));
 assert.deepEqual(await fs.readFile(path.join(f.source,'game.pkg')),f.bytes);
 const files=await fs.readdir(path.join(f.root,'inbox'));
 assert(files.some(n=>n.endsWith('.source')));assert(!files.some(n=>/\.(part|payload)$/.test(n)));
 assert.equal(f.runtime.packageItems[0].external,true);
 assert.deepEqual(f.runtime.jobs.snapshot().map(j=>j.kind),['package.receive','file.import','package.install']);

});
test('browser rejects changed files, traversal, links and disconnected media without starting an install',async t=>{
 const f=await setup(t),list=await f.runtime.execute('files.browse',{kind:'package',source:f.source}),file=list.entries.find(e=>!e.directory);
 await assert.rejects(f.runtime.execute('files.browse',{kind:'package',source:path.join(f.source,'..')}),{code:'FILE_PATH'});
 const outside=path.join(f.root,'outside');await fs.mkdir(outside);await fs.symlink(outside,path.join(f.source,'link'),'junction');
 await assert.rejects(f.runtime.execute('files.browse',{kind:'package',source:path.join(f.source,'link')}),{code:'FILE_LINK'});
 await fs.appendFile(file.source,'changed');
 await assert.rejects(f.runtime.execute('job.enqueue',{kind:'file.import',input:{...file,kind:'package'},key:'changed-file'}),{code:'FILE_CHANGED'});
 await fs.unlink(file.source);await assert.rejects(f.runtime.execute('job.enqueue',{kind:'file.import',input:{...file,kind:'package'},key:'missing-file'}),{code:'ENOENT'});
 assert.equal(f.starts(),0);
});

test('an empty USB mount directory is hidden and an ejected drive cannot supply a selected file',async t=>{
 const f=await setup(t),handlers=new Map(),runtime={jobs:{register:(name,handler)=>handlers.set(name,handler)}};
 let mounted=false;
 installLocalFiles(runtime,{roots:[{label:'USB 1',path:f.source,requireMounted:true}],volumeStat:async()=>({mountPoint:mounted?f.source:f.root})});
 const none=await runtime.localFiles.browse({kind:'package'});assert.equal(none.entries.length,0);assert.equal(none.usbMissing,true);
 mounted=true;assert.equal((await runtime.localFiles.browse({kind:'package'})).entries.length,1);
 const chosen=(await runtime.localFiles.browse({kind:'package',source:f.source})).entries.find(x=>!x.directory);
 mounted=false;await assert.rejects(handlers.get('file.import').validate({...chosen,kind:'package'}),{code:'USB_DISCONNECTED'});
});
