import test from 'node:test';
import assert from 'node:assert/strict';
import {ConsoleDeck,encodeDeck} from '../src/deck.mjs';
import {TacRuntime} from '../src/runtime.mjs';
import {store,ids} from './helpers.mjs';
async function setup(t){
 const r=await new TacRuntime(await store(),{install(){},identity:async()=>({mode:'development'})},{id:ids()}).start();t.after(()=>r.close());
 const file={name:'sample.elf',source:'/data/sample.elf',directory:false,dev:'1',ino:'2',bytes:1024,modified:1};
 const roots={source:null,parent:null,entries:[{name:'Console',source:'/data',directory:true},{name:'USB',source:'/mnt/usb0',directory:true}]};
 r.fileManager={browse:async({source}={})=>!source?roots:{source,parent:null,entries:source==='/data'?[file]:[]}};
 const d=new ConsoleDeck(r);d.page=3;
 const select=async n=>{const f=d.frame();return d.action({kind:'select',row:n,sequence:f.sequence,request:r.id()});};await select(0);
 return {r,d,select,file};
}
test('native file browser has independent panes, complete paths and eight toolbar actions',async t=>{
 const {d}=await setup(t),f=d.frame(),b=encodeDeck(f);
 assert.deepEqual(f.browser.panes.map(p=>p.path),['/data','/mnt/usb0']);assert.equal(f.browser.panes[0].entries.length,12);
 assert.deepEqual(f.rows.map(x=>x.label),['Copy','Move','Rename','Delete','New folder','Refresh','Transfers','Close']);
 assert.equal(b.length,11760);assert.equal(b.readUInt16LE(4),8);assert.equal(b.readUInt16LE(6)&256,256);assert.match(b.toString('utf8',6428,6588),/^\/data\0/);
});
test('copy captures source identity and opposite pane destination, and Cancel preserves selection',async t=>{
 const {r,d,select,file}=await setup(t);await select(1);await select(24);
 assert.equal(d.confirmation.args.kind,'file.transfer');assert.equal(d.confirmation.args.input.source,file.source);assert.equal(d.confirmation.args.input.destination,'/mnt/usb0');
 await d.action({kind:'back',sequence:d.frame().sequence,request:r.id()});assert.equal(d.managerView.selected.source,file.source);assert(d.frame().browser);
});
test('right-pane toolbar carries its destination into the filename keyboard and confirmation',async t=>{
 const {d,select}=await setup(t);await select(32+28);assert.equal(d.textInput.target,'/mnt/usb0');
 d.textInput.value='Backups';await select(39);assert.equal(d.confirmation.args.kind,'file.mkdir');assert.equal(d.confirmation.args.input.destination,'/mnt/usb0');assert.equal(d.confirmation.args.input.name,'Backups');
});
test('rename allows ordinary file extensions; delete requires explicit confirmation',async t=>{
 const {d,select}=await setup(t);await select(1);await select(26);d.textInput.value='renamed.bin';await select(39);
 assert.equal(d.confirmation.args.input.destinationName,'renamed.bin');assert.equal(d.confirmation.args.input.destination,'/data');
 await select(1);await select(27);assert.equal(d.confirmation.args.kind,'file.delete');assert.equal(d.confirmation.args.input.source,'/data/sample.elf');
});
test('operations remain in the browser, and interrupted transfers remain reachable',async t=>{
 const {r,d,select}=await setup(t);await select(1);await select(24);const execute=r.execute.bind(r);r.execute=async(cmd,args)=>cmd==='job.enqueue'?{id:'job'}:execute(cmd,args);
 await select(0);assert(d.frame().browser);assert.equal(d.managerView.job,'job');await select(30);assert.equal(d.transferView.section,'active');assert(d.suspendedManager);
});

test('X selects a folder for recursive copying; X again opens it and roots remain directly navigable',async t=>{
 const {r,d,select}=await setup(t),folder={name:'Backup',source:'/data/Backup',directory:true,dev:'1',ino:'9',bytes:0,modified:1};
 d.managerView.panes[0].listing.entries=[folder];
 await select(1);assert.equal(d.managerView.selected.source,folder.source);assert.equal(d.managerView.panes[0].listing.source,'/data');
 assert(d.frame().rows[0].enabled);assert(!d.frame().rows[1].enabled);assert.match(d.frame().browser.selection,/X again/);
 await select(24);assert.equal(d.confirmation.args.input.directory,true);assert.equal(d.confirmation.args.input.destination,'/mnt/usb0');
 await d.action({kind:'back',sequence:d.frame().sequence,request:r.id()});
 await select(1);assert.equal(d.managerView.panes[0].listing.source,folder.source);
 await select(0);assert.equal(d.managerView.panes[0].listing.source,null);
 await select(1);assert.equal(d.managerView.panes[0].listing.source,'/data');
});
