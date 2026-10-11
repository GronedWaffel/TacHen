import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {createHash} from 'node:crypto';
import {readDpiForm} from '../src/dpi-form.mjs';
function request(chunks,type='multipart/form-data; boundary=TacHenTest'){const r=Readable.from(chunks);r.headers={'content-type':type};return r;}
function sink(){let bytes=0,peak=0,ended=0,aborted=0;const hash=createHash('sha256');return {write:async b=>{bytes+=b.length;peak=Math.max(peak,b.length);hash.update(b);},end:async()=>{ended++;},abort:async()=>{aborted++;},state:()=>({bytes,peak,ended,aborted}),digest:()=>hash.digest('hex')};}
const head='--TacHenTest\r\nContent-Disposition: form-data; name="file"; filename="Game.pkg"\r\nContent-Type: application/octet-stream\r\n\r\n';
const tail='\r\n--TacHenTest--\r\n';
test('DPI multipart streams a large package without accumulating it in the parser',async()=>{
 const target=sink(),block=Buffer.alloc(65536,0x35),hash=createHash('sha256');
 async function* chunks(){yield Buffer.from(head);for(let i=0;i<512;i++){hash.update(block);yield block;}yield Buffer.from(tail);}
 const form=await readDpiForm(request(chunks()),{onFile:async({name})=>{assert.equal(name,'Game.pkg');return target;}});
 assert.deepEqual(form.file,{name:'Game.pkg',bytes:32*1048576});assert.equal(target.digest(),hash.digest('hex'));assert.ok(target.state().peak<=131072);assert.equal(target.state().ended,1);assert.equal(target.state().aborted,0);
});
test('multipart boundaries split at every byte and false boundary prefixes preserve file bytes',async()=>{
 const body=Buffer.concat([Buffer.alloc(8192,0x41),Buffer.from('\r\n--TacHenTestXYbinary data\r\n--TacHenTest-?more')]);
 const wire=Buffer.concat([Buffer.from(head),body,Buffer.from(tail)]),target=sink();
 const form=await readDpiForm(request(Array.from(wire,byte=>Buffer.from([byte]))),{onFile:async()=>target});
 assert.equal(form.file.bytes,body.length);assert.equal(target.digest(),createHash('sha256').update(body).digest('hex'));
});
test('DPI URL fields match standard URL-encoded and multipart clients',async()=>{
 const url='http://192.168.1.2:8080/game.pkg?part=one&x=two';
 const a=await readDpiForm(request([Buffer.from('url='+encodeURIComponent(url)+'&content_name=My+Game')],'application/x-www-form-urlencoded'));
 assert.equal(a.fields.url,url);assert.equal(a.fields.content_name,'My Game');assert.equal(a.file,null);
 const wire=`--TacHenTest\r\nContent-Disposition: form-data; name="url"\r\n\r\n${url}${tail}`;
 const b=await readDpiForm(request([Buffer.from(wire)]));assert.equal(b.fields.url,url);assert.equal(b.file,null);
});
test('truncation, extra trailing data, duplicate files and mixed URL/file requests abort only staging',async()=>{
 const bytes=Buffer.alloc(8192,0x41),prefix=Buffer.concat([Buffer.from(head),bytes]);
 const second='\r\n--TacHenTest\r\nContent-Disposition: form-data; name="file"; filename="Another.pkg"\r\n\r\n';
 const url='\r\n--TacHenTest\r\nContent-Disposition: form-data; name="url"\r\n\r\nhttp://example.test/a.pkg';
 for(const ending of ['',tail.slice(0,-1),tail+'extra',second+tail,url+tail]){
  const target=sink();await assert.rejects(readDpiForm(request([prefix,Buffer.from(ending)]),{onFile:async()=>target}),{code:'DPI_FORM'});assert.equal(target.state().aborted,1);
 }
});
test('untrusted filenames, field duplicates, size limits and invalid URL encoding are rejected',async()=>{
 for(const name of ['../Game.pkg','C:\\Game.pkg','Game.elf','bad\u0000.pkg']){
  let staged=false;await assert.rejects(readDpiForm(request([Buffer.from(head.replace('Game.pkg',name))]),{onFile:()=>{staged=true;return sink();}}),{code:'DPI_FORM'});assert.equal(staged,false);
 }
 for(const data of ['url=x&url=y','url=%zz','unexpected=1','url=','url='+('a'.repeat(8193))])await assert.rejects(readDpiForm(request([Buffer.from(data)],'application/x-www-form-urlencoded')),{code:'DPI_FORM'});
 const target=sink();await assert.rejects(readDpiForm(request([Buffer.from(head),Buffer.alloc(8193),Buffer.from(tail)]),{maxBytes:8192,onFile:()=>target}),{code:'DPI_FORM'});assert.equal(target.state().aborted,1);
});
