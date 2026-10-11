import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createHttpServer } from '../platform/runtime/http-server.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function listen(t, options, handler) {
  const sockets = new Set();
  const server = createHttpServer(fn => net.createServer(socket => { sockets.add(socket); socket.once('close',()=>sockets.delete(socket)); fn(socket); }), options, handler);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}
async function connection(port) {
  const socket = net.createConnection({port,host:'127.0.0.1'}); await once(socket,'connect');
  const chunks=[];socket.on('data',chunk=>chunks.push(chunk));
  const end = new Promise((resolve,reject) => {socket.on('error',reject);socket.on('close',()=>resolve(Buffer.concat(chunks).toString()));});
  return {socket,end};
}
test('console HTTP streams a 32 MiB body with bounded buffering and backpressure', {timeout:15000}, async t => {
  const bytes=32*1048576,block=Buffer.alloc(65536,0x5a),expected=createHash('sha256');
  let entered,handled=false,received=0,peak=0;const early=new Promise(resolve=>entered=resolve);
  const port=await listen(t,{maxRequestBodyBytes:bytes},async (req,res)=>{
    handled=true;entered();assert.equal(req.complete,false);
    // Hold the consumer briefly: producer must not buffer the entire body.
    await delay(30);peak=req.readableLength;
    const hash=createHash('sha256');for await(const chunk of req){received+=chunk.length;hash.update(chunk);peak=Math.max(peak,req.readableLength);}
    assert.equal(req.complete,true);res.end(hash.digest('hex'));
  });
  const {socket,end}=await connection(port);
  socket.write(`POST /upload HTTP/1.1\r\nHost: console\r\nContent-Length: ${bytes}\r\n\r\n`);
  await early;assert.equal(handled,true);
  for(let sent=0;sent<bytes;sent+=block.length){expected.update(block);if(!socket.write(block))await once(socket,'drain');}
  const reply=await end;assert.match(reply,/HTTP\/1.1 200/);assert.ok(reply.endsWith(expected.digest('hex')));
  assert.equal(received,bytes);assert.ok(peak<=131072,`bounded request buffer: ${peak}`);
});
test('console HTTP rejects ambiguous framing and default oversized uploads before handlers run', async t=>{
  let calls=0;const port=await listen(t,{},()=>{calls++;});
  for(const [headers,status] of [
    ['Content-Length: 2097153',413],['Content-Length: 9007199254740992',413],
    ['Content-Length: 3\r\nContent-Length: 4',400],['Content-Length: -1',400],['Content-Length: 1e2',400],
    ['Content-Length: 3\r\nTransfer-Encoding: chunked',400],['Transfer-Encoding: chunked',400],['Bad Header: x',400]
  ]){const {socket,end}=await connection(port);socket.write(`POST / HTTP/1.1\r\nHost: console\r\n${headers}\r\n\r\n`);assert.match(await end,new RegExp(`HTTP/1.1 ${status}`));}
  assert.equal(calls,0);
});
test('console HTTP supports split headers, exact lengths and never dispatches a pipelined request',async t=>{
  let calls=0;const port=await listen(t,{},async(req,res)=>{calls++;let text='';for await(const chunk of req)text+=chunk.toString();res.end('received:'+text);});
  const {socket,end}=await connection(port);socket.write('POST / HTTP/1.1\r\nHost: con');await delay(5);
  socket.write('sole\r\nContent-Length: 3\r\n\r\nabcGET / HTTP/1.1\r\n\r\n');
  assert.ok((await end).endsWith('received:abc'));assert.equal(calls,1);
});
test('console HTTP reports a disconnected partial upload instead of committing it',async t=>{
  let resolve;const result=new Promise(r=>resolve=r);
  const port=await listen(t,{},async(req,res)=>{
    try{for await(const _ of req){}resolve('unexpected completion');}catch(e){resolve(e.code);}
    res.end('closed');
  });
  const {socket,end}=await connection(port);socket.end('POST / HTTP/1.1\r\nHost: console\r\nContent-Length: 100\r\n\r\nshort');
  assert.equal(await result,'UPLOAD_TRUNCATED');await end;
});
test('console HTTP returns a small response for an empty-body GET',async t=>{
  const port=await listen(t,{},async(req,res)=>{assert.equal(req.complete,true);for await(const _ of req)assert.fail('unexpected body');res.writeHead(200,{'Content-Type':'text/plain'});res.end('ready');});
  const {socket,end}=await connection(port);socket.write('GET / HTTP/1.1\r\nHost: console\r\n\r\n');assert.ok((await end).endsWith('ready'));
});

test('large-upload clients can wait for 100 Continue before sending their body', {timeout:3000}, async t=>{
  const port=await listen(t,{},async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;res.end('received:'+body);});
  const {socket,end}=await connection(port);
  const interim=once(socket,'data');
  socket.write('POST /upload HTTP/1.1\r\nHost: console\r\nExpect: 100-continue\r\nContent-Length: 4\r\n\r\n');
  assert.equal((await interim)[0].toString(),'HTTP/1.1 100 Continue\r\n\r\n');
  socket.write('test');assert.ok((await end).endsWith('received:test'));
  const invalid=await connection(port);
  invalid.socket.write('POST /upload HTTP/1.1\r\nHost: console\r\nExpect: 100-continue\r\nContent-Length: 2097153\r\n\r\n');
  const reply=await invalid.end;assert.match(reply,/413/);assert.doesNotMatch(reply,/100 Continue/);
});
test('completed responses release server slots even when clients keep their write side open',async t=>{
  const live=new Set();
  const server=createHttpServer(fn=>net.createServer({allowHalfOpen:true},socket=>{live.add(socket);socket.on('close',()=>live.delete(socket));fn(socket);}),{},(_req,res)=>res.end('done'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const socket of live)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  for(let i=0;i<48;i++){
    const client=net.createConnection({host:'127.0.0.1',port:server.address().port,allowHalfOpen:true});
    const ended=once(client,'end');client.resume();await once(client,'connect');
    client.write('GET /native/deck HTTP/1.1\r\nHost: console\r\n\r\n');await ended;
    await delay(1);assert.equal(live.size,0,'server must not await client FIN to reclaim a completed slot');client.destroy();
  }
});
