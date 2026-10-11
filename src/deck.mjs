// SPDX-License-Identifier: GPL-3.0-or-later
// Controller presentation uses the same commands, validation and durable jobs as
// the phone. No privileged operation is implemented inside the renderer.
import { invariant } from './errors.mjs';
import { telemetryText } from './telemetry.mjs';
import { pluginDeckRows } from './deck-plugins.mjs';
import { packageDeckRows } from './deck-packages.mjs';
import { transferRows } from './deck-transfers.mjs';
import { KEYBOARDS, editDownload, suggestedName, downloadRows } from './deck-download.mjs';
import { startupPayloadRows } from './deck-startup.mjs';
import { payloadDownloadsRows } from './deck-downloads.mjs';
import { continuePayloadLoad } from './deck-payload-load.mjs';
import { fileManagerFrame,openFileManager,refreshFileManager } from './deck-file-browser.mjs';
import { Dashboard } from './dashboard.mjs';

export const DECK_WIRE = Object.freeze({ magic: 0x54414344, version: 8, bytes: 11760, rows: 8, rowBytes: 292 });
const pages = ['Home', 'Payloads', 'Games', 'Transfers', 'Settings', 'Cheats'];
function text(buffer, offset, bytes, value) {
  const input = Buffer.from(String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' '));
  let length = Math.min(input.length, bytes - 1);
  // Do not split a UTF-8 code point at a fixed-width wire boundary.
  while (length < input.length && length && (input[length] & 0xc0) === 0x80) length--;
  input.copy(buffer, offset, 0, length);
}
export function encodeDeck(frame) {
  invariant(frame.rows.length <= 8, 'DECK_LIMIT', 'Too many deck rows.');
  const accent = ['mint', 'amber', 'ice'].indexOf(frame.accent ?? 'mint');
  invariant(accent >= 0, 'DECK_ACCENT', 'Unknown deck accent.');
  const out = Buffer.alloc(DECK_WIRE.bytes);
  out.writeUInt32LE(DECK_WIRE.magic, 0); out.writeUInt16LE(DECK_WIRE.version, 4);
  out.writeUInt16LE((frame.ready ? 1 : 0) | (frame.ipVisible ? 2 : 0) | (frame.canBack ? 4 : 0) | (accent << 3) | (frame.grid ? 32 : 0) | (frame.reducedMotion ? 64 : 0) | (frame.keyboard ? 128 : 0) | (frame.browser ? 256 : 0), 6);
  out.writeUInt32LE(frame.sequence, 8); out.writeUInt16LE(frame.page, 12); out.writeUInt16LE(frame.rows.length, 14);
  text(out, 16, 64, frame.title); text(out, 80, 160, frame.subtitle);
  text(out, 240, 160, frame.footer); text(out, 400, 64, frame.ip);
  frame.rows.forEach((row, index) => {
    const at = 464 + index * DECK_WIRE.rowBytes;
    // token is a full 32-byte hex identifier, not a C string.
    Buffer.from(row.token).copy(out, at, 0, 32);
    text(out, at + 32, 96, row.label); text(out, at + 128, 160, row.detail);
    out.writeUInt32LE((row.enabled ? 1 : 0) | (row.on ? 2 : 0), at + 288);
  });
  out.writeUInt32LE(frame.metricsSequence || 1, 2800);text(out, 2804, 192, frame.metrics);
  const input = frame.input;
  if (input) {
    invariant(input.events.length <= 128, 'DECK_INPUT_LIMIT', 'Too many controller events.');
    for (const [offset, value] of [[3000, input.epoch], [3004, input.serial], [3008, input.active], [3012, input.captured ? 1 : 0], [3020, input.connection], [3024, input.events.length]]) out.writeUInt32LE(value, offset);
    out.writeInt32LE(input.owner, 3016);out.writeBigUInt64LE(BigInt(Math.floor(input.deadline)), 3032);
    out.writeBigUInt64LE(BigInt(Math.ceil(input.captureAt || 0)), 3040);
    input.events.forEach((e, i) => { const at = 3048 + i * 24;out.writeUInt32LE(e.buttons, at);out.writeInt32LE(e.handle, at + 4);
      out.writeUInt32LE(e.connection, at + 8);out.writeUInt32LE(e.sequence, at + 12);out.writeBigUInt64LE(BigInt(Math.floor(e.time)), at + 16); });
  }
  const notice = frame.notices?.current;
  out.writeUInt32LE(frame.notices?.sequence || 1, 6120);
  if (notice && notice.remainingMs > 0) {
    out.writeUInt32LE(Math.min(9000, Math.ceil(notice.remainingMs)), 6124);
    out.writeUInt32LE(notice.level === 'attention' ? 2 : 1, 6128);out.writeUInt32LE(notice.count, 6132);
    text(out, 6136, 96, notice.title + (notice.count > 1 ? ` (${notice.count})` : ''));
    text(out, 6232, 192, notice.detail);
  }
  if(frame.browser){
    invariant(frame.browser.panes.length===2&&frame.browser.panes.every(p=>p.entries.length===12),'DECK_BROWSER','Invalid browser panes.');
    out.writeUInt32LE(frame.browser.active,6424);
    frame.browser.panes.forEach((p,i)=>{text(out,6428+i*160,160,p.path);p.entries.forEach((r,j)=>{const at=6908+(i*12+j)*164;text(out,at,96,r.label);text(out,at+96,64,r.detail);out.writeUInt32LE((r.enabled?1:0)|(r.on?2:0)|(r.directory?4:0),at+160);});});
    text(out,6748,160,frame.browser.status);
  }
  const dashboard=frame.dashboard;
  if(dashboard){out.writeUInt32LE(dashboard.enabled?1:0,10848);out.writeUInt32LE(dashboard.epoch,10852);out.writeUInt32LE(dashboard.ack,10856);
    invariant(dashboard.items.length<=32,'DASHBOARD_LIMIT','Too many dashboard records.');out.writeUInt32LE(dashboard.items.length,10860);
    dashboard.items.forEach((g,i)=>{text(out,10864+i*28,10,g.titleId);text(out,10874+i*28,16,g.version);});}
  return out;
}

export class ConsoleDeck {
  constructor(runtime, { schedule = setInterval, cancel = clearInterval } = {}) {
    this.runtime = runtime; this.page = 0; this.offset = 0; this.sequence = 0;
    this.signature = ''; this.current = null; this.requests = new Map(); this.tail = Promise.resolve();
    this.notice = ''; this.confirmation = null;
    this.metrics = ''; this.metricsSequence = 1;
    this.schedule=schedule;this.cancel=cancel;this.libraryTimer=null;this.visible=true;
    this.dashboard=new Dashboard(runtime);
  }
  openGameCheats(titleId){
    this.page=5;this.offset=0;this.confirmation=null;this.cheatPack=null;this.cheatTitle=titleId;
    for(const key of ['managerView','payloadDownloads','textInput','downloadView','startupPayloadView','fileView','importJob','pluginView','packageView','loadoutPreview','saveView','historyView','startupReview','gameView'])this[key]=null;
    this.notice='Cheats for '+titleId;this.refreshCheats();
  }
  async openCheats(){
    this.page=5;this.offset=0;this.cheatPack=null;this.cheatTitle=null;this.notice='';
    const state=this.runtime.snapshot(),game=state.game;
    // Select a library entry only; never enable a cheat just by opening the tab.
    const entry=game?.titleId&&game?.version&&state.cheats?.find(pack=>
      pack.titleId===game.titleId&&pack.version===game.version&&pack.count>0);
    if(entry){
      try{
        const pack=await this.runtime.execute('cheat.inspect',{sha256:entry.sha256});
        const current=this.runtime.snapshot().game;
        if(current&&['titleId','version','pid','generation'].every(key=>current[key]===game[key])&&
          pack.titleId===game.titleId&&pack.version===game.version&&pack.cheats?.length)this.cheatPack=pack;
      }catch{ /* A missing or unreadable pack leaves the normal library available. */ }
    }
    this.refreshCheats();
  }
  setVisible(visible){this.visible=visible;this.updateLibraryLoop();}
  stop(){if(this.libraryTimer!==null)this.cancel(this.libraryTimer);this.libraryTimer=null;}
  updateLibraryLoop(){
    if(this.page!==2||!this.visible||!this.runtime.library){this.stop();return;}
    if(this.libraryTimer===null){
      this.libraryTimer=this.schedule(()=>{
        if(this.page!==2||!this.visible){this.stop();return;}
        this.refreshLibrary(true);
      },3000);
      this.libraryTimer?.unref?.();
    }
  }
  frame() {
    const runtime = this.runtime, state = runtime.snapshot({internal:true});
    this.updateLibraryLoop();
    const syncingCheats=state.jobs.some(j=>j.kind==='cheat.sync'&&!['completed','failed','cancelled'].includes(j.status));
    // Import commits files individually. Keep the native list stable while the
    // download runs, then publish the finished catalog once, not once per file.
    if(!this.nativeCheatCatalog||!syncingCheats)this.nativeCheatCatalog=state.cheats||[];
    const cheatCatalog=this.nativeSettings?this.nativeCheatCatalog:(state.cheats||[]);
    const items = [], row = (label, detail, command = null, args = {}, extra = {}) =>
      items.push({ label, detail, enabled: Boolean(command), command, args, ...extra });
    if(this.managerView?.job&&!this.managerRefreshing){const v=this.managerView,j=state.jobs.find(x=>x.id===v.job);
      if(j&&['completed','failed','cancelled'].includes(j.status)&&v.refreshed!==j.id){v.refreshed=j.id;this.managerRefreshing=true;
        refreshFileManager(runtime,v).catch(e=>{v.message=e.message;}).finally(()=>{this.managerRefreshing=false;});}}
    const feature = name => state.capabilities.find(x => x.id === name)?.available;
    if(this.textInput){
      row(KEYBOARDS[this.textInput.page],this.textInput.value.slice(-145) || ' ', '$keyboard');
    } else if (this.confirmation) {
      row('Confirm: ' + this.confirmation.label, this.confirmation.detail, '$confirm');
      row('Cancel', 'Return without making changes', '$cancel');
    } else if(this.managerView){
      items.push(...fileManagerFrame(this.managerView,state.jobs).rows);
    } else if(this.payloadDownloads){
      items.push(...payloadDownloadsRows(state,this.payloadDownloads,runtime.componentsByHash));
    } else if(this.downloadView){
      items.push(...downloadRows(state,this.downloadView,runtime.componentsByHash));
    } else if (this.startupPayloadView) {
      items.push(...startupPayloadRows(state, this.startupPayloadView, runtime.componentHashes));
    } else if (this.importJob) {
      const job = state.jobs.find(j => j.id === this.importJob.id);
      row(job?.status === 'completed' ? 'File ready' : job?.status === 'failed' ? 'Could not prepare file' : 'Preparing file',
        job?.error?.message || job?.result?.message || job?.progress?.phase || (this.importJob.kind==='package'?'Checking the selected package without copying it.':'Waiting to copy and check the selected file.'));
      if (job?.status === 'completed') row(this.importJob.kind === 'package' ? 'Continue to installation' : this.importJob.kind === 'plugin' ? 'Set up plugin' : this.importJob.kind === 'cheat' ? 'Open cheats' : 'Open payloads',
        'The original file has not been changed.', '$import-open', { kind: this.importJob.kind, id: job.result.id });
      if (job && ['queued','running','held'].includes(job.status)) row(this.importJob.kind==='package'?'Cancel check':'Cancel copy', 'Keep the original file.', 'job.cancel', { id: job.id });
      row('Back to files', 'You can leave this screen while preparation runs.', '$import-back');
    } else if (this.fileView) {
      const view = this.fileView;
      if(view.kind!=='payload')row('Refresh', 'Check connected drives and files again.', '$browse', { kind: view.kind, source: view.source });
      if(view.usbMissing)row('No USB drive connected','Connect a USB drive, then choose Refresh. Console storage is still available.');
      for (const item of view.entries) row((item.directory ? '[Folder] ' : '') + item.name,
        item.directory ? 'Open folder' : Math.ceil(item.bytes / 1048576) + ' MiB · ' + (view.kind==='cheat'?'Import this cheat file':view.kind==='package'?'Press X to install directly. Keep USB connected.':view.kind==='payload'?'Press X to check and load this payload.':'Copy and check before use'),
        item.directory ? '$browse' : 'job.enqueue', item.directory ? { kind: view.kind, source: item.source } :
          { kind: view.kind==='package'?'package.receive':'file.import', input: { kind: view.kind, source: item.source, bytes: item.bytes, modified: item.modified } },
        item.directory ? {} : view.kind==='package'?{packageWorkflow:true}:view.kind==='payload'?{payloadWorkflow:true}:{ confirm: true, fileImport: view.kind });
      if(view.kind==='payload')row('Refresh', 'Check connected drives and files again.', '$browse', { kind: view.kind, source: view.source });
      if (!view.entries.length) row('No matching files here', 'Connect a USB drive or open a folder containing the selected file type.');
      row(view.source ? 'Up one folder' : 'Back', '', view.source ? '$browse' : '$files-exit', { kind: view.kind, source: view.parent });
    } else if (this.pluginView) {
      items.push(...pluginDeckRows(state,this.pluginView,runtime.libraryState?.games||[]));
    } else if (this.packageView) {
      items.push(...packageDeckRows(state, this.packageView, state.jobs));
    } else if (this.startupReview) {
      const plan = this.startupReview;
      for (const service of plan.services) row(service.id, service.status === 'adopt' ? 'Reuse after readiness check' : service.status === 'start' ? 'Start after dependencies' : service.reason);
      for (const blocker of plan.blockers) row('Needs attention', blocker);
      row('Continue reviewed startup', plan.message, plan.available && !state.recovery?.running ? 'startup.resume' : null, { proof: plan.proof }, { confirm: true });
      row('Review again', 'Refresh existing service evidence', '$startup-review');
      row('Back', 'Return to the command deck', '$startup-back');
    } else if (this.historyView) {
      if (this.historyView.id && !state.history.some(entry => entry.id === this.historyView.id)) {
        row('Change no longer available', 'The session history has advanced. Return to the list.');
        row('Back to history', '', '$history-back');
      } else if (this.historyView.id) {
        const plan = runtime.changes.preview({ id: this.historyView.id });
        row(plan.message, plan.available ? plan.detail : plan.reason);
        for (const change of plan.changes) row(change, '');
        row(plan.label, plan.detail, plan.available ? 'history.undo' : null, { id: plan.id, proof: plan.proof }, { confirm: true });
        row('Back to history', '', '$history-back');
      } else {
        for (const entry of [...state.history].reverse()) row(entry.message, entry.undo.available ? 'Review undo' : entry.undo.reason,
          entry.undo.proof ? '$history-open' : null, { id: entry.id });
        if (!state.history.length) row('No session changes', 'Changes and operation results will appear here');
      }
    } else if (this.loadoutPreview) {
      const plan = this.loadoutPreview;
      row(plan.profile.name, `${plan.profile.titleId} · ${plan.profile.version}`);
      row('Apply loadout', plan.canApply ? 'Run checked steps in order; completed steps remain if a later one fails.' : 'Resolve the listed issues first',
        plan.canApply && !state.safe ? 'job.enqueue' : null, { kind: 'loadout.apply', input: plan.accepted }, { confirm: true });
      for (const step of plan.steps) row(step.label, step.existing ? 'Reuse recorded operation' : 'Start after earlier steps succeed');
      for (const [key, enabled] of Object.entries(plan.profile.overlay)) row(key.toUpperCase() + ' overlay', enabled ? 'On for this game session' : 'Off for this game session');
      for (const issue of plan.issues) row(issue.label, issue.message);
      row('Back to games', 'Return without starting anything', '$loadout-back');
    } else if (this.saveView) {
      const list = runtime.saves.list({ offset: this.saveView.offset, limit: 3 });
      if (this.saveView.job) {
        const job=state.jobs.find(j=>j.id===this.saveView.job);
        const checking=state.saves?.recovering?.includes(job?.id);
        const labels={completed:'Backup saved',failed:'Backup failed',cancelled:'Backup cancelled',held:'Backup paused',interrupted:'Backup needs checking',uncertain:'Backup needs checking',queued:'Backup waiting',cancelling:'Cancelling backup',running:'Backing up save'};
        row(checking?'Checking backup result':labels[job?.status]||'Backup no longer listed',
          job?.error?.message || job?.result?.message || job?.progress?.phase || 'Preparing a copy of the save.');
        if(job?.error?.action)row('What to do next',job.error.action);
        if(job?.status==='interrupted'&&!checking)row('Check backup result','Check the existing backup without starting another export.','job.reconcile',{id:job.id});
        if(job?.status==='held')row('Resume backup','Continue this paused backup.','job.resume',{id:job.id},{confirm:true});
        if(job?.result?.output)row('Saved file',job.result.output);
        if(job?.result?.ftpPath)row('Copy it to your computer',`FTP ${state.identity.ip}:2122 → ${job.result.ftpPath}`);
        row('Back to saved games','','$save-list');
      } else if (this.saveView.usb) {
        row('USB backup','Connect a USB drive to the PS5, then refresh.');
        row('Refresh USB drives','Read connected drives again.','job.enqueue',{kind:'save.refresh',input:{}});
        for(const volume of list.volumes)row('Back up to USB '+volume.destination,
          `${volume.path}/TacHen/Saves · ${Math.floor(volume.freeBytes/1048576)} MiB free`,
          feature('saves')&&!state.safe&&state.game?.titleId!==this.saveView.selected?.titleId?'job.enqueue':null,
          {kind:'save.export',input:{...this.saveView.selected,destination:volume.destination,volume:volume.stamp}},{confirm:true});
        if(!list.volumes.length)row('No USB drive detected','Plug in a writable USB drive and choose Refresh USB drives.');
        row('Back to backup options','','$save-destinations');
      } else if (this.saveView.selected) {
        const item = this.saveView.selected;
        row(runtime.libraryState?.games.find(g=>g.titleId===item.titleId)?.name || item.titleId, `${item.slot} · User ${item.user}`);
        const blocked=!feature('saves')?'Save backup service is unavailable.':state.safe?'Finish service recovery before backing up saves.':state.game?.titleId===item.titleId?'Close this game before backing up its save.':'';
        if(blocked)row('Before backing up',blocked);
        row('Back up to console',blocked||'Save a decrypted copy under /data/tachen/share/saves. The exact file path appears when finished.',
          feature('saves') && !state.safe && state.game?.titleId !== item.titleId ? 'job.enqueue' : null,
          {kind:'save.export',input:{...item,destination:0,volume:''}},{confirm:true});
        row('Back up to USB','Choose a USB drive connected to this PS5.','$save-usb');
        row('Back to saves', 'Choose another save', '$save-back');
      } else {
        const scan=state.jobs.filter(j=>j.kind==='save.refresh').at(-1);
        if(scan && scan.status!=='completed')row(['failed','interrupted','uncertain'].includes(scan.status)?'Save scan needs attention':scan.status==='cancelled'?'Save scan cancelled':scan.status==='held'?'Save scan paused':'Finding saved games',scan.error?.message || scan.result?.message || scan.progress?.phase || 'Please wait while console saves are scanned.');
        if(list.updatedAt&&!list.total)row('No saved games found', 'Play and save a game on this console, then refresh.');
        row('Refresh saves', list.updatedAt ? `${list.total} saves · ${list.skipped} skipped entries` : 'Read saved games and connected USB drives',
          feature('saves') && !state.safe && (!scan || ['completed','failed','cancelled'].includes(scan.status)) ? 'job.enqueue' : null, { kind: 'save.refresh', input: {} });
        for (const item of list.entries) row(runtime.libraryState?.games.find(g=>g.titleId===item.titleId)?.name||item.titleId, `${item.titleId} · ${item.slot} · User ${item.user}`, '$save-open', item);
        if (list.offset) row('Previous saves', '', '$save-page', { offset: Math.max(0, list.offset - 3) });
        if (list.offset + 3 < list.total) row('More saves', '', '$save-page', { offset: list.offset + 3 });
      }
    } else if (this.page === 0) {
      row('Packages', 'Install PKG files from USB or console storage.', '$packages');
      row('Payloads', 'Browse and run ELF payloads.', '$page', { page: 1 });
      row('Plugins', 'Add plugins and manage automatic loading.', '$plugins');
      row('Games', 'Play installed games and mount game sources.', '$page', { page: 2 });
      row('Saved games', 'Back up saves to console storage or USB.', '$saves');
      row('Cheats', 'Choose cheats for your game and version.', '$page', { page: 5 });
      row('Transfers', 'See installation progress and completed jobs.', '$page', { page: 3 });
      row('Settings', 'FPS, display options and services.', '$page', { page: 4 });
    } else if (this.page === 1) {
      row('Download from link','Enter a direct download link.','$download');
      row('Downloads','Load, manage startup or delete downloaded payloads.','$payload-downloads');
      row('Load from storage','Choose an ELF and press X to load it.','$payload-storage');
      row('Startup payloads','Choose the order and timing of automatic payloads.','$startup-payloads');
    } else if (this.page === 2) {
      const profile = state.loadouts?.profiles.find(p => p.titleId === state.game?.titleId && p.version === state.game?.version);
      if (profile) {
        row('Loadout: ' + profile.name, 'Review plugins, cheats and overlay choices', '$loadout-open', { titleId: profile.titleId, version: profile.version });
        if(!profile.plugins.length)row('Automatic loadout', profile.autostart ? 'On' : 'Off', 'loadout.save',
          { profile: { ...profile, autostart: !profile.autostart }, revision: state.revision }, { on: profile.autostart });
        else row('Manual loadout', "It's recommended to not start plugins until you are in game.");
      }
      if (state.loadouts?.active) row('Use default overlay', 'Release this session’s loadout overlay; native steps remain', 'loadout.overlay.release');
      const mountService=state.services.find(s=>s.id==='shadowmount');
      if(mountService&&mountService.status==='stopped')row('Start ShadowMount','Enable the game library.', 'service.start', {id:'shadowmount'});
      if(mountService&&['failed','uncertain','blocked'].includes(mountService.status))row('Check ShadowMount',mountService.error?.message || 'Check the running service before retrying.', 'service.reconcile', {id:'shadowmount'});
      row('Refresh library', runtime.libraryState?.error?.message || 'Read installed games and connected game sources', runtime.library ? 'library.refresh' : null);
      if(this.gameView){
        const game=runtime.libraryState?.games.find(g=>g.titleId===this.gameView.titleId);
        if(!game)row('Game no longer listed','Refresh the library.');
        else {
          row(game.name,game.titleId+' · '+game.platform);
          row(game.canMount&&!game.mounted?'Mount and play':'Play game','Start this game on the console.',
            runtime.jobs.handlers.has('library.launch')&&!state.safe?'job.enqueue':null,{kind:'library.launch',input:{titleId:game.titleId}},{confirm:true});
          if(game.canMount)row(game.mounted?'Unmount game':'Mount game',game.mounted?'Release the mount after closing the game.':'Make this game source available to the console.',
            game.sourceAvailable&&!state.safe?'job.enqueue':null,{kind:'library.mount',input:{titleId:game.titleId,path:game.path,contentId:game.contentId,mounted:!game.mounted}},{confirm:true});
          const job=state.jobs.filter(j=>['library.launch','library.mount'].includes(j.kind)&&j.args.titleId===game.titleId).at(-1);
          if(job?.status==='interrupted')row('Check last result','Check the previous operation before trying again.','job.reconcile',{id:job.id});
          if(job)row(job.status==='completed'?'Ready':job.status==='failed'?'Game needs attention':'Game progress',job.error?.message||job.result?.message||job.progress?.phase||job.status);
        }
        row('Back to games','','$game-back');
      }else for (const game of runtime.libraryState?.games || []) {
        row(game.name,`${game.titleId} · ${game.platform} · ${game.canMount?(game.mounted?'Mounted':'Needs mounting'):'Installed'}`,'$game-open',{titleId:game.titleId});
      }
    } else if (this.page === 3) {
      items.push(...transferRows(state, this.transferView, state.jobs, runtime.jobs.handlers));
    } else if (this.page === 4) {
      row('Dashboard title ID + version',state.settings.appearance.gameCardDetails?'On · show game ID and installed update beside dashboard titles':'Off · show game ID and installed update beside dashboard titles','settings.update',
        {revision:state.revision,patch:{appearance:{gameCardDetails:!state.settings.appearance.gameCardDetails}}},{on:state.settings.appearance.gameCardDetails});
      for (const [key, label, capability] of [['ip', 'IP address on screen', 'ip-overlay'], ['fps', 'Game FPS', 'fps'],
        ['ram', 'Memory usage', 'resources'], ['cpu', 'CPU usage', 'resources']])
        row(label, feature(capability) ? (state.settings.overlay[key] ? 'On' : 'Off') : 'Renderer is not ready',
          feature(capability) ? 'settings.update' : null,
          { revision: state.revision, patch: { overlay: { [key]: !state.settings.overlay[key] } } }, { on: state.settings.overlay[key] });
      row('Reduced motion', state.settings.appearance.reducedMotion ? 'On' : 'Off', 'settings.update',
        { revision: state.revision, patch: { appearance: { reducedMotion: !state.settings.appearance.reducedMotion } } }, { on: state.settings.appearance.reducedMotion });
      const accents = ['mint', 'amber', 'ice'], accent = state.settings.appearance.accent;
      row('Accent: ' + accent, 'Change the web interface accent', 'settings.update',
        { revision: state.revision, patch: { appearance: { accent: accents[(accents.indexOf(accent) + 1) % accents.length] } } });

      if(state.updates){const updates=state.updates,selection=updates.state,available=updates.available&&!selection?.recovered;
        row('TacHen updates',updates.error?.message||'Check prepared updates and the previous working build.','update.refresh');
        if(selection?.candidate)row(selection.candidate.label,'Staged build · '+selection.candidate.sha256.slice(0,12));
        if(selection?.phase==='staged')row('Use staged build next boot',selection.good?'Requires tachen.elf launcher; running build stays in place':'First complete one launcher startup to establish a verified fallback',available&&selection.good?'update.arm':null,{revision:selection.revision},{confirm:true});
        if(selection?.phase==='trial'?selection.good:selection?.previous)row('Use previous build next boot','Retain current session; switch on another boot',available?'update.revert':null,{revision:selection.revision},{confirm:true});
        if(['staged','armed'].includes(selection?.phase))row('Cancel pending selection','Retain uploaded files and the running build',available?'update.discard':null,{revision:selection.revision},{confirm:true});
        for(const build of updates.retained||[])if(build.removable)row('Remove unused: '+build.label,'Free '+Math.ceil(build.bytes/1048576)+' MiB; original upload retained',available?'update.retire':null,{sha256:build.sha256,revision:selection.revision},{confirm:true});
      }
      if(state.recovery && (state.safe || state.recovery.running))row('Recover services','Review startup before continuing.', '$startup-review');
      for(const service of state.services.filter(s=>['ftp','payload-manager'].includes(s.id)))row(service.id==='ftp'?'FTP server':'Payload Manager', service.status==='ready'?'Running':service.error?.message||'Start this service', service.status==='stopped'?'service.start':null,{id:service.id});
      row('Session history','Review service changes and available undo actions.','$history');
      row('Adaptive notices', state.settings.overlay.adaptive ? 'Brief session updates are on' : 'Off; results remain in Activity', 'settings.update',
        { revision: state.revision, patch: { overlay: { adaptive: !state.settings.overlay.adaptive } } }, { on: state.settings.overlay.adaptive });
    } else if (this.cheatPack) {
      const pack = this.cheatPack, matches = state.game?.titleId === pack.titleId && state.game?.version === pack.version;
      row(pack.name, `${pack.titleId} · ${pack.version}`);
      for (const cheat of pack.cheats) {
        const job = state.jobs.filter(j => j.kind === 'cheat.set' && j.args.sha256 === pack.sha256 && j.args.cheatId === cheat.id && j.args.generation === state.game?.generation).at(-1);
        const active = job && !['completed', 'failed', 'cancelled'].includes(job.status);
        const on = job?.status === 'completed' && job.result?.phase === 'applied' && job.args.enabled;
        row(cheat.name, active ? job.error?.message || job.status : !matches ? 'Open the exact target game and version' : !cheat.supported ? 'Advanced section addressing is not supported' : on ? (cheat.exactUndo === false ? 'On. Select to apply the file’s Off bytes; extra On bytes may remain until the game closes.' : 'Last applied: On. Select to restore original bytes.') : 'Select to enable; expected bytes are checked first.',
          matches && !active && cheat.supported && feature('cheats') && !state.safe ? 'job.enqueue' : null,
          { kind: 'cheat.set', input: { sha256: pack.sha256, cheatId: cheat.id, enabled: !on } }, { on: Boolean(on) });
      }
      row('Other cheat packs', 'Return to the cheat library', '$cheat-back');
    } else {
      if(runtime.jobs.handlers.has('cheat.sync'))row('Download latest cheats','Fetch cheats for installed games from etaHEN and GoldHEN. Files are matched to their exact game version.','job.enqueue',{kind:'cheat.sync',input:{}});
      const sync=state.jobs.filter(j=>j.kind==='cheat.sync').at(-1);
      if(sync)row(sync.status==='completed'?'Cheats updated':sync.status==='failed'?'Cheat download failed':'Updating cheats',this.nativeSettings&&syncingCheats?'Downloading in the background. Your current list stays available.':sync.error?.message||sync.result?.message||sync.progress?.phase||sync.status);
      row('Import cheat file', 'Choose JSON, SHN/XML or MC4 from USB or console storage. No game needs to be running.', '$browse', {kind:'cheat'});
      for (const pack of cheatCatalog.filter(p=>!this.cheatTitle||p.titleId===this.cheatTitle)) row(pack.name, `${pack.titleId} · ${pack.version} · ${pack.count} cheats`, '$cheat-open', { sha256: pack.sha256 });
      if(this.cheatTitle){if(!cheatCatalog.some(p=>p.titleId===this.cheatTitle))row('No cheats found for '+this.cheatTitle,'Download the latest cheats or import a matching file.');row('Show all games','Browse the complete cheat library.','$cheat-all');}
      if (!items.length) row('No cheat files imported', 'Choose Import cheat file to add cheats.');
    }
    const grid=this.page===0&&!this.managerView&&!this.payloadDownloads&&!this.textInput&&!this.downloadView&&!this.startupPayloadView&&!this.confirmation&&!this.fileView&&!this.importJob&&!this.pluginView&&!this.packageView&&!this.saveView&&!this.historyView&&!this.startupReview;
    const browser=this.managerView&&!this.textInput&&!this.confirmation?fileManagerFrame(this.managerView,state.jobs):null;
    const pageSize=grid||browser?8:6;
    // Six content rows leave room for navigation on long libraries/inboxes.
    this.offset = Math.min(this.offset, Math.max(0, Math.floor((items.length - 1) / pageSize) * pageSize));
    let selected = items.slice(this.offset, this.offset + pageSize);
    if (this.offset) selected.push({ label: 'Previous items', detail: '', enabled: true, command: '$previous' });
    if (this.offset + pageSize < items.length) selected.push({ label: 'More items', detail: '', enabled: true, command: '$next' });
    const data = { ready: true, grid, browser, keyboard:!!this.textInput, reducedMotion: state.settings.appearance.reducedMotion, accent: state.settings.appearance.accent, ipVisible: state.settings.overlay.ip, ip: state.identity.ip,
      canBack: Boolean(this.managerView || this.payloadDownloads || this.textInput || this.downloadView || this.startupPayloadView || this.fileView || this.importJob || this.page || this.confirmation || this.pluginView || this.packageView || this.loadoutPreview || this.saveView || this.historyView || this.startupReview),
      page: this.page, title: `TacHen / ${this.confirmation ? 'Confirm action' : this.textInput ? (this.textInput.pluginField==='titleId'?'Enter game title ID':this.textInput.pluginField==='version'?'Enter game version':this.textInput.field==='url'?'Enter download link':this.textInput.operation==='mkdir'?'New folder':'Enter filename') : this.managerView ? 'File browser' : this.payloadDownloads ? (this.payloadDownloads.load?'Load payload':'Downloads') : this.downloadView && !this.confirmation ? 'Download payload' : this.confirmation ? 'Confirm action' : this.startupPayloadView ? 'Startup payloads' : this.importJob ? 'Preparing file' : this.fileView ? 'Choose a file' : this.pluginView ? 'Plugins' : this.packageView ? 'Packages' : this.historyView ? 'Session history' : this.saveView ? 'Saved games' : pages[this.page]}`,
      subtitle: this.notice || browser?.selection || (this.fileView?.source || (state.safe ? 'Recovery needs attention' : state.game ? state.game.name + ' · ' + state.game.titleId : 'Firmware ' + (state.identity.firmware || 'development'))),
      footer: browser ? 'D-pad Browse   L1/R1 Pane   X Open/select   Circle Up   Bottom bar: actions' : this.textInput ? 'D-pad Move   X Type   L1/R1 abc/ABC/Symbols   Circle Cancel' : 'X  Select     Circle  Back     L3 + R3  Close', rows: selected };
    const context=this.nativeSettings?JSON.stringify([this.page,this.offset,this.confirmation,this.cheatPack?.sha256,this.cheatTitle,state.game?.generation]):null;
    const signature = JSON.stringify(this.nativeSettings?[data,context]:data);
    if (signature !== this.signature) {
      this.signature = signature; this.sequence = (this.sequence + 1) >>> 0 || 1;
      // Native settings keeps its row objects across background updates. A token
      // survives only if the entire row AND its action context are unchanged.
      const previous=this.nativeSettings&&context===this.nativeRowContext ? [...(this.current?.rows||[])] : [];
      this.nativeRowContext=context;
      this.current = { ...data, sequence: this.sequence, rows: selected.map(item => {
        const index=previous.findIndex(({token,...old})=>JSON.stringify(old)===JSON.stringify(item));
        const token=index>=0?previous.splice(index,1)[0].token:runtime.id();
        return {...item,token};
      }) };
    }
    const metrics = state.game ? telemetryText(state) : '';
    if (metrics !== this.metrics) { this.metrics = metrics;this.metricsSequence = (this.metricsSequence + 1) >>> 0 || 1; }
    // Telemetry never changes action tokens or the selected menu's sequence.
    return { ...this.current, metrics, metricsSequence: this.metricsSequence, notices: state.notices, input: runtime.gameInputRelay?.frame(),dashboard:this.dashboard.frame() };
  }
  action(input) {
    invariant(input && /^[a-f0-9]{32}$/.test(input.request || ''), 'DECK_REQUEST', 'Invalid controller request.', { status: 400 });
    const signature = JSON.stringify([input.kind, input.sequence, input.row]);
    const previous = this.requests.get(input.request);
    if (previous) {
      invariant(signature === previous.signature, 'DECK_REQUEST_REUSED', 'Controller request was reused for another action.');
      return previous.result;
    }
    const run = async () => {
      // Rebuild before checking the displayed sequence so a phone update cannot
      // turn an old confirmation into a different or opposite action.
      const frame = this.frame();
      invariant(Number.isInteger(input.sequence) && input.sequence === frame.sequence, 'DECK_STALE', 'The deck changed. Select the action again.');
      const browserRow=frame.browser&&Number.isInteger(input.row)?input.row%32:input.row;
      if(frame.browser&&Number.isInteger(input.row)&&input.row>=24)this.managerView.active=input.row>=32?1:0;
      if(this.textInput){
        const effect=editDownload(this.textInput,input.kind,input.row);
        if(effect==='done'&&this.textInput.pluginField){
          this.pluginView.target[this.textInput.pluginField]=this.textInput.value;this.textInput=null;
        }else if(effect==='done'&&this.textInput.operation){
          const {operation,value,target,source}=this.textInput;
          this.confirmation={label:operation==='mkdir'?'Create folder '+value:'Rename to '+value,detail:target,command:'job.enqueue',args:operation==='mkdir'?{kind:'file.mkdir',input:{destination:target,name:value}}:{kind:'file.transfer',input:{...source,destination:target,destinationName:value,move:true}}};this.textInput=null;
        }else if(effect==='done'){const {field,value}=this.textInput;this.downloadView[field]=value;
          if(field==='url'&&!this.downloadView.name)this.downloadView.name=suggestedName(value);this.textInput=null;}
        else if(effect==='cancel')this.textInput=null;
        this.notice='';return this.frame();
      }
      if (input.kind === 'next' || input.kind === 'previous') {
        this.page = (this.page + (input.kind === 'next' ? 1 : pages.length - 1)) % pages.length;
        this.offset = 0; this.confirmation = null; this.startupPayloadView=null;this.transferView=null; this.managerView=null;this.payloadDownloads=null;this.gameView=null; this.downloadView=null; this.fileView=null;this.importJob=null;this.pluginView=null;this.packageView=null;this.loadoutPreview = null; this.saveView = null;this.historyView = null;this.startupReview = null; this.notice = '';if(this.page===5)await this.openCheats(); return this.frame();
      }
      if (input.kind === 'back') {
        if (this.confirmation && (this.managerView || this.payloadDownloads || this.gameView || this.downloadView || this.transferView || this.startupPayloadView || this.loadoutPreview || this.saveView || this.historyView || this.startupReview||this.pluginView||this.packageView||this.fileView||this.importJob)) this.confirmation = null;
        else if(this.managerView){await this.managerBack(browserRow);}
        else if(this.payloadDownloads)this.payloadDownloads=this.payloadDownloads.id?{}:null;
        else if(this.gameView)this.gameView=null;
        else if(this.downloadView){if(this.downloadView.job)delete this.downloadView.job;else this.downloadView=null;}
        else if(this.startupPayloadView)this.startupPayloadView=this.startupPayloadView.id?{}:null;
        else if(this.transferView?.id)this.transferView={section:this.transferView.section,...(this.transferView.parent?{id:this.transferView.parent}:{})};
        else if(this.transferView?.section)this.transferView={};
        else if(this.importJob)this.importJob=null;
        else if(this.fileView){if(this.fileView.source)this.fileView=await this.runtime.execute('files.browse',{kind:this.fileView.kind,source:this.fileView.parent});else this.fileView=null;}
        else if (this.packageView) this.packageView = this.packageView.id ? (this.runtime.packageItems?.find(p=>p.id===this.packageView.id)?.external?{}:{downloads:true}) : (this.packageView.downloads||this.packageView.receiver||this.packageView.activity||this.packageView.workflow) ? {} : null;
        else if(this.pluginView){const kind=this.pluginView.kind;this.pluginView=kind==='list'?null:kind==='targets'?{kind:'register',upload:this.pluginView.upload}:{kind:'list'};}
        else if (this.startupReview) { this.startupReview = null;this.packageView=this.startupReturnPackage||null;this.startupReturnPackage=null; }
        else if (this.historyView) { if (this.historyView.id) this.historyView = {};else this.historyView = null; }
        else if (this.saveView) { if(this.saveView.job)this.saveView={offset:0,selected:null};else if(this.saveView.usb)this.saveView.usb=false;else if (this.saveView.selected) this.saveView.selected = null;else this.saveView = null; }
        else { this.confirmation = null;if (this.loadoutPreview) this.loadoutPreview = null;else if (this.page === 5 && this.cheatPack) this.cheatPack = null;else this.page = 0; }
        this.offset = 0;this.notice = '';return this.frame();
      }
      const actionRows=frame.browser?[...frame.browser.panes.flatMap(p=>p.entries),...frame.rows]:frame.rows;
      invariant(input.kind === 'select' && Number.isInteger(input.row) && input.row >= 0 && browserRow < actionRows.length && (!frame.browser||input.row<64),
        'DECK_ACTION', 'Invalid deck action.', { status: 400 });
      const selected = actionRows[browserRow];
      invariant(selected.enabled, 'DECK_DISABLED', 'This action is not available.');
      if (selected.command === '$previous') this.offset -= 6;
      else if(selected.command==='$page'){this.page=selected.args.page;this.offset=0;if(this.page===2)this.refreshLibrary();if(this.page===5)await this.openCheats();}
      else if(selected.command==='$game-open'){this.gameView=selected.args;this.offset=0;}
      else if(selected.command==='$game-back'){this.gameView=null;this.offset=0;}
      else if(selected.command==='$transfer-open'){this.transferView={section:this.transferView?.section,id:selected.args.id,parent:selected.args.parent};this.offset=0;}
      else if(selected.command==='$transfer-back'){this.transferView={section:this.transferView?.section,...(this.transferView?.parent?{id:this.transferView.parent}:{})};this.offset=0;}
      else if(selected.command==='$transfer-section'){this.transferView={section:selected.args.section};this.offset=0;}
      else if(selected.command==='$file-manager'){this.managerView=this.suspendedManager||await openFileManager(this.runtime);this.suspendedManager=null;await refreshFileManager(this.runtime,this.managerView);this.offset=0;}
      else if(selected.command==='$manager-folder'){await this.managerFolder(selected.args.side,selected.args.source);}
      else if(selected.command==='$manager-entry'){const {side,item}=selected.args;this.managerView.active=side;if(item.directory&&(item.ino==null||this.managerView.selected?.source===item.source&&this.managerView.selected?.pane===side))await this.managerFolder(side,item.source);else this.managerView.selected={...item,pane:side};}
      else if(selected.command==='$manager-page'){const {side,offset}=selected.args;this.managerView.active=side;this.managerView.panes[side].offset=offset;}
      else if(selected.command==='$manager-refresh'){await refreshFileManager(this.runtime,this.managerView);}
      else if(selected.command==='$manager-exit'){this.managerView=null;this.offset=0;}
      else if(selected.command==='$manager-transfers'){this.suspendedManager=this.managerView;this.managerView=null;this.transferView={section:'active'};this.offset=0;}
      else if(selected.command==='$manager-name'){const v=this.managerView,operation=selected.args.operation,source=v.selected,target=operation==='mkdir'?v.panes[v.active].listing.source:source.source.slice(0,source.source.lastIndexOf('/'));
        this.textInput={field:'filename',operation,source,target,page:0,value:operation==='rename'?source.name:''};this.notice='';this.offset=0;}
      else if(selected.command==='$payload-downloads'){this.payloadDownloads={};this.downloadView=null;this.offset=0;}
      else if(selected.command==='$payload-file'){this.payloadDownloads=selected.args;this.downloadView=null;this.offset=0;}
      else if(selected.command==='$payload-downloads-exit'){this.payloadDownloads=null;this.offset=0;}
      else if(selected.command==='$package-downloads'){this.packageView={downloads:true};this.offset=0;}
      else if(selected.command==='$transfer-filter'){this.transferView={all:!this.transferView?.all};this.offset=0;}
      else if(selected.command==='$startup-payloads'){this.startupPayloadView={};this.offset=0;}
      else if(selected.command==='$startup-payload-open'){this.startupPayloadView=selected.args;this.offset=0;}
      else if(selected.command==='$download'){this.downloadView={};this.offset=0;}
      else if(selected.command==='$download-edit'){const field=selected.args.field;this.textInput={field,page:0,value:this.downloadView[field]||(field==='url'?'https://':'payload.elf')};this.notice='';this.offset=0;}
      else if(selected.command==='$download-exit'){this.downloadView=null;this.offset=0;}
      else if(selected.command==='$browse'){this.fileView=await runtimeBrowse(this.runtime,selected.args);this.offset=0;}
      else if(selected.command==='$package-storage'||selected.command==='$payload-storage'){
        const kind=selected.command==='$package-storage'?'package':'payload';
        const roots=await runtimeBrowse(this.runtime,{kind}),usb=roots.entries.filter(e=>e.usb);
        this.fileView=usb.length===1?await runtimeBrowse(this.runtime,{kind,source:usb[0].source}):roots;this.offset=0;
      }
      else if(selected.command==='$files-exit'){this.fileView=null;this.offset=0;}
      else if(selected.command==='$import-back'){this.importJob=null;this.offset=0;}
      else if(selected.command==='$import-open'){this.importJob=null;this.fileView=null;this.offset=0;if(selected.args.kind==='package')this.packageView={id:selected.args.id};else if(selected.args.kind==='plugin')this.pluginView={kind:'register',upload:selected.args.id};else if(selected.args.kind==='cheat'){this.page=5;this.cheatPack=await this.runtime.execute('cheat.inspect',{sha256:selected.args.id});}else {this.page=1;this.payloadDownloads={id:selected.args.id};}}
      else if (selected.command === '$packages') { this.packageView = {}; this.offset = 0; }
      else if (selected.command === '$package-open') { this.packageView = selected.args; this.offset = 0; }
      else if (selected.command === '$package-exit') { this.packageView = null; this.offset = 0; }
      else if(selected.command==='$plugins'){this.pluginView={kind:'list'};this.offset=0;}
      else if(selected.command==='$plugin-inbox'){this.pluginView={kind:'inbox'};this.offset=0;}
      else if(selected.command==='$plugin-register'){this.pluginView={kind:'register',...selected.args};this.offset=0;this.notice='Choose a game target to finish adding the plugin.';}
      else if(selected.command==='$plugin-targets'){this.pluginView={kind:'targets',upload:this.pluginView.upload};this.offset=0;this.notice='';this.refreshLibrary(true);}
      else if(selected.command==='$plugin-target'){this.pluginView={kind:'register',upload:this.pluginView.upload,target:{...selected.args.target}};this.offset=0;this.notice='Review the game and version, then choose Register plugin.';}
      else if(selected.command==='$plugin-edit'){const field=selected.args.field;this.textInput={pluginField:field,page:field==='titleId'?1:0,value:this.pluginView.target[field]||''};this.notice='';this.offset=0;}
      else if(selected.command==='$plugin-open'){this.pluginView={kind:'detail',...selected.args};this.offset=0;}
      else if(selected.command==='$plugin-exit'){this.pluginView=null;this.offset=0;}
      else if (selected.command === '$notice-dismiss') {
        const active = this.runtime.snapshot().notices.current;
        if (active) await this.runtime.execute('notice.dismiss', { id: active.id });
      }
      else if (selected.command === '$history') { this.historyView = {};this.offset = 0; }
      else if (selected.command === '$startup-review') {
        const plan = await this.runtime.execute('startup.preview', {});
        if(this.packageView){this.startupReturnPackage=this.packageView;this.packageView=null;}
        this.startupReview=plan;this.offset=0;
      }
      else if (selected.command === '$startup-back') { this.startupReview = null;this.packageView=this.startupReturnPackage||null;this.startupReturnPackage=null;this.offset = 0; }
      else if (selected.command === '$history-open') { this.historyView = selected.args;this.offset = 0; }
      else if (selected.command === '$history-back') { this.historyView = {};this.offset = 0; }
      else if (selected.command === '$saves') { this.saveView = { offset: 0, selected: null };this.offset = 0;await this.refreshSaves(); }
      else if(selected.command==='$save-usb'){this.saveView.usb=true;this.offset=0;}
      else if(selected.command==='$save-destinations'){this.saveView.usb=false;this.offset=0;}
      else if(selected.command==='$save-list'){this.saveView={offset:0,selected:null};this.offset=0;}
      else if (selected.command === '$save-open') { this.saveView.selected = selected.args;this.offset = 0; }
      else if (selected.command === '$save-page') { this.saveView.offset = selected.args.offset;this.offset = 0; }
      else if (selected.command === '$save-back') { this.saveView.selected = null;this.offset = 0; }
      else if (selected.command === '$loadout-open') { this.loadoutPreview = await this.runtime.execute('loadout.preview', selected.args);this.offset = 0; }
      else if (selected.command === '$loadout-back') { this.loadoutPreview = null;this.offset = 0; }
      else if (selected.command === '$cheat-open') { this.cheatPack = await this.runtime.execute('cheat.inspect', selected.args); this.offset = 0; }
      else if (selected.command === '$cheat-back') { this.cheatPack = null; this.offset = 0; }
      else if (selected.command === '$cheat-all') {this.cheatTitle=null;this.offset=0;this.notice='';}
      else if (selected.command === '$next') this.offset += 6;
      else if (selected.command === '$cancel') this.confirmation = null;
      else if (selected.command === '$confirm') {
        const pending = this.confirmation; this.confirmation = null;
        await this.dispatch(pending, input.request);
      } else if (selected.confirm) this.confirmation = selected;
      else await this.dispatch(selected, input.request);
      return this.frame();
    };
    const result = this.tail.then(run).catch(error => { this.notice = error.message; throw error; });
    this.tail = result.catch(() => {});
    this.requests.set(input.request, { signature, result });
    if (this.requests.size > 128) this.requests.delete(this.requests.keys().next().value);
    return result;
  }
  async managerFolder(side,source){const v=this.managerView;v.active=side;v.panes[side]={listing:await this.runtime.execute('files.list',{source}),offset:0};this.offset=0;}
  async managerBack(row){
    const v=this.managerView,side=Number.isInteger(row)&&row<24?Math.floor(row/12):v.active;
    if(v.panes[side].listing.source)await this.managerFolder(side,v.panes[side].listing.parent);else this.managerView=null;
  }
  refreshCheats(){
    if(this.cheatsRequested||!this.runtime.jobs.handlers.has('cheat.sync')||this.runtime.graph.safe)return;
    this.cheatsRequested=true;
    this.runtime.execute('job.enqueue',{kind:'cheat.sync',input:{},key:this.runtime.id()}).catch(error=>{this.notice=error.message;this.cheatsRequested=false;});
  }
  refreshLibrary(automatic = false) {
    if (this.libraryPending || !this.runtime.library) return this.libraryPending;
    if(!automatic)this.notice = 'Finding games...';
    // Automatic and manual refresh deliberately use the identical command.
    // Keep selection/navigation and the current action's notice unchanged.
    this.libraryPending = this.runtime.execute('library.refresh', {}).then(() => { if(!automatic)this.notice = 'Game list updated.'; }, error => { if(!automatic)this.notice = error.message; }).finally(() => { this.libraryPending = null; });
    return this.libraryPending;
  }
  async refreshSaves() {
    if (!this.runtime.saves || this.runtime.graph.safe) return;
    const current = this.runtime.jobs.snapshot().find(j => j.kind === 'save.refresh' && !['completed','failed','cancelled'].includes(j.status));
    if (!current && !this.runtime.saves.list({}).updatedAt) await this.runtime.execute('job.enqueue', { kind:'save.refresh', input:{}, key:this.runtime.id() });
  }
  async dispatch(row, key) {
    try {
      if (row.packageReview) {
        const current = packageDeckRows(this.runtime.snapshot(), { id: row.packageReview }, this.runtime.jobs.snapshot());
        invariant(current.some(item => item.enabled && item.command === row.command && JSON.stringify(item.args) === JSON.stringify(row.args)),
          'PACKAGE_REVIEW_CHANGED', 'The package or its operation changed. Review it again before installing.');
      }
      this.notice = 'Working…';
      if (row.command === 'library.refresh') { this.refreshLibrary();return; }
      const result=await this.runtime.execute(row.command, row.command === 'job.enqueue' ? { ...row.args, key } : row.args || {});
      if(row.command==='job.enqueue'&&row.args.kind==='payload.download'&&this.downloadView){this.downloadView.job=result.id;this.offset=0;}
      if(row.command==='job.enqueue'&&row.args.kind==='save.export'&&this.saveView){this.saveView.job=result.id;this.offset=0;}
      if(row.command==='job.enqueue'&&['file.transfer','file.mkdir','file.delete'].includes(row.args.kind)&&this.managerView){this.managerView.job=result.id;this.managerView.message='';this.offset=0;}
      if(row.command==='download.delete'){if(row.args.kind==='payload')this.payloadDownloads={};else this.packageView=row.label==='Remove from list'?{}:{downloads:true};this.offset=0;}
      if(row.fileImport){this.importJob={id:result.id,kind:row.fileImport};this.offset=0;}
      if(row.packageWorkflow){this.fileView=null;this.importJob=null;this.packageView={workflow:result.id};this.offset=0;}
      if(row.payloadWorkflow){this.fileView=null;this.importJob=null;this.payloadDownloads={load:continuePayloadLoad(this.runtime,result)};this.offset=0;}
      if(row.payloadResult){this.downloadView=null;this.payloadDownloads={load:{file:row.payloadFile,trackJob:row.command==='job.enqueue',job:result?.id,phase:row.command==='service.start'?'ready':'loading',message:row.command==='service.start'?'Service started and ready.':null}};this.offset=0;}
      if(row.command==='plugin.register'){
        const registered=result.find(item=>item.upload===row.args.upload);
        this.pluginView=registered?{kind:'detail',sha256:registered.sha256}:{kind:'list'};this.offset=0;
      }
      this.notice = row.payloadWorkflow?'Preparing payload. Loading will follow automatically.':row.payloadResult?'Loading status is shown here.':row.command === 'plugin.register' ? 'Plugin registered. Ready in Plugins.' :
        row.command === 'job.enqueue' ? (row.packageWorkflow||row.args.kind==='package.install'?'Installation started. Progress is shown here.':'Accepted. Follow progress in Transfers.') : 'Updated.';
    } catch (error) { this.notice = error.message; throw error; }
  }
}

async function runtimeBrowse(runtime,args){return runtime.execute('files.browse',args);}
