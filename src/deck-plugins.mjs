// SPDX-License-Identifier: GPL-3.0-or-later
// Controller presentation only: all mutations still go through the shared API.
export function pluginDeckRows(state,view,games=[]){
  const rows=[],row=(label,detail,command=null,args={},extra={})=>rows.push({label,detail,command,args,enabled:!!command,...extra});
  const plugins=state.plugins||[],upload=state.inbox.find(item=>item.id===view.upload);
  if(!Array.isArray(state.plugins)){
    row('Plugins unavailable','The plugin service is not installed in this runtime.');row('Back to home','','$plugin-exit');return rows;
  }
  if(view.kind==='targets'){
    row('Choose the game for this plugin','The game can stay closed. Select its installed version.');
    row('Refresh games','Read installed games and connected game sources.','library.refresh');
    const seen=new Set();
    for(const game of [state.game,...games,...(state.loadouts?.profiles||[])])if(game?.titleId){
      const key=game.titleId+'/'+(game.version||'');if(seen.has(key))continue;seen.add(key);
      row(game.name||game.titleId,game.titleId+' / '+(game.version||'Version unavailable - enter it next'),
        '$plugin-target',{target:{titleId:game.titleId,version:game.version||''}});
    }
    if(!seen.size)row('No games found yet',state.library?.error?.message||'Refresh games, or enter the title ID and version manually below.');
    row('Enter game manually','Type the title ID and installed update version.','$plugin-target',{target:{titleId:'',version:''}});
    row('Back to registration','','$plugin-register',{upload:view.upload});
  }else if(view.kind==='detail'){
    const item=plugins.find(item=>item.sha256===view.sha256);
    if(!item)row('Plugin no longer registered','Return to the current plugin list.');
    else{
      const module=item.format!=='plugin',controls=item.controls;
      row(item.name,`${item.format.toUpperCase()} · ${item.target?item.target.titleId+' / '+item.target.version:'System / game watcher'}`);
      row(item.observation.phase,item.observation.message);
      row(controls.startLabel,controls.startReason||(module?'Load this module into the verified game instance.':'Start this plugin process, including before a game opens.'),
        controls.canStart?'job.enqueue':null,{kind:controls.jobKind,input:{sha256:item.sha256,source:'manual'}},{confirm:true});
      row('When to load',"It's recommended to not start plugins until you are in game.");
      row('Loaded code',controls.lifetime);

    }
    row('Back to plugins','','$plugins');
  }else if(view.kind==='register'){
    if(!upload||upload.status!=='verified'||plugins.some(item=>item.upload===upload.id))row('File no longer available','Choose Add from storage and select an unregistered plugin.');
    else{
      row(upload.name,'Choose its game below, then register the plugin. This does not run it.');
      if(/\.plugin$/i.test(upload.name))row('Register as system / game watcher','Can start before a game opens. Load manually once you are in game.',
        'plugin.register',{upload:upload.id,scope:'system',target:null,revision:state.revision},{confirm:true});
      const targets=new Map();
      for(const game of [state.game,...(state.loadouts?.profiles||[])])if(game?.titleId&&game?.version){
        const key=game.titleId+' / '+game.version;if(!targets.has(key))targets.set(key,{titleId:game.titleId,version:game.version});
      }
      for(const [name,target] of targets)row('Register for '+name,'Exact game target. Load manually once you are in game.',
        'plugin.register',{upload:upload.id,scope:'game',target,revision:state.revision},{confirm:true});
      row('Choose a game target','Select an installed game or enter its title ID and version. The game can stay closed.','$plugin-targets');
      if(view.target){
        const target=view.target,ps5=/^(PPSA|PPSB|MOUU)/.test(target.titleId);
        const valid=/^(PPSA|PPSB|MOUU|CUSA|PCAS|PCJS|PCKS|CUHJ|SCUS)\d{5}$/.test(target.titleId)&&
          (ps5?/^\d{2}\.\d{3}\.\d{3}$/:/^\d{2}\.\d{2}$/).test(target.version);
        row('Game title ID',target.titleId||'Enter the game title ID, such as PPSA00001.','$plugin-edit',{field:'titleId'});
        row('Game version',target.version||(ps5?'Enter the installed update version, such as 01.010.000.':'Enter the installed update version, such as 01.00.'),'$plugin-edit',{field:'version'});
        row('Register plugin',valid?target.titleId+' / '+target.version+' - autostart initially off.':'Enter a valid title ID and installed version above.',
          valid?'plugin.register':null,{upload:upload.id,scope:'game',target,revision:state.revision},{confirm:true});
      }
    }
    row('Back to plugins','','$plugins');
  }else if(view.kind==='inbox'){
    const entries=state.inbox.filter(item=>item.status==='verified'&&/\.(plugin|prx|sprx)$/i.test(item.name)&&!plugins.some(plugin=>plugin.upload===item.id));
    for(const item of entries)row(item.name,'Choose how this plugin will be used.','$plugin-register',{upload:item.id});
    if(!entries.length)row('No unregistered plugins','Upload and verify a .plugin, .prx or .sprx into the FTP inbox, or choose Add from storage.');
    row('Back to plugins','','$plugins');
  }else{
    row('Add from storage','Choose a .plugin, .prx or .sprx from USB or console storage.','$browse',{kind:'plugin'});
    for(const item of state.inbox.filter(item=>item.status==='verified'&&/\.(plugin|prx|sprx)$/i.test(item.name)&&!plugins.some(plugin=>plugin.upload===item.id)))
      row('Finish adding: '+item.name,'File copied. Choose its target to finish registration.','$plugin-register',{upload:item.id});
    for(const item of plugins)row(item.name,`${item.observation.phase} · Manual · ${item.target?item.target.titleId+' / '+item.target.version:'System / game watcher'}`,
      '$plugin-open',{sha256:item.sha256});
    if(!plugins.length)row('No plugins registered','Choose Add from storage to get started.');
    row('Back to home','','$plugin-exit');
  }
  return rows;
}
