// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only, off-console check of a locally downloaded, pinned cheat corpus.
// No network, registry writes, memory operations or console connection.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { importCheatFile } from '../src/cheat-import.mjs';
import { cheatPacket } from '../src/cheats.mjs';
const root=path.resolve(process.argv[2]||'.local/cheat-corpus');
const manifest=JSON.parse(await fs.readFile(path.join(root,'provenance.json'),'utf8'));
if(!/^[a-f0-9]{40}$/.test(manifest.commit)||!Array.isArray(manifest.files)||manifest.files.length>1000)throw Error('Invalid corpus provenance');
const results=[];
for(const item of manifest.files){
  if(!/^(json|shn|mc4)\/[^/\\]+\.(json|shn|mc4)$/.test(item.path)||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid corpus entry');
  const file=path.join(root,item.path),stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>4*1024*1024||stat.size!==item.bytes)throw Error('Invalid corpus file size');
  const bytes=await fs.readFile(file);
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Corpus hash changed');
  const row={path:item.path};
  try{
    const pack=await importCheatFile(bytes.toString('utf8'),item);row.cheats=pack.cheats.length;row.packetReady=0;row.held={};
    for(const cheat of pack.cheats){
      try{cheatPacket(pack,cheat.id,true);cheatPacket(pack,cheat.id,false);row.packetReady++;}
      catch(error){row.held[error.code||'UNEXPECTED']=(row.held[error.code||'UNEXPECTED']||0)+1;}
    }
  }catch(error){row.error=error.code||'UNEXPECTED';row.message=error.message;}
  results.push(row);
}
console.log(JSON.stringify({repository:manifest.repository,commit:manifest.commit,files:results.length,
  imported:results.filter(r=>!r.error).length,cheats:results.reduce((n,r)=>n+(r.cheats||0),0),
  packetReady:results.reduce((n,r)=>n+(r.packetReady||0),0),hardwareVerified:false,results},null,2));
