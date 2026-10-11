import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectCheatFiles,verifyCheatBlob} from '../src/cheat-sources.mjs';
import {importCheatJson} from '../src/cheats.mjs';
test('repository selection accepts only bounded JSON blobs for installed titles',()=>{
 const row={path:'json/CUSA00265_01.00.json',type:'blob',sha:'a'.repeat(40),size:100};
 const tree={truncated:false,tree:[row,{...row,path:'json/../CUSA00265_01.00.json'},{...row,path:'json/CUSA00001_01.00.json'},{...row,size:5000000}]};
 assert.deepEqual(selectCheatFiles(tree,new Set(['CUSA00265'])),[row]);
 assert.throws(()=>selectCheatFiles({...tree,truncated:true},new Set()),{code:'CHEAT_SOURCE'});
 const bytes=Buffer.from('example'),digest=createHash('sha1').update(Buffer.concat([Buffer.from('blob 7\0'),bytes])).digest('hex');verifyCheatBlob(bytes,digest);
 assert.throws(()=>verifyCheatBlob(Buffer.from('changed'),digest),{code:'CHEAT_SOURCE_HASH'});
});
test('cheat files import without a running game while explicit mismatches still fail',()=>{
 const doc={id:'CUSA00265',version:'01.00',name:'Minecraft',process:'eboot.bin',mods:[{name:'Test',memory:[{offset:'10',on:'01',off:'00'}]}]};
 assert.equal(importCheatJson(JSON.stringify(doc)).titleId,'CUSA00265');
 assert.equal(importCheatJson(JSON.stringify(doc),{fallback:{titleId:'PPSA00001',version:'01.000.000'}}).titleId,'CUSA00265');
 assert.throws(()=>importCheatJson(JSON.stringify(doc),{titleId:'PPSA00001'}),{code:'CHEAT_IDENTITY'});
 delete doc.id;delete doc.version;assert.equal(importCheatJson(JSON.stringify(doc),{fallback:{titleId:'CUSA00265',version:'01.00'}}).titleId,'CUSA00265');
});
