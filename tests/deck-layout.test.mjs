// SPDX-License-Identifier: GPL-3.0-or-later
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { encodeDeck } from '../src/deck.mjs';
import {fileManagerFrame} from '../src/deck-file-browser.mjs';
const root=path.resolve(import.meta.dirname,'..'), exe=path.join(root,'build/deck-layout-test.exe');
before(()=>{
  const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const result=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/deck','tests/deck-layout-runner.c',
    'platform/deck/deck-layout.c','platform/deck/deck-core.c','-o',exe],{cwd:root,encoding:'utf8',
    env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')}});
  assert.equal(result.status,0,result.stderr||result.error?.message);
});
function frame(extra={}){
  return {ready:true,sequence:1,page:1,title:'TacHen / Plugins',subtitle:'Your console. Your controls.',
    footer:'L1 / R1 sections    X select    Circle back    L3 + R3 close',ip:'192.168.137.215',ipVisible:true,
    metricsSequence:1,metrics:'60 FPS  |  CPU 18%  |  RAM 782 MB',
    rows:[{token:'1'.repeat(32),label:'Session watcher',detail:'Start this plugin process before opening a game.',enabled:true},
      {token:'2'.repeat(32),label:'Enable game autostart',detail:'Wait for the exact target game and version. Disabling autostart does not unload code.',enabled:true,on:true},
      {token:'3'.repeat(32),label:'Load into game',detail:'Startup recovery is holding native operations.',enabled:false}],...extra};
}
test('file browser renders both file tables, paths, selection and action toolbar in their own regions',async t=>{
 const listing=source=>({source,parent:null,entries:[{name:'example.elf',source:source+'/example.elf',bytes:2048,directory:false}]});
 const browser=fileManagerFrame({active:0,panes:[{listing:listing('/data'),offset:0},{listing:listing('/mnt/usb0'),offset:0}]});
 const f=frame({browser,rows:browser.rows.map((r,i)=>({...r,token:String(i).repeat(32)})),title:'TacHen / File browser'});
 const l=await render(t,f,1,13),p=await render(t,f,1,13,true);
 assert.equal(l[1].text,'/data');assert.equal(l[2].text,'/mnt/usb0');assert.equal(l[9].text,'example.elf');assert.equal(l[21].text,'example.elf');assert.equal(l[45].text,'2.0 KiB');
 assert(l[9].x<960&&l[21].x>960);assert.equal(l[56].text,'Copy');assert.equal(l[63].text,'Close');assert.equal(p[5].x,974);
 assert(l.slice(56).every(x=>x.y>=840));const closed=await render(t,f,0,13,true);assert(closed.slice(16).every(x=>!x.visible));
});
async function render(t,frame,open=1,selected=0,panels=false){
  const file=path.join(root,'build','layout-'+crypto.randomUUID()+'.bin');
  await fs.writeFile(file,encodeDeck(frame));t.after(()=>fs.unlink(file));
  const result=spawnSync(exe,[file,String(open),String(selected),...(panels?['panels']:[])],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('native focus layout keeps section navigation, selection details and live metrics in separate areas',async t=>{
  const view=await render(t,frame(),1,1);
  assert.equal(view[0].text,'TacHen');assert.equal(view[1].text,'Plugins');
  assert.ok(view.slice(4,12).every(item=>!item.text),'submenus do not repeat the navigation rail');
  assert.equal(view[13].ink,7);assert.equal(view[21].text,'ON');
  assert.equal(view[29].text,'Enable game autostart');
  assert.match(view.slice(33,39).map(x=>x.text).join(' '),/does not unload code/);
  assert.equal(view[39].text,'X  Select');assert.equal(view[41].text,frame().ip);assert.match(view[42].text,/60 FPS/);
  for(const item of view)assert.ok(item.x>=0&&item.x<1920&&item.y>=0&&item.y+item.size<=1080);
  const updated=await render(t,frame({metrics:'59.8 FPS',metricsSequence:2}),1,1);
  assert.deepEqual(updated.filter((_,i)=>i!==42),view.filter((_,i)=>i!==42),'metric refresh does not change action presentation');
});

test('native panels follow selection and are hidden with stale UI while independent overlays retain their opt-ins',async t=>{
  const panels=await render(t,frame(),1,1,true);
  assert.equal(panels.length,24);assert(panels.slice(0,9).every(p=>p.visible));
  assert.equal(panels[5].y,386);assert.equal(panels[6].y,876);assert.equal(panels[9].visible,0);
  for(const p of panels)assert(p.x>=0&&p.y>=0&&p.width>0&&p.height>0&&p.x+p.width<=1920&&p.y+p.height<=1080);
  for(const p of panels.filter(p=>p.visible))assert(p.x>=255&&p.x+p.width<=1665,'menu stays in the centered rectangle');
  const empty=await render(t,frame({rows:[]}),1,999,true);assert.equal(empty[5].visible,0);assert.equal(empty[8].visible,0);
  const closed=await render(t,frame(),0,0,true);assert(closed.slice(0,10).every(p=>!p.visible));assert(closed[10].visible&&closed[11].visible);
  const notice=await render(t,frame({notices:{sequence:1,current:{level:'attention',remainingMs:1200,count:1,title:'Check Activity',detail:'Review before retrying.'}}}),0,0,true);
  assert.equal(notice[9].visible,1);
  const stale=await render(t,frame({ready:false,ipVisible:false}),0,0,true);assert(stale.every(p=>!p.visible));
});
test('disabled and empty native views explain their state without inventing actions',async t=>{
  const held=await render(t,frame(),1,2);
  assert.equal(held[39].text,'');assert.equal(held[39].ink,4);
  assert.match(held.slice(33,39).map(x=>x.text).join(' '),/Startup recovery/);
  const empty=await render(t,frame({rows:[]}),1,999);
  assert.equal(empty[29].text,'No actions here yet');assert.equal(empty[39].text,'');
});
test('closing the deck clears its text while retaining opted-in metrics/IP and bounded notices',async t=>{
  const state=frame({notices:{sequence:2,current:{level:'attention',remainingMs:1200,count:1,title:'Operation needs attention',detail:'Open Activity to review the result.'}}});
  const closed=await render(t,state,0,0);
  assert.ok(closed.slice(0,41).every(x=>!x.text));assert.equal(closed[43].ink,4);assert.match(closed[43].text,/attention/);
  const expired=await render(t,{...state,notices:null},0,0);assert.equal(expired[43].text,'');assert.equal(expired[44].text,'');
  const stale=await render(t,frame({ready:false,ipVisible:false}),0,0);assert.ok(stale.every(x=>!x.text));
});
test('native wrapping preserves UTF-8 boundaries and constrains hostile long labels',async t=>{
  const rows=Array.from({length:8},(_,i)=>({token:String(i).repeat(32),enabled:true,
    label:'非常に長いゲームの名前 '.repeat(9),detail:'Never-repeat-this-operation-without-checking-the-result '.repeat(8)}));
  const view=await render(t,frame({rows}),1,0);
  assert.match(view[12].text,/\.\.\.$/);assert.ok(!view.some(x=>x.text.includes('\ufffd')));
  assert.ok(view.every(x=>Buffer.byteLength(x.text)<256));
  assert.equal(view.slice(33,39).map(x=>x.text).join('').replaceAll(' ',''),
    rows[0].detail.slice(0,159).replaceAll(' ',''),'all detail text received on the wire remains readable');
  rows[0].detail='eighteencharacters '.repeat(9);
  const words=await render(t,frame({rows}),1,0);
  assert.equal(words.slice(33,39).map(x=>x.text).join('').replaceAll(' ',''),rows[0].detail.slice(0,159).replaceAll(' ',''),
    'word boundaries must not waste the remaining space and hide a failure explanation');
});

test('production renderer avoids idle managed mutations and releases failed or replaced scenes',()=>{
  const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const target=path.join(root,'build/deck-view-test.exe');
  const compiled=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/deck','tests/deck-view-runner.c',
    'platform/deck/deck-layout.c','platform/deck/deck-view.c','-o',target],{cwd:root,encoding:'utf8',
    env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')}});
  assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
  const run=spawnSync(target,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.error?.message);
});

test('native metadata selects Widget overload and rejects mismatched or ambiguous signatures',()=>{
  const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
  const target=path.join(root,'build/deck-metadata-test.exe');
  const compiled=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/deck','tests/deck-metadata-runner.c',
    'platform/deck/deck-layout.c','-o',target],{cwd:root,encoding:'utf8',
    env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')}});
  assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
  const run=spawnSync(target,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.error?.message);
});


test('native chrome stays black and white across accent preferences without recoloring warnings',async t=>{
  const expected={mint:[1,1,1,1],amber:[1,1,1,1],ice:[1,1,1,1]};
  let base;
  for(const [accent,color] of Object.entries(expected)){
    const data=frame({accent}),view=await render(t,data,1,2),panels=await render(t,data,1,2,true);
    assert.deepEqual(view[0].color,[0.97,0.97,0.97,1]);assert.deepEqual(view[41].color,[0.7,0.7,0.7,1]);
    assert.deepEqual(panels[6].color,[0.68,0.68,0.68,0.28]);assert.deepEqual(panels[5].color,color);assert.deepEqual(panels[8].color,color);
    assert.equal(view[39].ink,4);assert.deepEqual(view[39].color,[1,0.76,0.38,1]);
    const geometry={labels:view.map(({x,y,size,text})=>({x,y,size,text})),panels:panels.map(({color,...p})=>p)};
    if(base)assert.deepEqual(geometry,base);else base=geometry;
    const closed=await render(t,{...data,notices:{sequence:1,current:{level:'attention',count:1,remainingMs:1000,title:'Attention',detail:'Check Activity'}}},0,0);
    assert.equal(closed[43].ink,4);assert.deepEqual(closed[41].color,[0.97,0.97,0.97,1]);
  }
});

test('home tiles use a centered translucent surface and retain every action label',async t=>{
 const names=['Packages','Payloads','Plugins','Games','Saved games','Cheats','Transfers','Settings'];
 const data=frame({page:0,title:'TacHen / Home',grid:true,rows:names.map((label,i)=>({token:String(i).repeat(32),label,detail:'Choose files and configure this feature.',enabled:true}))});
 const view=await render(t,data,1,4),panels=await render(t,data,1,4,true);
 assert.deepEqual(view.slice(12,20).map(row=>row.text),names);
 assert(panels[1].color[3]>0&&panels[1].color[3]<1);
 assert(panels.slice(16,24).every(p=>p.visible&&p.width>=300&&p.height>=200));
 assert.equal(panels[20].color[3],1);assert.equal(view[16].ink,7);
 assert(!panels[4].visible,'home does not duplicate selection into a detail pane');
});

test('controller keyboard draws forty keys inside the accepted glass panel and vanishes on close',async t=>{
 const f=frame({keyboard:true,rows:[{token:'a'.repeat(32),label:'abcdefghijklmnopqrstuvwxyz0123456789',detail:'https://example.com/payload.elf',enabled:true}]});
 const labels=await render(t,f,1,39);assert.equal(labels[39].text,'Done');assert.equal(labels[38].text,'Delete');
 assert.equal(labels[36].text,'.');assert.equal(labels[37].text,'/');assert.match(labels[41].text,/https:/);
 const panels=await render(t,f,1,39,true);assert.equal(panels[5].visible,1);assert.equal(panels[5].x,1492);assert.equal(panels[5].y,688);
 const closed=await render(t,f,0,39);assert.ok(closed.slice(0,40).every(x=>!x.text));
});
