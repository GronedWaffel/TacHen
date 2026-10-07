// SPDX-License-Identifier: GPL-3.0-or-later
// Controller presentation only: all mutations still go through the shared API.
export function pluginDeckRows(state,view){
  const rows=[],row=(label,detail,command=null,args={},extra={})=>rows.push({label,detail,command,args,enabled:!!command,...extra});
  const plugins=state.plugins||[],upload=state.inbox.find(item=>item.id===view.upload);
  if(!Array.isArray(state.plugins)){
    row('Plugins unavailable','The plugin service is not installed in this runtime.');row('Back to payloads','','$plugin-exit');return rows;
  }
  if(view.kind==='detail'){
    const item=plugins.find(item=>item.sha256===view.sha256);
    if(!item)row('Plugin no longer registered','Return to the current plugin list.');
    else{
      const module=item.format!=='plugin',controls=item.controls;
      row(item.name,`${item.format.toUpperCase()} · ${item.target?item.target.titleId+' / '+item.target.version:'System / game watcher'}`);
      row(item.observation.phase,item.observation.message);
      row(controls.startLabel,controls.startReason||(module?'Load this module into the verified game instance.':'Start this plugin process, including before a game opens.'),
        controls.canStart?'job.enqueue':null,{kind:controls.jobKind,input:{sha256:item.sha256,source:'manual'}},{confirm:true});
      row(item.autostart?'Disable autostart':'Enable autostart',item.autostart?'Stop future automatic launches; loaded code stays resident.':
        item.scope==='system'?'May start as soon as native services are ready.':'Wait for '+item.target.titleId+' / '+item.target.version+'; may start now if it is ready.',
        'plugin.configure',{sha256:item.sha256,autostart:!item.autostart,revision:state.revision},{on:item.autostart,confirm:!item.autostart});
      row('Loaded code',controls.lifetime);
    }
    row('Back to plugins','','$plugins');
  }else if(view.kind==='register'){
    if(!upload||upload.status!=='verified'||plugins.some(item=>item.upload===upload.id))row('Upload no longer available','Refresh the inbox or choose a different unregistered file.');
    else{
      row(upload.name,'Register a target first. Registration does not load code.');
      if(/\.plugin$/i.test(upload.name))row('Register as system / game watcher','Can start before a game opens. Autostart initially off.',
        'plugin.register',{upload:upload.id,scope:'system',target:null,revision:state.revision},{confirm:true});
      const targets=new Map();
      for(const game of [state.game,...(state.loadouts?.profiles||[])])if(game?.titleId&&game?.version){
        const key=game.titleId+' / '+game.version;if(!targets.has(key))targets.set(key,{titleId:game.titleId,version:game.version});
      }
      for(const [name,target] of targets)row('Register for '+name,'Exact game target. Autostart initially off.',
        'plugin.register',{upload:upload.id,scope:'game',target,revision:state.revision},{confirm:true});
      if(!targets.size)row('Choose a game target','Open the target game, save a game loadout, or enter its exact title/version from your phone.');
    }
    row('Back to inbox','','$plugin-inbox');
  }else if(view.kind==='inbox'){
    const entries=state.inbox.filter(item=>item.status==='verified'&&/\.(plugin|prx|sprx)$/i.test(item.name)&&!plugins.some(plugin=>plugin.upload===item.id));
    for(const item of entries)row(item.name,'Choose how this plugin will be used.','$plugin-register',{upload:item.id});
    if(!entries.length)row('No unregistered plugins','Upload and verify a .plugin, .prx or .sprx from your phone or FTP inbox.');
    row('Back to plugins','','$plugins');
  }else{
    row('Add from inbox','Register a verified .plugin, .prx or .sprx.','$plugin-inbox');
    for(const item of plugins)row(item.name,`${item.observation.phase} · ${item.autostart?'Automatic':'Manual'} · ${item.target?item.target.titleId+' / '+item.target.version:'System / game watcher'}`,
      '$plugin-open',{sha256:item.sha256});
    if(!plugins.length)row('No plugins registered','Registration, manual loading and autostart are shared with your phone.');
    row('Back to payloads','','$plugin-exit');
  }
  return rows;
}
