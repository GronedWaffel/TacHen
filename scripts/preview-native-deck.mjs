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
const labels=[['Session watcher','Start this plugin process before opening a game.',true,false],
  ['Enable game autostart','Wait for PPSA00001 / 01.000.000. Disabling autostart does not unload code.',true,true],
  ['Load into game','Startup recovery is holding native operations. Review Activity before continuing.',false,false],
  ['FPS overlay','Show live FPS and resource use while this game runs.',true,true],
  ['Background installs','Two pending jobs. Open Activity to follow their progress.',true,false],
  ['Saved games','Export a decrypted archive to USB or the FTP share after closing this game.',true,false],
  ['Session history','Review changes made during this session and supported undo actions.',true,false],
  ['Back to payloads','Return to the payload inbox.',true,false]];
const frame={ready:true,sequence:1,page:1,title:'TacHen / Plugins',subtitle:'Dashboard  /  Firmware 13.60  /  Local preview',
  footer:'L1 / R1 sections    X select    Circle back    L3 + R3 close',ip:'192.168.1.10',ipVisible:true,
  metrics:'60 FPS  |  CPU 18%  |  RAM 782 MB',metricsSequence:1,
  notices:{sequence:1,current:{level:'attention',remainingMs:5000,count:1,title:'A job needs your attention',detail:'Open Activity to review the result before retrying.'}},
  rows:labels.map(([label,detail,enabled,on],i)=>({label,detail,enabled,on,token:String(i).repeat(32)}))};
await fs.mkdir(path.join(root,'.local'),{recursive:true});
const input=path.join(root,'.local/deck-preview-frame.bin');
const views=[];
for(const accent of ['mint','amber','ice']){
await fs.writeFile(input,encodeDeck({...frame,accent}));
for(let selected=0;selected<=labels.length;selected++){
  const args=[input,selected===labels.length?'0':'1',String(selected%labels.length)];
  const result=spawnSync(exe,args,{encoding:'utf8'}),panels=spawnSync(exe,[...args,'panels'],{encoding:'utf8'});
  if(result.status!==0||panels.status!==0)throw Error(result.stderr||panels.stderr||'Native layout preview failed');
  views.push({labels:JSON.parse(result.stdout),panels:JSON.parse(panels.stdout)});
}
}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const color=item=>`rgb(${item.color.slice(0,3).map(x=>Math.round(x*255)).join(' ')})`;
const svgs=views.map(view=>'<svg viewBox="0 0 1920 1080" role="img" aria-label="Native TacHen panel and text layout">'+
  view.panels.filter(item=>item.visible).map(item=>`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" fill="${color(item)}" fill-opacity="${item.color[3]}"/>`).join('')+
  view.labels.filter(item=>item.text).map(item=>`<text x="${item.x}" y="${item.y+item.size}" font-size="${item.size}" fill="${color(item)}">${escape(item.text)}</text>`).join('')+'</svg>');
const html=`<!doctype html><meta charset="utf-8"><title>TacHen native layout preview</title>
<style>body{margin:0;background:#070e15;color:#c2d1da;font:14px system-ui}header{padding:15px 24px;display:flex;align-items:center;gap:20px}b{color:#75ffd0}select{font:inherit;background:#13202b;color:white;border:1px solid #405263;padding:8px}#screen{background:#101d29}svg{width:100%;display:block;font-family:Arial,sans-serif}svg text{white-space:pre}footer{padding:14px 24px;color:#95a6b5}</style>
<header><b>Native layout · PC preview</b><label>Focus <select id="focus">${labels.map((row,i)=>`<option value="${i}">${escape(row[0])}</option>`).join('')}<option value="8">Deck closed</option></select></label><label>Accent <select id="accent"><option value="0">Mint</option><option value="1">Amber</option><option value="2">Ice</option></select></label></header>
<main id="screen">${svgs[0]}</main><footer>Production C panel and text layout with example data. Browser fonts approximate native text; console compositing and input still need hardware acceptance. No PS5 connection.</footer>
<script>const views=${JSON.stringify(svgs).replaceAll('<','\\u003c')};const redraw=()=>{document.querySelector('#screen').innerHTML=views[Number(document.querySelector('#accent').value)*9+Number(document.querySelector('#focus').value)]};for(const id of ['#focus','#accent'])document.querySelector(id).addEventListener('change',redraw);</script>`;
await fs.writeFile(path.join(root,'.local/native-deck-preview.html'),html);
if(!process.argv.includes('--write-only')){
  const server=http.createServer((req,res)=>{if(req.url!=='/'){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);});
  server.listen(8797,'127.0.0.1',()=>console.log('Native layout preview at http://127.0.0.1:8797; no console connection.'));
  const close=()=>{server.closeAllConnections();server.close();};process.on('SIGINT',close);process.on('SIGTERM',close);
}
