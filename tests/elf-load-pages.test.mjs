import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLoadPages} from '../scripts/elf-load-pages.mjs';
function elf(segments){
 const b=Buffer.alloc(0x30000);b.writeUInt32LE(0x464c457f);b[4]=2;b[5]=1;
 b.writeBigUInt64LE(64n,32);b.writeUInt16LE(56,54);b.writeUInt16LE(segments.length,56);
 segments.forEach(([start,size,file=0],i)=>{const p=64+i*56;b.writeUInt32LE(1,p);b.writeBigUInt64LE(BigInt(file),p+8);b.writeBigUInt64LE(BigInt(start),p+16);b.writeBigUInt64LE(BigInt(size),p+40);});return b;
}
test('PS5 payload build rejects the observed code/data shared page',()=>{
 assert.throws(()=>verifyLoadPages(elf([[0,0xb128e],[0xb1290,0x1000]])),/separate 16 KiB/);
});
test('aligned payload segments retain distinct protection pages',()=>{
 assert.equal(verifyLoadPages(elf([[0,0xb128e],[0xb4000,0x1c140],[0xd4000,0x8000]])),3);
});
test('overlapping and misaligned file mappings fail the build guard',()=>{
 assert.throws(()=>verifyLoadPages(elf([[0,0x5000],[0x4000,0x4000]])),/share a protection page/);
 assert.throws(()=>verifyLoadPages(elf([[0,0x5000,1]])),/separate 16 KiB/);
 assert.throws(()=>verifyLoadPages(Buffer.alloc(64)),/ELF64/);
});
