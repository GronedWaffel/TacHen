// SPDX-License-Identifier: GPL-3.0-or-later
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { encodeDeck } from '../src/deck.mjs';
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
async function render(t,frame,open=1,selected=0,panels=false){
  const file=path.join(root,'build','layout-'+crypto.randomUUID()+'.bin');
  await fs.writeFile(file,encodeDeck(frame));t.after(()=>fs.unlink(file));
  const result=spawnSync(exe,[file,String(open),String(selected),...(panels?['panels']:[])],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('native focus layout keeps section navigation, selection details and live metrics in separate areas',async t=>{
  const view=await render(t,frame(),1,1);
  assert.equal(view[0].text,'TacHen');assert.equal(view[1].text,'Plugins');
  assert.equal(view[6].text,'> Payloads');assert.equal(view[13].ink,0);assert.equal(view[21].text,'ON');
  assert.equal(view[29].text,'Enable game autostart');
  assert.match(view.slice(33,39).map(x=>x.text).join(' '),/does not unload code/);
  assert.equal(view[39].text,'X  Select');assert.equal(view[41].text,frame().ip);assert.match(view[42].text,/60 FPS/);
  for(const item of view)assert.ok(item.x>=0&&item.x<1920&&item.y>=0&&item.y+item.size<=1080);
  const updated=await render(t,frame({metrics:'59.8 FPS',metricsSequence:2}),1,1);
  assert.deepEqual(updated.filter((_,i)=>i!==42),view.filter((_,i)=>i!==42),'metric refresh does not change action presentation');
});

test('native panels follow selection and are hidden with stale UI while independent overlays retain their opt-ins',async t=>{
  const panels=await render(t,frame(),1,1,true);
  assert.equal(panels.length,12);assert(panels.slice(0,9).every(p=>p.visible));
  assert.equal(panels[5].y,334);assert.equal(panels[6].y,344);assert.equal(panels[9].visible,0);
  for(const p of panels)assert(p.x>=0&&p.y>=0&&p.width>0&&p.height>0&&p.x+p.width<=1920&&p.y+p.height<=1080);
  const empty=await render(t,frame({rows:[]}),1,999,true);assert.equal(empty[5].visible,0);assert.equal(empty[8].visible,0);
  const closed=await render(t,frame(),0,0,true);assert(closed.slice(0,10).every(p=>!p.visible));assert(closed[10].visible&&closed[11].visible);
  const notice=await render(t,frame({notices:{sequence:1,current:{level:'attention',remainingMs:1200,count:1,title:'Check Activity',detail:'Review before retrying.'}}}),0,0,true);
  assert.equal(notice[9].visible,1);
  const stale=await render(t,frame({ready:false,ipVisible:false}),0,0,true);assert(stale.every(p=>!p.visible));
});
test('disabled and empty native views explain their state without inventing actions',async t=>{
  const held=await render(t,frame(),1,2);
  assert.equal(held[39].text,'Currently unavailable');assert.equal(held[39].ink,4);
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
