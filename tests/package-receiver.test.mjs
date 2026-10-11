import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {TacRuntime} from '../src/runtime.mjs';import {installPackageInbox} from '../src/package-inbox.mjs';
import {installPackageInstaller} from '../src/package-install.mjs';import {installPackageReceiving} from '../src/package-receive.mjs';import {installPackageReceiver} from '../src/package-receiver.mjs';
import {store,ids,until} from './helpers.mjs';
import net from 'node:net';
import {createHttpServer} from '../platform/runtime/http-server.mjs';
function pkg(){const b=Buffer.alloc(8192);b.writeUInt32BE(0x7f434e54);b.write('UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP',0x40);b.writeUInt32BE(0x1a,0x74);b.writeBigUInt64BE(BigInt(b.length),0x430);return b;}
async function fixture(t,{uncertain=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tachen-dpi-')),calls=[],requests=new Map();let downloads=0;
 const native={systemProbe:()=>({kstuff:{state:'installed',injectionReady:true}}),
  packageStart(request,upload,sha256,contentId,_type,_platform,_patch,bytes){calls.push(request);requests.set(request,{request,upload,sha256,contentId,bytes,stage:uncertain?8:6,sameBoot:true,ageMs:0,accepted:true,observed:true,error:0,completedBytes:bytes,totalBytes:bytes,message:uncertain?'Installer connection lost':'Installation complete'});},
  packagePoll:request=>requests.get(request)};
 const runtime=await new TacRuntime(await store(),{identity:async()=>({mode:'development',ip:'127.0.0.1',firmware:'13.60'}),async install(r){
  await installPackageInbox(r,root);installPackageInstaller(r,native,{delay:()=>Promise.resolve()});
  r.downloads={async fetchToFile(url,limit,context,options){downloads++;assert.equal(url,'https://example.test/game.pkg');assert.equal(limit,1024**4);assert.equal(options.timeoutSeconds,172800);const source=path.join(root,context.id+'.download');await fs.writeFile(source,pkg());return {source,bytes:8192,release(){}};}};
  installPackageReceiving(r,{delay:()=>new Promise(resolve=>setTimeout(resolve,2))});installPackageReceiver(r,{host:'127.0.0.1',port:0,createServer:(options,handler)=>createHttpServer(net.createServer,options,handler)});
 }},{id:ids()}).start();
 t.after(async()=>{await runtime.close();assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const receiver=runtime.packageReceiver;await receiver.setEnabled(true);
 return {runtime,receiver,root,calls,requests,url:receiver.snapshot().address,downloads:()=>downloads};
}
test('DPI file upload verifies and installs in the background with independently recorded child jobs',async t=>{
 const f=await fixture(t),form=new FormData();form.set('file',new Blob([pkg()]),'test.pkg');
 const response=await fetch(f.url,{method:'POST',body:form});assert.equal(response.status,202);assert.match(await response.text(),/^SUCCESS:/);
 const id=response.headers.get('x-tachen-job');await until(()=>f.runtime.jobs.snapshot().find(j=>j.id===id)?.status==='completed');
 assert.equal(f.calls.length,1);assert.deepEqual(f.runtime.jobs.snapshot().map(j=>j.kind),['package.receive','package.verify','package.install']);
 const status=await(await fetch(f.url+'/status')).json();assert.equal(status.jobs[0].status,'completed');assert.equal(status.active,null);
 assert.equal((await f.runtime.packageInbox.list())[0].status,'verified');assert.equal((await fs.readdir(f.root)).filter(x=>x.endsWith('.payload')).length,1);
});
test('DPI URL request adopts one downloaded file and installs without a second file copy',async t=>{
 const f=await fixture(t),response=await fetch(f.url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'url=https%3A%2F%2Fexample.test%2Fgame.pkg'});
 assert.equal(response.status,202);const id=response.headers.get('x-tachen-job');await response.text();await until(()=>f.runtime.jobs.snapshot().find(j=>j.id===id)?.status==='completed');
 assert.equal(f.downloads(),1);assert.equal(f.calls.length,1);assert.ok(!(await fs.readdir(f.root)).some(x=>x.endsWith('.download')));
});
test('a forged content ID and malformed package never reach native installation',async t=>{
 const f=await fixture(t);
 for(const [bytes,contentId] of [[pkg(),'different-content'],[Buffer.alloc(8192),'']]){
  const form=new FormData();form.set('file',new Blob([bytes]),'test.pkg');if(contentId)form.set('content_id',contentId);
  const r=await fetch(f.url,{method:'POST',body:form});const id=r.headers.get('x-tachen-job');assert.equal(r.status,202);await r.text();
  await until(()=>f.runtime.jobs.snapshot().find(j=>j.id===id)?.status==='failed');
 }
 assert.equal(f.calls.length,0);
});
test('uncertain installation remains recorded and reconciliation never submits it twice',async t=>{
 const f=await fixture(t,{uncertain:true}),form=new FormData();form.set('file',new Blob([pkg()]),'test.pkg');
 const r=await fetch(f.url,{method:'POST',body:form});const id=r.headers.get('x-tachen-job');await r.text();
 await until(()=>f.runtime.jobs.snapshot().find(j=>j.id===id)?.status==='interrupted');
 await assert.rejects(f.runtime.jobs.reconcile(id),{code:'OUTCOME_UNKNOWN'});assert.equal(f.calls.length,1);
 const child=f.runtime.jobs.snapshot().find(j=>j.kind==='package.install');f.requests.get(child.id).stage=6;
 await f.runtime.jobs.reconcile(child.id);await f.runtime.jobs.reconcile(id);assert.equal(f.runtime.jobs.snapshot().find(j=>j.id===id).status,'completed');assert.equal(f.calls.length,1);
});
test('receiver rejects cross-site submission and unsupported hints, and only listens after enabling',async t=>{
 const f=await fixture(t);const forbidden=await fetch(f.url,{method:'POST',headers:{Origin:'https://unrelated.test','Content-Type':'application/x-www-form-urlencoded'},body:'url=x'});assert.equal(forbidden.status,403);await forbidden.text();
 const hints=await fetch(f.url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'url=https%3A%2F%2Fexample.test%2Fgame.pkg&ex_uri=other'});assert.equal(hints.status,409);await hints.text();
 assert.equal(f.runtime.jobs.snapshot().length,0);assert.equal(f.receiver.snapshot().active,null);
 await f.receiver.setEnabled(false);assert.equal(f.receiver.snapshot().enabled,false);
});
test('two queued DPI workflows leave a free slot for child work instead of deadlocking',async t=>{
 const f=await fixture(t),ids=[];
 for(let i=0;i<2;i++){const r=await fetch(f.url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'url=https%3A%2F%2Fexample.test%2Fgame.pkg'});assert.equal(r.status,202);ids.push(r.headers.get('x-tachen-job'));await r.text();}
 await until(()=>ids.every(id=>f.runtime.jobs.snapshot().find(j=>j.id===id)?.status==='completed'));
 assert.equal(f.calls.length,2);assert.equal(f.downloads(),2);
});
