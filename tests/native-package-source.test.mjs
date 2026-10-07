// SPDX-License-Identifier: GPL-3.0-or-later
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
const root=path.resolve(import.meta.dirname,'..'), exe=path.join(root,'build/native-package-source-test.exe');
const target='/0123456789abcdef0123456789abcdef/package.pkg', size=193273528320;
before(async()=>{
 await fs.mkdir(path.join(root,'build'),{recursive:true});
 const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
 const run=spawnSync(zig,['cc','-std=c11','-O1','-Wall','-Wextra','-Werror','-Iplatform/native',
  'tests/native-package-source-runner.c','platform/native/package-core.c','platform/native/package-http.c','platform/native/package-source.c','-lws2_32','-o',exe],
  {cwd:root,encoding:'utf8',env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')}});
 assert.equal(run.status,0,run.stderr||run.error?.message);
 const fail=spawnSync(exe,['--fail-check'],{encoding:'utf8'});assert.equal(fail.status,90);assert.match(fail.stderr,/CHECK failed/);
});
function parse(extra='',method='GET',url=target){
 const input=Buffer.isBuffer(extra)?extra:`${method} ${url} HTTP/1.1\r\nHost: 127.0.0.1\r\n${extra}\r\n`;
 const run=spawnSync(exe,['--parse'],{input,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const at=run.stdout.indexOf('\n');return {value:JSON.parse(run.stdout.slice(0,at)),response:run.stdout.slice(at+1)};
}
test('package HTTP parser keeps 180 GiB ranges exact and emits correct HEAD/416 lengths',()=>{
 assert.deepEqual(parse().value,{rc:0,status:200,head:0,start:0,length:size});
 assert.deepEqual(parse('Range: bytes=5368709120-5368709151\r\n').value,{rc:0,status:206,head:0,start:5368709120,length:32});
 assert.deepEqual(parse('Range: bytes=-32\r\n').value,{rc:0,status:206,head:0,start:size-32,length:32});
 assert.equal(parse('Range: bytes=0-999999999999\r\n').value.length,size);
 assert.equal(parse(`Range: bytes=${size-1}-\r\n`).value.length,1);
 const head=parse('','HEAD');assert.equal(head.value.head,1);assert.match(head.response,/Content-Length: 193273528320\r\n/);
 assert.equal(parse('Range: bytes=0-3\r\n','HEAD').value.length,size);
 for(const range of ['bytes=0-1,4-5','bytes=1-0','bytes=-0','bytes=193273528320-','bytes=18446744073709551616-','bytes=0-18446744073709551616','bytes=-','units=0-2']){
  const r=parse(`Range: ${range}\r\n`);assert.equal(r.value.status,416,range);assert.match(r.response,/Content-Range: bytes \*\/193273528320/);
 }
});
test('package HTTP parser refuses ambiguous framing and any other file route',()=>{
 for(const extra of ['Range: bytes=0-1\r\nRange: bytes=2-3\r\n','Content-Length: 1\r\n','Content-Length: 0\r\nContent-Length: 0\r\n',
  'Transfer-Encoding: chunked\r\n','Expect: 100-continue\r\n','Host: duplicate\r\n',' bad: value\r\n','Range : bytes=0-1\r\n','Bad: x\ny\r\n'])assert.equal(parse(extra).value.rc,-1,extra);
 for(const url of ['/','/../data/secret',target+'?other',target.replace('0123','abcd')])assert.equal(parse('', 'GET',url).value.status,404);
 assert.equal(parse('','POST').value.status,405);
 for(const input of [Buffer.from('GET / HTTP/1.1\n\n'),Buffer.from(`GET ${target} HTTP/1.1\r\nX: a\0b\r\n\r\n`),Buffer.from('x'.repeat(4100)+'\r\n\r\n')])assert.equal(parse(input).value.rc,-1);
});
async function launch(t){
 const dir=await fs.mkdtemp(path.join(root,'build/package-source-'));
 const file=path.join(dir,'owned-test.pkg'), bytes=Buffer.alloc(1024*1024+137);for(let i=0;i<bytes.length;i++)bytes[i]=(i*37+i%17)&255;
 await fs.writeFile(file,bytes);const child=spawn(exe,[file],{cwd:root,stdio:['pipe','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);
 const lines=createInterface({input:child.stdout});const iterator=lines[Symbol.asyncIterator]();
 const first=await iterator.next();assert(!first.done,errors);const url=first.value;
 t.after(async()=>{if(child.exitCode===null){const end=once(child,'exit');child.stdin.end('stop\n');await end;}lines.close();assert(dir.startsWith(path.join(root,'build')+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return {url,bytes,file,child,iterator,async health(){child.stdin.write('health\n');return (await iterator.next()).value;}};
}
function request(url,headers={},method='GET'){
 return new Promise((resolve,reject)=>{
  const req=http.request(url,{headers,method,agent:false},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);});
  req.setTimeout(5000,()=>req.destroy(Error('request timed out')));req.on('error',reject);req.end();
 });
}
test('native loopback serves exact full and concurrent ranged bytes from its retained descriptor',async t=>{
 const server=await launch(t);assert.match(server.url,/^http:\/\/127\.0\.0\.1:\d+\//);assert.equal(await server.health(),'1');
 const full=await request(server.url);assert.equal(full.status,200);assert.deepEqual(full.body,server.bytes);
 const head=await request(server.url,{},'HEAD');assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),server.bytes.length);
 const ranges=[[0,65535],[123,33000],[65536,131071],[server.bytes.length-300,server.bytes.length-1]];
 const replies=await Promise.all(ranges.map(([a,b])=>request(server.url,{Range:`bytes=${a}-${b}`})));
 replies.forEach((r,i)=>{const [a,b]=ranges[i];assert.equal(r.status,206);assert.equal(r.headers['content-range'],`bytes ${a}-${b}/${server.bytes.length}`);assert.deepEqual(r.body,server.bytes.subarray(a,b+1));});
 const bad=await request(server.url.replace(target,'/private'));assert.equal(bad.status,404);assert.equal(bad.body.length,0);
 const outside=await request(server.url,{Range:`bytes=${server.bytes.length}-`});assert.equal(outside.status,416);assert.equal(outside.body.length,0);
 assert.equal(await server.health(),'1');
});
test('native source closes excess clients, stops with stalled readers, and detects file mutation',async t=>{
 const s=await launch(t);const u=new URL(s.url);const peers=[];
 for(let i=0;i<4;i++){const p=net.connect({host:u.hostname,port:Number(u.port)});p.on('error',()=>{});await once(p,'connect');peers.push(p);}
 t.after(()=>peers.forEach(p=>p.destroy()));
 // Force the accept loop to process its backlog before the excess request.
 await new Promise(resolve=>setTimeout(resolve,200));
 const excess=net.connect({host:u.hostname,port:Number(u.port)});excess.on('error',()=>{});await once(excess,'connect');
 let timeout;
 try {await Promise.race([once(excess,'close'),new Promise((_,reject)=>{timeout=setTimeout(()=>{excess.destroy();reject(Error('excess connection was not closed'));},2000);})]);}
 finally {clearTimeout(timeout);excess.destroy();}
 peers.forEach(p=>p.destroy());await new Promise(resolve=>setTimeout(resolve,150));
 await fs.truncate(s.file,100);
 await assert.rejects(request(s.url));assert.equal(await s.health(),'0');
});
test('native loopback shutdown does not wait for clients to finish their requests',async t=>{
 const s=await launch(t),u=new URL(s.url);const client=net.connect({host:u.hostname,port:Number(u.port)});client.on('error',()=>{});
 t.after(()=>client.destroy());await once(client,'connect');client.write('GET ');await new Promise(resolve=>setTimeout(resolve,150));
 const before=performance.now(),exit=once(s.child,'exit');s.child.stdin.end('stop\n');
 const [code]=await exit;assert.equal(code,0);assert(performance.now()-before<1500);
});
