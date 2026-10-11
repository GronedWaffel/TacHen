// SPDX-License-Identifier: GPL-3.0-or-later
// Off-console visual harness. Coordinates/text come from the production C layout.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { encodeDeck } from '../src/deck.mjs';
const root=path.resolve(import.meta.dirname,'..');
const zig=process.env.ZIG||path.join(root,'../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
const exe=path.join(root,'build/deck-layout-preview.exe');
const result=spawnSync(zig,['cc','-O1','-Wall','-Wextra','-Werror','-Iplatform/deck','tests/deck-layout-runner.c',
  'platform/deck/deck-layout.c','platform/deck/deck-core.c','-o',exe],{cwd:root,encoding:'utf8',
  env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'build/zig-cache')}});
if(result.status!==0)throw Error(result.stderr||result.error?.message);
const home=[['Packages','Install PKG files from USB or console storage.'],['Payloads','Browse and run ELF payloads.'],['Plugins','Add plugins and manage automatic loading.'],['Games','Browse and mount your ShadowMount library.'],['Saved games','Export decrypted saves to USB or FTP.'],['Cheats','Choose cheats for your game and version.'],['Transfers','See installation progress and completed jobs.'],['Settings','FPS, display options and services.']];
const examples=[{name:'Home',grid:true,rows:home},{name:'Packages',rows:[['Install from storage','Choose a PKG from USB or console storage.'],['Example game.pkg','Verified package, ready to install.'],['Back','Return to Home.']]},{name:'Choose a file',rows:[['Refresh','Check connected drives again.'],['[Folder] Console storage','Open folder.'],['[Folder] USB 1','Open folder.'],['Back','Return to Packages.']]}];
const base={ready:true,sequence:1,page:0,subtitle:'Firmware 13.60',footer:'X  Select     Circle  Back     L3 + R3  Close',ip:'192.168.1.10',ipVisible:true,metrics:'',metricsSequence:1};
await fs.mkdir(path.join(root,'.local'),{recursive:true});
const input=path.join(root,'.local/deck-preview-frame.bin');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const color=item=>`rgb(${item.color.slice(0,3).map(x=>Math.round(x*255)).join(' ')})`;
const svg=view=>'<svg viewBox="0 0 1920 1080" role="img" aria-label="Native TacHen panel and text layout">'+
 view.panels.filter(p=>p.visible).map(p=>`<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="${color(p)}" fill-opacity="${p.color[3]}"/>`).join('')+
 view.labels.filter(p=>p.text).map(p=>`<text x="${p.x}" y="${p.y+p.size}" font-size="${p.size}" fill="${color(p)}">${escape(p.text)}</text>`).join('')+'</svg>';
const views=[];
for(const example of examples){
 const frame={...base,title:'TacHen / '+example.name,grid:!!example.grid,rows:example.rows.map(([label,detail],i)=>({label,detail,enabled:true,token:String(i).repeat(32)}))};
 await fs.writeFile(input,encodeDeck(frame));const frames=[];
 for(let selected=0;selected<frame.rows.length;selected++){
  const args=[input,'1',String(selected)];const a=spawnSync(exe,args,{encoding:'utf8'}),b=spawnSync(exe,[...args,'panels'],{encoding:'utf8'});
  if(a.status||b.status)throw Error(a.stderr||b.stderr);frames.push(svg({labels:JSON.parse(a.stdout),panels:JSON.parse(b.stdout)}));
 }
 views.push(frames);
}
const html=`<!doctype html><meta charset="utf-8"><title>TacHen native preview</title><style>
body{margin:0;background:#141414;color:#ddd;font:14px system-ui}header,footer{padding:18px 24px;display:flex;gap:24px;align-items:center}select{padding:8px;background:#222;border:1px solid #777;color:white;font:inherit}main{background:radial-gradient(ellipse at 30% 70%,#71818255,transparent 60%),linear-gradient(130deg,#19242d,#5a687b 60%,#172126)}svg{display:block;width:100%;max-height:calc(100vh - 150px);font-family:Arial,sans-serif}svg text{white-space:pre}footer{color:#aaa}</style>
<header><b>TacHen · native layout preview</b><label>Screen <select id="screen">${examples.map((e,i)=>`<option value="${i}">${e.name}</option>`).join('')}</select></label><label>Selection <select id="focus"></select></label></header><main id="drawing">${views[0][0]}</main><footer>Actual C layout · Example files and data · Browser font approximation · Console transparency still needs hardware testing.</footer>
<script>const examples=${JSON.stringify(examples)},views=${JSON.stringify(views).replaceAll('<','\\u003c')};const screen=document.querySelector('#screen'),focus=document.querySelector('#focus');function redraw(){document.querySelector('#drawing').innerHTML=views[+screen.value][+focus.value]}function selectScreen(){focus.replaceChildren(...examples[+screen.value].rows.map((r,i)=>new Option(r[0],i)));redraw()}screen.addEventListener('change',selectScreen);focus.addEventListener('change',redraw);selectScreen();</script>`;
await fs.writeFile(path.join(root,'.local/native-deck-preview.html'),html);
if(!process.argv.includes('--write-only')){
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);});
 server.listen(8797,'127.0.0.1',()=>console.log('Native layout preview at http://127.0.0.1:8797; no console connection.'));
 const close=()=>{server.closeAllConnections();server.close();};process.on('SIGINT',close);process.on('SIGTERM',close);
}
