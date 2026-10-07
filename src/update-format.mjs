// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from 'node:crypto';
import { invariant } from './errors.mjs';
import { inspectPayload } from './payload-format.mjs';
export const UPDATE_HEADER = 256, UPDATE_MAX = 64 * 1024 * 1024;
export const UPDATE_PROFILES = ['11.00','11.20','11.60','12.00','12.02','12.20','12.40','12.60','12.70','13.00','13.20','13.40','13.42','13.60'];
const digest = bytes => createHash('sha256').update(bytes).digest();
export function parseUpdateHeader(input, { totalBytes, firmware } = {}) {
  const h = Buffer.from(input).subarray(0,UPDATE_HEADER);
  invariant(h.length===UPDATE_HEADER && h.subarray(0,8).equals(Buffer.from('TACUPD01')) && h.readUInt32LE(8)===1 && h.readUInt32LE(12)===UPDATE_HEADER,
    'UPDATE_FORMAT','Choose a TacHen update package produced by the build tools.');
  const bytes=h.readBigUInt64LE(16),mask=h.readUInt32LE(24),labelEnd=h.indexOf(0,96);
  invariant(bytes>=64n&&bytes<=BigInt(UPDATE_MAX)&&mask>0&&(mask&~0x3fff)===0&&h.readUInt32LE(28)===1&&
    h.subarray(32,64).some(x=>x!==0)&&h.subarray(64,96).some(x=>x!==0)&&
    labelEnd>96&&labelEnd<160&&h.subarray(96,labelEnd).every(x=>x>=32&&x<=126)&&h.subarray(labelEnd,224).every(x=>x===0)&&
    digest(h.subarray(0,224)).equals(h.subarray(224)), 'UPDATE_HEADER','The update header is invalid or incompatible.');
  invariant(totalBytes==null||Number(bytes)+UPDATE_HEADER===totalBytes,'UPDATE_SIZE','The update package length does not match its header.');
  const profiles=UPDATE_PROFILES.filter((_,i)=>mask&(1<<i));
  invariant(!firmware||profiles.includes(firmware),'UPDATE_FIRMWARE','This update does not declare your exact firmware profile.');
  return {format:'tachen',bytes:Number(bytes),sha256:h.subarray(32,64).toString('hex'),source:h.subarray(64,96).toString('hex'),label:h.subarray(96,labelEnd).toString('ascii'),profiles,stateSchema:1};
}
export function makeUpdatePackage(elf,{source,label,profiles=UPDATE_PROFILES}) {
  elf=Buffer.from(elf);inspectPayload(elf.subarray(0,16384),'tachen-runtime.elf',{totalBytes:elf.length});
  invariant(elf.length<=UPDATE_MAX&&/^[a-f0-9]{64}$/.test(source)&&typeof label==='string'&&/^[\x20-\x7e]{1,63}$/.test(label)&&
    Array.isArray(profiles)&&profiles.length&&new Set(profiles).size===profiles.length&&profiles.every(fw=>UPDATE_PROFILES.includes(fw)), 'UPDATE_BUILD','Invalid update build metadata.');
  const h=Buffer.alloc(UPDATE_HEADER);h.write('TACUPD01');h.writeUInt32LE(1,8);h.writeUInt32LE(UPDATE_HEADER,12);h.writeBigUInt64LE(BigInt(elf.length),16);
  h.writeUInt32LE(profiles.reduce((mask,fw)=>mask|(1<<UPDATE_PROFILES.indexOf(fw)),0),24);h.writeUInt32LE(1,28);
  digest(elf).copy(h,32);Buffer.from(source,'hex').copy(h,64);h.write(label,96,'ascii');digest(h.subarray(0,224)).copy(h,224);
  parseUpdateHeader(h,{totalBytes:h.length+elf.length});return Buffer.concat([h,elf]);
}
export function inspectUpdate(input, options={}) {
  const bytes=Buffer.from(input),header=parseUpdateHeader(bytes,{...options,totalBytes:bytes.length}),elf=bytes.subarray(UPDATE_HEADER);
  invariant(digest(elf).toString('hex')===header.sha256,'UPDATE_CHECKSUM','The update payload checksum does not match.');
  inspectPayload(elf.subarray(0,16384),'tachen-runtime.elf',{totalBytes:elf.length});return header;
}
