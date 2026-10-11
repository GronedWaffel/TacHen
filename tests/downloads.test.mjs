import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { downloadUrl, redirectedDownloadUrl } from '../src/download-url.mjs';
import { installDownloads } from '../src/downloads.mjs';
test('native download core enforces streaming, framing and cancellation limits',()=>{
  const zig='../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe';
  const build=spawnSync(zig,['cc','-Wall','-Wextra','-Werror','-Iplatform/native','tests/download-core-runner.c','platform/native/download-core.c','-o','build/download-core-test.exe'],{encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);const result=spawnSync('build/download-core-test.exe',[],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/validation passed/);
});
test('download links resolve relative shorteners and preserve signed query strings',()=>{
  const base='https://EXAMPLE.com/releases/a/file.elf?token=old';
  assert.equal(downloadUrl(base),'https://example.com/releases/a/file.elf?token=old');
  for(const [next,expected] of [['../b/file.elf?x=A%2Fb','https://example.com/releases/b/file.elf?x=A%2Fb'],
    ['?signature=X+Y','https://example.com/releases/a/file.elf?signature=X+Y'],['//cdn.example.com/p.elf','https://cdn.example.com/p.elf'],
    ['/x/../y/./p.elf#download','https://example.com/y/p.elf']]) assert.equal(redirectedDownloadUrl(next,downloadUrl(base)),expected);
  for(const value of ['file:///data/p.elf','javascript:alert(1)','https://name:password@example.com/p.elf','https://example.com:0/a','https://a\\b/p.elf','https://a/%20\nX:a','https://%65xample.com/p.elf']) assert.throws(()=>downloadUrl(value));
  assert.throws(()=>redirectedDownloadUrl('http://example.com/p.elf',downloadUrl(base)),{code:'DOWNLOAD_DOWNGRADE'});
});
function fixture(routes) {
  let active=null;const calls=[],handlers=new Map(),runtime={jobs:{register:(name,handler)=>handlers.set(name,handler)},inboxItems:[],sequence:0};
  const native={downloadStart(id,url){assert.equal(active,null);calls.push(url);const response=routes[url];assert.ok(response,url);active={request:id,bytes:96,total:96,...response};},
    downloadPoll(){return active;},downloadCancel(){if(active?.phase===1)active.phase=5;},downloadRelease(){assert.notEqual(active?.phase,1);active=null;}};
  const downloads=installDownloads(runtime,native,{delay:async()=>{}});
  const context={id:'a'.repeat(32),signal:{aborted:false},progress:async()=>{}};
  return {runtime,native,downloads,context,calls,handler:handlers.get('payload.download')};
}
test('native transport follows bounded redirects and releases each worker before the next request',async()=>{
  const f=fixture({'https://short.example/a':{phase:3,location:'https://cdn.example/a.elf'},'https://cdn.example/a.elf':{phase:2,status:200}});
  const result=await f.downloads.fetchToFile('https://short.example/a',1024,f.context);
  assert.equal(result.bytes,96);assert.match(result.source,/\/a{32}\.download$/);assert.equal(f.calls.length,2);result.release();assert.equal(f.native.downloadPoll(),null);
});
test('native transport cancels a live writer and rejects redirect loops and HTTPS downgrade',async()=>{
  for(const [route,code] of [[{phase:3,location:'/a'},'DOWNLOAD_REDIRECT_LOOP'],[{phase:3,location:'http://example.com/a'},'DOWNLOAD_DOWNGRADE']]){
    const f=fixture({'https://example.com/a':route});await assert.rejects(f.downloads.fetchToFile('https://example.com/a',1024,f.context),{code});assert.equal(f.native.downloadPoll(),null);
  }
  const f=fixture({'https://example.com/a':{phase:1}});f.context.progress=async()=>{f.context.signal.aborted=true;};
  await assert.rejects(f.downloads.fetchToFile('https://example.com/a',1024,f.context),{code:'DOWNLOAD_CANCELLED'});assert.equal(f.native.downloadPoll(),null);
});
test('download job imports and verifies before completion, never dispatching the payload',async()=>{
  const f=fixture({'https://example.com/a':{phase:2,status:200}});let imported=0;
  f.runtime.inbox={async importFile(source,name){assert.match(source,/\.download$/);assert.equal(name,'test.elf');imported++;return {id:'b'.repeat(32),sha256:'c'.repeat(64)};},list:async()=>[],status:async()=>({status:'verified'})};
  const input=f.handler.validate({url:'https://example.com/a',name:'test.elf'}), result=await f.handler.run(input,f.context);
  assert.equal(imported,1);assert.equal(await f.handler.verify(result),true);assert.equal(f.native.downloadPoll(),null);
  assert.throws(()=>f.handler.validate({url:input.url,name:'../x.elf'}),{code:'DOWNLOAD_NAME'});
});
