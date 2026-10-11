import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash as hostHash} from 'node:crypto';
import {createHash} from '../platform/runtime/crypto.mjs';
test('native hash adapter preserves subarray offsets, multi-update and bounded calls',()=>{
 const prior=globalThis.__native,calls=[];
 globalThis.__native={hashCreate:()=>hostHash('sha256'),hashUpdate(h,b,off,n){assert.ok(n<=1048576);calls.push(n);h.update(new Uint8Array(b,off,n));},hashDigest(h){const b=h.digest();return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}};
 try{
  const large=Buffer.alloc(2100000,0xab),slice=Buffer.from('ignore--correct--ignore').subarray(8,15);
  assert.equal(createHash('sha256').update(slice).update(large).update('utf8 Ω').digest('hex'),hostHash('sha256').update(slice).update(large).update('utf8 Ω').digest('hex'));
  assert.ok(calls.length>=5);assert.equal(createHash('sha256').update(Buffer.alloc(0)).digest('hex'),hostHash('sha256').digest('hex'));
  assert.throws(()=>createHash('md5'));const h=createHash('sha256');h.digest();assert.throws(()=>h.update(Buffer.from('x')));
 }finally{globalThis.__native=prior;}
});
