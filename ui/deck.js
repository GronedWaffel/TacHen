// SPDX-License-Identifier: GPL-3.0-or-later
let csrf, state, connected = true, timer, busy = false;
let libraryPage = { games: [], total: 0, offset: 0 }, libraryBusy = false;
let packageUploading = false, packageStop = false, packageResume = null;
let cheatPack = null;
let savePage = { entries: [], volumes: [], total: 0, offset: 0, updatedAt: null }, saveBusy = false;
const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
async function api(route, body) {
  const response = await fetch(route, body === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-TacHen-CSRF': csrf } : {}) }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) { const error = new Error([value.error?.message, value.error?.action].filter(Boolean).join(' ')); error.status = response.status; throw error; }
  return value;
}
function notice(text) { $('#notice').hidden = !text; $('#notice').textContent = text || ''; }
async function command(command, args) {
  if (busy) return; busy = true;
  try { await api('/api/command', { command, args }); await refresh(); notice(''); }
  catch (error) { notice(error.message); }
  finally { busy = false; }
}
function row(name, detail, status, available = true) {
  const item = el('div', 'row'), copy = el('div'); copy.append(el('strong', '', name));
  if (detail) copy.append(el('p', '', detail)); item.append(copy, el('span', 'status' + (available ? '' : ' unavailable'), status)); return item;
}
const capability = id => state.capabilities.find(item => item.id === id);
const requestKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function loadSaves(offset = 0) {
  if (saveBusy) return;saveBusy = true;
  try { ({ result: savePage } = await api('/api/command', { command: 'save.list', args: { query: $('#save-query').value.trim(), offset, limit: 30 } }));drawSaves(); }
  catch (error) { notice(error.message); } finally { saveBusy = false; }
}
function drawSaves() {
  const available = capability('saves')?.available;
  $('#save-refresh').disabled = !available || state.safe;
  $('#save-status').textContent = !available ? capability('saves')?.reason || 'Save helper is unavailable.' :
    state.saves?.updatedAt ? `${savePage.total} matching saves · ${state.saves.skipped} unreadable or unsupported entries skipped. Refresh after changing a save or USB drive.` : 'Refresh to read local saves and connected USB drives.';
  const select = $('#save-destination'), signature = JSON.stringify(savePage.volumes);
  if (select.dataset.list !== signature) {
    const previous = select.value;select.replaceChildren(...[{ destination: 0, path: 'FTP share' }, ...savePage.volumes].map(v => {
      const option = el('option', '', v.destination ? `${v.path} · ${formatBytes(v.freeBytes)} free` : v.path);option.value = String(v.destination);return option;
    }));select.value = [...select.options].some(o => o.value === previous) ? previous : '0';select.dataset.list = signature;
  }
  $('#save-items').replaceChildren(...savePage.entries.map(item => {
    const running = state.game?.titleId === item.titleId;
    const node = row(item.titleId + ' · ' + item.slot.slice(6), `PS${item.platform} · User ${item.user} · ${formatBytes(item.bytes)} encrypted`, running ? 'Close game first' : 'Ready to export', !running);
    const button = el('button', '', 'Export decrypted save');button.disabled = !available || state.safe || running;
    button.onclick = async () => {
      const destination = Number(select.value), volume = savePage.volumes.find(v => v.destination === destination);
      if (destination && !volume) return notice('Refresh and select the USB drive again.');
      if (!confirm(`Export ${item.titleId} / ${item.slot.slice(6)} to ${volume?.path || 'the FTP share'}? Keep this game closed until the export finishes.`)) return;
      await command('job.enqueue', { kind: 'save.export', input: { ...item, destination, volume: volume?.stamp || '' }, key: requestKey() });
    };node.append(button);return node;
  }));
  $('#save-previous').disabled = savePage.offset === 0;$('#save-next').disabled = savePage.offset + 30 >= savePage.total;
  $('#save-exports').replaceChildren(...state.jobs.filter(j => j.kind === 'save.export' && j.status === 'completed').slice(-8).reverse().map(job => {
    const r = job.result, node = row(r.titleId + ' · ' + r.slot.slice(6), `${r.files} entries · ${formatBytes(r.bytes)}`, 'Verified');
    node.append(el('p', 'fine', r.ftpPath ? `FTP port 2122: ${r.ftpPath}` : r.output));return node;
  }));
}
$('#save-refresh').onclick = () => command('job.enqueue', { kind: 'save.refresh', input: {}, key: requestKey() });
$('#save-find').onclick = () => loadSaves(0);
$('#save-previous').onclick = () => loadSaves(Math.max(0, savePage.offset - 30));
$('#save-next').onclick = () => loadSaves(savePage.offset + 30);
function drawCheats() {
  $('#cheat-file').disabled = !Array.isArray(state.cheats);
  if (state.game) {
    if (!$('#cheat-title').value) $('#cheat-title').value = state.game.titleId;
    if (!$('#cheat-version').value) $('#cheat-version').value = state.game.version;
  }
  $('#cheat-packs').replaceChildren(...(state.cheats || []).map(pack => {
    const matches = state.game?.titleId === pack.titleId && state.game?.version === pack.version;
    const node = row(pack.name, `${pack.titleId} · ${pack.version} · ${pack.count} cheats`, matches ? 'Matches game' : 'Other game/version', matches);
    const open = el('button', '', 'View cheats');
    open.onclick = async () => {
      try { ({ result: cheatPack } = await api('/api/command', { command: 'cheat.inspect', args: { sha256: pack.sha256 } })); drawCheats(); }
      catch (error) { notice(error.message); }
    }; node.append(open); return node;
  }));
  $('#cheat-details').hidden = !cheatPack;
  if (!cheatPack) return;
  $('#cheat-pack-name').textContent = cheatPack.name;
  $('#cheat-pack-credits').textContent = cheatPack.credits.length ? 'Credits: ' + cheatPack.credits.join(', ') : 'No author credit supplied in this file.';
  const sha256 = cheatPack.sha256, matches = state.game?.titleId === cheatPack.titleId && state.game?.version === cheatPack.version;
  $('#cheat-items').replaceChildren(...cheatPack.cheats.map(cheat => {
    const active = cheat.operation && !['failed', 'cancelled', 'completed'].includes(cheat.operation.status);
    const status = cheat.operation?.message || (cheat.lastApplied == null ? 'Not applied in this game session' : 'Last applied: ' + (cheat.lastApplied ? 'On' : 'Off'));
    const node = row(cheat.name, cheat.description, status, !active), actions = el('div', 'actions');
    for (const enabled of [true, false]) {
      const button = el('button', '', enabled ? 'Enable' : 'Restore original');
      button.disabled = active || !matches || !cheat.supported || !capability('cheats')?.available || state.safe;
      button.onclick = () => command('job.enqueue', { kind: 'cheat.set', input: { sha256, cheatId: cheat.id, enabled }, key: requestKey() });
      actions.append(button);
    }
    node.append(actions);
    if (!cheat.supported) node.append(el('p', 'fine', 'This cheat needs a nonzero-section adapter; it cannot be applied by this build yet.'));
    return node;
  }));
}
$('#cheat-file').onchange = async event => {
  const file = event.target.files[0]; if (!file || busy) return; busy = true;
  try {
    if (file.size > 4 * 1024 * 1024) throw Error('Cheat files are limited to 4 MiB.');
    const source = await file.text();
    const { result } = await api('/api/cheats/import', { source, titleId: $('#cheat-title').value.trim().toUpperCase(), version: $('#cheat-version').value.trim() });
    ({ result: cheatPack } = await api('/api/command', { command: 'cheat.inspect', args: { sha256: result.sha256 } }));
    $('#cheat-status').textContent = `${result.name} imported and verified. No cheat was applied.`; await refresh();
  } catch (error) { $('#cheat-status').textContent = error.message; }
  finally { event.target.value = ''; busy = false; }
};
function drawLoadouts() {
  const library = state.loadouts;
  $('#loadout-create').disabled = !library || !state.game;
  $('#loadout-status').textContent = library?.observation?.message || (state.game ? 'Current game: ' + state.game.titleId + ' · ' + state.game.version : 'Open a game to create its first loadout. Saved loadouts can be edited here at any time.');
  $('#loadout-items').replaceChildren(...(library?.profiles.length ? library.profiles.map(profile => {
    const matches = state.game?.titleId === profile.titleId && state.game?.version === profile.version;
    const node = row(profile.name, `${profile.titleId} · ${profile.version} · ${profile.plugins.length} plugins · ${profile.cheats.length} cheats`, profile.autostart ? 'Automatic' : 'Manual');
    node.classList.add('plugin-row');const actions = el('div', 'actions'), edit = el('button', '', 'Edit'), review = el('button', '', 'Review and apply');
    edit.onclick = () => loadoutEditor(profile);review.disabled = !matches || state.safe;
    review.onclick = () => loadoutReview(profile);actions.append(edit, review);
    if (library.active?.game.titleId === profile.titleId && library.active.game.version === profile.version) {
      const release = el('button', '', 'Use default overlay');release.onclick = () => command('loadout.overlay.release', {});actions.append(release);
      node.append(el('p', 'fine', 'This game has temporary overlay choices from ' + library.active.name + '.'));
    }
    node.append(actions);return node;
  }) : [el('p', 'empty', 'No game loadouts saved yet.')]));
}
$('#loadout-create').onclick = () => {
  if (!state.game) return;
  const saved = state.loadouts?.profiles.find(p => p.titleId === state.game.titleId && p.version === state.game.version);
  loadoutEditor(saved || { titleId: state.game.titleId, version: state.game.version, name: state.game.name || state.game.titleId,
    plugins: [], cheats: [], overlay: {}, autostart: false });
};
async function loadoutEditor(profile) {
  const revision = state.revision, dialog = el('dialog', 'storage-dialog'), form = el('form'), name = el('input'), automatic = el('input');
  const heading = el('h2', '', 'Edit game loadout');heading.id = 'loadout-heading';dialog.setAttribute('aria-labelledby', heading.id);
  const field = (label, input) => { const line = el('label', 'setting', label);line.append(input);return line; };
  name.value = profile.name;name.maxLength = 100;name.required = true;automatic.type = 'checkbox';automatic.checked = profile.autostart;
  const pluginChoices = new Map(), cheatChoices = new Map(), overlayChoices = new Map();
  const pluginGroup = el('fieldset'), cheatGroup = el('fieldset'), overlayGroup = el('fieldset');
  pluginGroup.append(el('legend', '', 'Plugins'));cheatGroup.append(el('legend', '', 'Cheats'));overlayGroup.append(el('legend', '', 'Overlay'));
  const choice = (group, map, key, label, checked, disabled = false) => {
    const input = el('input');input.type = 'checkbox';input.checked = checked;input.disabled = disabled;
    map.set(key, input);group.append(field(label, input));
  };
  for (const plugin of state.plugins || []) if (plugin.scope === 'system' || plugin.target?.titleId === profile.titleId && plugin.target?.version === profile.version)
    choice(pluginGroup, pluginChoices, plugin.sha256, plugin.name, profile.plugins.includes(plugin.sha256));
  for (const sha256 of profile.plugins) if (!pluginChoices.has(sha256)) choice(pluginGroup, pluginChoices, sha256, 'Unavailable plugin · ' + sha256.slice(0, 12), true);
  if (!pluginChoices.size) pluginGroup.append(el('p', 'fine', 'Register plugins in Payloads first.'));
  for (const [key, label] of [['fps', 'FPS'], ['ram', 'Memory'], ['cpu', 'CPU'], ['ip', 'IP address']]) {
    const select = el('select');for (const [value, text] of [['inherit', 'Use default'], ['on', 'On'], ['off', 'Off']]) { const option = el('option', '', text);option.value = value;select.append(option); }
    select.value = Object.hasOwn(profile.overlay, key) ? profile.overlay[key] ? 'on' : 'off' : 'inherit';overlayChoices.set(key, select);overlayGroup.append(field(label, select));
  }
  const status = el('p', 'fine', 'Reading available cheats…');status.setAttribute('role', 'status');
  const save = el('button', '', 'Save loadout'), cancel = el('button', '', 'Cancel'), remove = el('button', 'quiet', 'Delete loadout');
  save.type = 'submit';save.disabled = true;cancel.type = remove.type = 'button';cancel.onclick = () => dialog.close();
  const actions = el('div', 'actions');actions.append(save, cancel);
  if (state.loadouts?.profiles.some(p => p.titleId === profile.titleId && p.version === profile.version)) actions.append(remove);
  remove.onclick = async () => {
    if (!confirm('Delete this saved loadout? Existing plugins and cheats will stay applied.')) return;remove.disabled = true;
    try { await api('/api/command', { command: 'loadout.remove', args: { titleId: profile.titleId, version: profile.version, revision } });dialog.close();await refresh(); }
    catch (error) { status.textContent = error.message;remove.disabled = false; }
  };
  form.append(field('Name', name), field('Apply automatically when this game opens', automatic), pluginGroup, cheatGroup, overlayGroup, status, actions);
  dialog.append(heading, el('p', 'fine', profile.titleId + ' · ' + profile.version), form);dialog.onclose = () => dialog.remove();document.body.append(dialog);dialog.showModal();
  try {
    for (const entry of state.cheats || []) if (entry.titleId === profile.titleId && entry.version === profile.version) {
      const { result: pack } = await api('/api/command', { command: 'cheat.inspect', args: { sha256: entry.sha256 } });if (!dialog.isConnected) return;
      for (const cheat of pack.cheats) {
        const selected = profile.cheats.some(c => c.pack === pack.sha256 && c.id === cheat.id);
        choice(cheatGroup, cheatChoices, pack.sha256 + ':' + cheat.id, pack.name + ' / ' + cheat.name + (cheat.supported ? '' : ' · unavailable'), selected, !cheat.supported && !selected);
      }
    }
    for (const ref of profile.cheats) { const key = ref.pack + ':' + ref.id;if (!cheatChoices.has(key)) choice(cheatGroup, cheatChoices, key, 'Unavailable cheat · ' + ref.pack.slice(0, 12) + ' / ' + ref.id, true); }
    if (!cheatChoices.size) cheatGroup.append(el('p', 'fine', 'Import an exact-version cheat file in Cheats first.'));
    status.textContent = 'Choose Review and apply for manual use. Enabling automatic startup can apply this setup to the current game as soon as it is ready.';save.disabled = false;
  } catch (error) { status.textContent = 'Could not read cheat choices: ' + error.message + ' Close and reopen this editor to retry.'; }
  form.onsubmit = async event => {
    event.preventDefault();save.disabled = true;
    const overlay = {};for (const [key, select] of overlayChoices) if (select.value !== 'inherit') overlay[key] = select.value === 'on';
    const updated = { ...profile, name: name.value.trim(), autostart: automatic.checked, overlay,
      plugins: [...pluginChoices].filter(([, input]) => input.checked).map(([key]) => key),
      cheats: [...cheatChoices].filter(([, input]) => input.checked).map(([key]) => { const [pack, id] = key.split(':');return { pack, id }; }) };
    try { await api('/api/command', { command: 'loadout.save', args: { profile: updated, revision } });dialog.close();await refresh();notice('Loadout saved.'); }
    catch (error) { status.textContent = error.message;save.disabled = false; }
  };
}
async function loadoutReview(profile) {
  const dialog = el('dialog', 'storage-dialog'), detail = el('div', 'stack'), status = el('p', 'fine', 'Checking every choice…');status.setAttribute('role', 'status');
  const apply = el('button', '', 'Apply loadout'), close = el('button', '', 'Back'), actions = el('div', 'actions');apply.disabled = true;close.onclick = () => dialog.close();actions.append(apply, close);
  dialog.append(el('h2', '', profile.name), el('p', 'fine', profile.titleId + ' · ' + profile.version), detail, status, actions);
  dialog.onclose = () => dialog.remove();document.body.append(dialog);dialog.showModal();
  try {
    const { result: plan } = await api('/api/command', { command: 'loadout.preview', args: { titleId: profile.titleId, version: profile.version } });if (!dialog.isConnected) return;
    for (const step of plan.steps) detail.append(row(step.label, '', step.existing ? 'Reuse recorded operation' : 'Will start'));
    for (const [key, value] of Object.entries(plan.profile.overlay)) detail.append(row(key.toUpperCase() + ' overlay', '', value ? 'On' : 'Off'));
    for (const issue of plan.issues) detail.append(row(issue.label, issue.message, 'Needs attention', false));
    status.textContent = plan.canApply ? 'Ready. Operations run in order. A failure stops later steps; already loaded plugins remain resident.' : 'Resolve the listed issues before applying this loadout.';
    apply.disabled = !plan.canApply;const key = requestKey();
    apply.onclick = async () => {
      apply.disabled = true;
      try { await api('/api/command', { command: 'job.enqueue', args: { kind: 'loadout.apply', input: plan.accepted, key } });dialog.close();await refresh();notice('Loadout queued. Follow each step in Activity.'); }
      catch (error) { status.textContent = error.message;apply.disabled = false; }
    };
  } catch (error) { status.textContent = error.message; }
}
function draw() {
  drawCheats();
  drawLoadouts();
  drawSaves();
  const sample = state.telemetry;
  $('#game-measurements').replaceChildren(...[
    ['fps', sample?.fpsSource === 'display-scanout' ? 'Display rate' : 'Game FPS', sample?.fps, sample?.fpsSource === 'display-scanout' ? ' Hz' : ' FPS'],
    ['cpu', 'Game CPU', sample?.cpuPercent, '%'],
    ['ram', 'Resident memory', sample?.rssBytes == null ? null : Math.round(sample.rssBytes / 1024 ** 2), ' MiB']
  ].filter(([key]) => state.settings.overlay[key]).map(([, label, value, unit]) => row(label, '', value == null ? 'Unavailable' : value + unit, value != null)));
  $('#measurement-detail').textContent = sample?.reason || 'Monitoring is not integrated in this runtime.';
  $('#mcp-enabled').checked = state.settings.developer.enabled;
  $('#mcp-enabled').disabled = !capability('mcp')?.available || state.safe;
  $('#mcp-writes').checked = state.settings.developer.memoryWrites;
  $('#mcp-writes').disabled = !state.settings.developer.enabled || state.safe;
  $('#mcp-create').disabled = !state.settings.developer.enabled || !capability('mcp')?.available || state.safe;
  $('#mcp-revoke').disabled = !state.settings.developer.enabled;
  if (!state.settings.developer.enabled) { $('#mcp-token').value = '';$('#mcp-connection').hidden = true; }
  if (!capability('mcp')?.available) $('#mcp-status').textContent = capability('mcp')?.reason || 'Native memory tools are not installed.';
  document.body.dataset.accent = state.settings.appearance.accent;
  document.body.dataset.reducedMotion = String(state.settings.appearance.reducedMotion);
  $('#connection').textContent = 'Connected locally';
  $('#address').textContent = state.identity.ip;
  $('#firmware').textContent = state.identity.firmware ? 'PS5 · ' + state.identity.firmware : 'Local development · No PS5 connection';
  $('#context-title').textContent = state.game?.name || 'Command deck';
  $('#context-detail').textContent = state.game ? `${state.game.titleId} · ${state.game.version}` : state.gameStatus?.message || 'Everything starts with a reliable session.';
  $('#session-title').textContent = state.safe ? 'Safe startup' : state.identity.mode === 'development' ? 'Development workspace' : 'TacHen coordinator online';
  $('#session-detail').textContent = state.safe ? 'Optional components are held while the previous startup is reviewed.' :
    state.identity.mode === 'development' ? 'Explore the deck locally. Native console integrations are listed honestly below.' : 'Use the deck from your console or phone. Component readiness is tracked separately.';
  $('#session-chips').replaceChildren(...[state.safe ? 'Optional startup held' : 'Shared state', 'No cloud account', 'Hardware validation pending'].map(text => el('span', 'chip', text)));
  $('#services').replaceChildren(...(state.services.length ? state.services.map(service => {
    const node = row(service.id, service.error?.message || (service.evidence?.version ? `Verified version ${service.evidence.version}` : ''), service.status, service.status === 'ready');
    if (['kstuff', 'shadowmount', 'payload-manager'].includes(service.id) && service.status !== 'starting') {
      const start = service.status === 'stopped' && !state.safe;
      const button = el('button', '', start ? 'Start service' : 'Check readiness');
      button.onclick = () => command(start ? 'service.start' : 'service.reconcile', { id: service.id }); node.append(button);
    }
    return node;
  }) : [el('p', 'empty', 'No native services started in this build.') ]));
  const available = state.capabilities.filter(item => item.available);
  $('#available-count').textContent = `${available.length} of ${state.capabilities.length} integrations`;
  $('#capabilities').replaceChildren(...available.map(item => { const card = el('article', 'cap'); card.append(el('span', 'indicator', 'AVAILABLE'), el('h3', '', item.name), el('p', '', item.reason || 'Connected to the shared TacHen runtime.')); return card; }));
  $('#component-list').replaceChildren(...state.capabilities.map(item => row(item.name, item.reason, item.available ? 'Available' : 'Not integrated', item.available)));
  $('#payload-file').disabled = !capability('inbox')?.available;
  $('#package-file').disabled = packageUploading || !Array.isArray(state.packages);
  $('#package-hash').disabled = packageUploading;
  $('#package-stop').disabled = !packageUploading;
  $('#package-install-status').textContent = capability('packages')?.available
    ? 'Verified packages can be queued for background installation.'
    : capability('packages')?.reason || 'Native installation is still being integrated.';
  $('#package-items').replaceChildren(...(state.packages?.length ? state.packages.map(item => {
    const node = row(item.name, `${formatBytes(item.offset)} / ${formatBytes(item.bytes)}`, item.status, item.status === 'verified');
    const active = state.jobs.some(job => job.resources.includes('package-file:' + item.id) && !['completed', 'cancelled', 'failed'].includes(job.status));
    if (item.status === 'uploading' && item.offset < item.bytes) {
      const resume = el('button', '', 'Resume upload'); resume.disabled = packageUploading;
      resume.onclick = () => { packageResume = item; $('#package-progress').textContent = `Choose the exact original file for ${item.name} to resume.`; $('#package-file').click(); }; node.append(resume);
    }
    if (item.status === 'uploading' && item.offset === item.bytes) {
      const verify = el('button', '', active ? 'Verification in Activity' : 'Verify package'); verify.disabled = active;
      verify.onclick = () => command('job.enqueue', { kind: 'package.verify', input: { id: item.id }, key: requestKey() }); node.append(verify);
    }
    if (item.status === 'verified' && capability('packages')?.available) {
      const install = el('button', '', active ? 'Installation in Activity' : 'Install package'); install.disabled = active;
      install.onclick = () => command('job.enqueue', { kind: 'package.install', input: { id: item.id }, key: requestKey() }); node.append(install);
    }
    return node;
  }) : [el('p', 'empty', 'Package uploads will appear here.') ]));
  $('#library-refresh').disabled = libraryBusy || !capability('shadowmount')?.available;
  $('#library-find').disabled = libraryBusy || !state.library?.available;
  $('#library-previous').disabled = libraryBusy || libraryPage.offset === 0;
  $('#library-next').disabled = libraryBusy || libraryPage.offset + libraryPage.games.length >= libraryPage.total;
  if (state.library?.error) $('#library-status').textContent = state.library.error.message;
  $('#inbox-items').replaceChildren(...(state.inbox?.length ? state.inbox.map(item => {
    const node = row(item.name, `${(item.offset / 1048576).toFixed(1)} / ${(item.bytes / 1048576).toFixed(1)} MiB`, item.status, item.status === 'verified');
    if (item.status === 'verified' && /\.elf$/i.test(item.name) && capability('payloads')?.available) {
      const button = el('button', '', 'Run payload');
      button.onclick = () => command('job.enqueue', { kind: 'payload.dispatch', input: { id: item.id }, key: requestKey() });
      node.append(button);
    }
    if (item.status === 'verified' && /\.(plugin|prx|sprx)$/i.test(item.name) && Array.isArray(state.plugins)) {
      const button = el('button', '', 'Register plugin'); button.disabled = state.plugins.some(plugin => plugin.upload === item.id);
      button.onclick = () => pluginDialog(item); node.append(button);
    }
    return node;
  }) : [el('p', 'empty', 'Uploaded payloads will appear here.') ]));
  $('#plugin-items').replaceChildren(...(state.plugins?.length ? state.plugins.map(item => {
    const module = ['prx', 'sprx'].includes(item.format);
    const detail = `${module ? item.format.toUpperCase() + ' · ' + item.platform.toUpperCase() : item.pluginId + ' · ' + item.pluginVersion} · ${item.target ? item.target.titleId + ' / ' + item.target.version : 'System / game watcher'}`;
    const node = row(item.name, detail, item.observation.phase, ['process-active', 'module-started'].includes(item.observation.phase));
    node.classList.add('plugin-row');
    node.append(el('p', 'fine', item.observation.message));
    const start = el('button', '', 'Start now'), automatic = el('button', '', item.autostart ? 'Disable autostart' : 'Enable autostart');
    start.disabled = state.safe || !['stopped', 'armed', 'uninspected', 'failed', 'held', 'cancelled'].includes(item.observation.phase);
    if (module && (state.game?.titleId !== item.target.titleId || state.game?.version !== item.target.version)) start.disabled = true;
    start.onclick = () => command('job.enqueue', { kind: module ? 'game.module.start' : 'plugin.start', input: { sha256: item.sha256, source: 'manual' }, key: requestKey() });
    automatic.onclick = () => command('plugin.configure', { sha256: item.sha256, autostart: !item.autostart, revision: state.revision });
    const actions = el('div', 'actions'); actions.append(start, automatic); node.append(actions); return node;
  }) : [el('p', 'empty', Array.isArray(state.plugins) ? 'No plugins registered yet.' : 'Plugin loading requires the console runtime.') ]));
  const active = state.jobs.filter(job => !['completed', 'cancelled', 'failed'].includes(job.status)); $('#job-count').textContent = active.length;
  $('#jobs').replaceChildren(...(state.jobs.length ? [...state.jobs].reverse().map(job => {
    const title = { 'package.verify': 'Verify package', 'package.install': 'Install package', 'library.storage': 'Game file operation', 'library.mount': 'Game mount',
      'payload.dispatch': 'Load payload', 'plugin.start': 'Start plugin', 'game.module.start': 'Load game module', 'deck.start': 'Start command deck', 'loadout.apply': 'Apply game loadout' }[job.kind] || job.kind;
    const partial = job.kind === 'loadout.apply' && job.result?.phase === 'loadout-stopped';
    const node = row(title, job.error?.message || job.result?.message || job.progress?.phase || 'Waiting for execution',
      partial ? 'Stopped · review steps' : job.result?.phase === 'dispatched' && job.status === 'completed' ? 'Dispatched' : job.status, job.status === 'completed' && !partial);
    node.classList.add('job-row');
    const actions = el('div', 'actions');
    if (job.progress?.total > 0) {
      const progress = el('progress'); progress.max = job.progress.total; progress.value = job.progress.completed;
      progress.setAttribute('aria-label', 'Operation progress'); node.append(progress,
        el('small', '', job.kind === 'loadout.apply' ? `${job.progress.completed} / ${job.progress.total} steps recorded` : `${Math.floor(job.progress.completed / job.progress.total * 100)}% · ${formatBytes(job.progress.completed)} / ${formatBytes(job.progress.total)}`));
    }
    if (job.kind === 'loadout.apply' && job.result?.steps?.length) {
      const list = el('ul', 'fine');for (const step of job.result.steps) {
        const child = state.jobs.find(item => item.id === step.id);
        list.append(el('li', '', `${step.label || child?.kind || 'Recorded step'}: ${child?.status || 'Receipt unavailable'}${step.adopted ? ' · already applied' : ''}`));
      }node.append(list);
    }
    for (const [label, action, show] of [['Cancel', 'cancel', ['queued', 'held'].includes(job.status) || ['library.storage', 'package.verify'].includes(job.kind) && job.status === 'running'], ['Resume', 'resume', job.status === 'held'], ['Check result', 'reconcile', job.status === 'interrupted']]) {
      if (!show) continue; const button = el('button', '', label); button.onclick = () => command('job.' + action, { id: job.id }); actions.append(button);
    }
    if (actions.children.length) node.append(actions); return node;
  }) : [el('p', 'empty', 'No background operations yet.') ]));
  $('#history').replaceChildren(...(state.history.length ? [...state.history].reverse().map(item => row(item.message, item.detail || item.fields?.join(', '), new Date(item.at).toLocaleTimeString())) : [el('p', 'empty', 'Changes made during this session will appear here.') ]));
  $('#accent').value = state.settings.appearance.accent; $('#reduced-motion').checked = state.settings.appearance.reducedMotion;
  for (const input of document.querySelectorAll('[data-overlay]')) {
    const key = input.dataset.overlay; input.checked = state.settings.overlay[key];
    const needed = { fps: 'fps', ram: 'resources', cpu: 'resources', ip: 'ip-overlay' }[key];
    input.disabled = needed ? !capability(needed)?.available : false;
  }
}
function pluginDialog(item) {
  const module = /\.(prx|sprx)$/i.test(item.name);
  const dialog = el('dialog', 'storage-dialog'), form = el('form'), scope = el('select'), title = el('input'), version = el('input');
  const revision = state.revision, status = el('p', 'fine'), start = el('button', '', 'Register plugin'), cancel = el('button', '', 'Cancel');
  for (const [value, text] of [['system', 'System / game watcher'], ['game', 'Autostart for a specific game']]) {
    if (module && value !== 'game') continue;
    const option = el('option', '', text); option.value = value; scope.append(option);
  }
  title.placeholder = 'Title ID, e.g. PPSA00001'; title.maxLength = 9; title.value = state.game?.titleId || '';
  version.placeholder = 'Exact game version'; version.maxLength = 10; version.value = state.game?.version || '';
  const scopeLabel = el('label', 'setting', 'Plugin use'), titleLabel = el('label', 'setting', 'Target title'), versionLabel = el('label', 'setting', 'Target version');
  scopeLabel.append(scope); titleLabel.append(title); versionLabel.append(version);
  const update = () => { titleLabel.hidden = versionLabel.hidden = scope.value !== 'game'; }; scope.onchange = update; update();
  start.type = 'submit'; cancel.type = 'button'; cancel.onclick = () => dialog.close();
  const actions = el('div', 'actions'); actions.append(start, cancel);
  form.append(scopeLabel, titleLabel, versionLabel, el('p', 'fine', module ?
    'This module loads inside the exact target game. Enable autostart to arm it before opening that game. It remains resident until the game closes.' :
    'Game targeting controls when TacHen starts a plugin. The plugin itself must support your game and firmware.'), status, actions);
  form.onsubmit = async event => {
    event.preventDefault(); start.disabled = true;
    try {
      await api('/api/command', { command: 'plugin.register', args: { upload: item.id, scope: scope.value, revision,
        target: scope.value === 'game' ? { titleId: title.value.trim(), version: version.value.trim() } : null } });
      dialog.close(); await refresh(); notice('Plugin registered. Open Plugins to start it or enable autostart.');
    } catch (error) { status.textContent = error.message; start.disabled = false; }
  };
  dialog.append(el('h2', '', 'Register ' + item.name), form); dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}
async function loadLibrary(rescan = false, offset = 0) {
  if (libraryBusy) return; libraryBusy = true;
  $('#library-status').textContent = rescan ? 'Reading your game library…' : 'Searching cached library…';
  try {
    if (rescan) await api('/api/command', { command: 'library.refresh', args: {} });
    const { result } = await api('/api/command', { command: 'library.list', args: { search: $('#library-search').value, offset } });
    libraryPage = result;
    $('#library-games').replaceChildren(...(result.games.length ? result.games.map(game => {
      const node = row(game.name, `${game.titleId} · ${game.platform.toUpperCase()} · ${game.sourceType}`, game.installedPackage ? 'Installed package' : game.mounted ? 'Mounted' : 'Unmounted');
      if (game.canMount && game.sourceAvailable && result.available) {
        const button = el('button', '', game.mounted ? 'Unmount' : 'Mount');
        button.onclick = async () => { await command('job.enqueue', { kind: 'library.mount', input: { titleId: game.titleId, path: game.path, contentId: game.contentId, mounted: !game.mounted }, key: requestKey() });
          $('#library-status').textContent = 'Follow the operation in Activity, then refresh the library.'; };
        const manage = el('button', '', 'Manage files'); manage.onclick = () => storageDialog(game);
        node.append(button, manage);
      }
      return node;
    }) : [el('p', 'empty', 'No matching games in the current library.') ]));
    $('#library-status').textContent = `${result.total} games${result.total ? ` · Showing ${result.offset + 1}–${result.offset + result.games.length}` : ''}`;
  } catch (error) { $('#library-status').textContent = error.message; }
  finally { libraryBusy = false; await refresh(); }
}
function formatBytes(value) {
  if (!Number.isFinite(value)) return 'Unknown size';
  return value >= 1073741824 ? `${(value / 1073741824).toFixed(1)} GiB` : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MiB`
    : value >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value} bytes`;
}
async function storageDialog(game) {
  const dialog = el('dialog', 'storage-dialog'), heading = el('h2', '', 'Manage game files');
  const form = el('form'), operation = el('select'), destination = el('select');
  heading.id = 'storage-heading'; dialog.setAttribute('aria-labelledby', heading.id);
  for (const [value, label] of [['copy', 'Copy to another drive'], ['move', 'Move to another drive'],
    ...(game.sourceType === 'image' ? [['unpack', 'Extract image to a folder']] : [])]) {
    const option = el('option', '', label); option.value = value; operation.append(option);
  }
  const operationLabel = el('label', '', 'Action'), destinationLabel = el('label', '', 'Destination');
  operationLabel.append(operation); destinationLabel.append(destination);
  const explanation = el('p', 'fine'), status = el('p', 'fine', 'Reading available drives…'); status.setAttribute('role', 'status');
  const start = el('button', '', 'Start operation'), cancel = el('button', '', 'Back');
  cancel.type = 'button'; cancel.onclick = () => dialog.close(); start.disabled = true;
  const explain = () => { explanation.textContent = operation.value === 'move'
    ? 'Moves the source to the selected drive. On different drives, ShadowMount copies it completely before removing the original. Close the game first.'
    : operation.value === 'unpack' ? 'Extracts the game into a folder and keeps the original image. Close the game first.'
    : 'Copies the complete source and keeps the original. Existing destination files are never overwritten. Close the game first.'; };
  operation.onchange = explain; explain();
  const actions = el('div', 'actions'); actions.append(start, cancel);
  form.append(operationLabel, destinationLabel, explanation, status, actions);
  dialog.append(heading, el('p', '', game.name), el('p', 'fine source-path', game.path), form);
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
  let volumes = [], key = requestKey();
  try {
    const { result } = await api('/api/command', { command: 'storage.destinations', args: {} });
    if (!dialog.isConnected) return; volumes = result.destinations;
    for (const item of volumes) { const option = el('option', '', `${item.path} · ${formatBytes(item.availableBytes)} free`); option.value = item.path; destination.append(option); }
    status.textContent = volumes.length ? 'Progress continues in Activity after you close this page.' : 'No writable managed destinations are available.';
    start.disabled = !volumes.length;
  } catch (error) { status.textContent = error.message; }
  form.onsubmit = async event => {
    event.preventDefault(); if (start.disabled) return;
    const volume = volumes.find(item => item.path === destination.value); if (!volume) return;
    start.disabled = true; operation.disabled = true; destination.disabled = true;
    // Keep the original identity and selected request on a lost response.
    // A retry is safe because the coordinator deduplicates the same key.
    try {
      await api('/api/command', { command: 'job.enqueue', args: { kind: 'library.storage', key,
        input: { operation: operation.value, titleId: game.titleId, path: game.path, contentId: game.contentId,
          destination: destination.value, volume } } });
      dialog.close(); notice('Storage operation queued. Follow progress in Activity.'); await refresh();
    } catch (error) { status.textContent = error.message; start.textContent = 'Check / retry same request'; start.disabled = false; }
  };
}
$('#library-refresh').onclick = () => loadLibrary(true);
$('#library-find').onclick = () => loadLibrary(false);
$('#library-search').onkeydown = event => { if (event.key === 'Enter') loadLibrary(false); };
$('#library-previous').onclick = () => loadLibrary(false, Math.max(0, libraryPage.offset - 100));
$('#library-next').onclick = () => loadLibrary(false, libraryPage.offset + 100);
for (const [key, name, detail] of [['fps', 'FPS', 'Game frame rate'], ['ram', 'RAM', 'Memory use'], ['cpu', 'CPU', 'Processor activity'], ['ip', 'Console IP', 'Bottom-right corner'], ['adaptive', 'Adaptive notices', 'Show useful changes briefly']]) {
  const label = el('label', 'setting'), text = el('span', '', name), input = el('input'); text.append(el('small', '', detail));
  input.type = 'checkbox'; input.dataset.overlay = key; input.onchange = () => command('settings.update', { patch: { overlay: { [key]: input.checked } }, revision: state.revision });
  label.append(text, input); $('#overlay-settings').append(label);
}
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => {
  for (const tab of document.querySelectorAll('[data-view]')) { tab.classList.toggle('active', tab === button); if (tab === button) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); }
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== button.dataset.view;
};
$('#accent').onchange = () => command('settings.update', { patch: { appearance: { accent: $('#accent').value } }, revision: state.revision });
$('#reduced-motion').onchange = () => command('settings.update', { patch: { appearance: { reducedMotion: $('#reduced-motion').checked } }, revision: state.revision });
$('#mcp-enabled').onchange = () => command('settings.update', { patch: { developer: { enabled: $('#mcp-enabled').checked } }, revision: state.revision });
$('#mcp-writes').onchange = () => command('settings.update', { patch: { developer: { memoryWrites: $('#mcp-writes').checked } }, revision: state.revision });
$('#mcp-create').onclick = async () => {
  if (busy) return;busy = true;
  try {
    const { result } = await api('/api/command', { command: 'developer.connect', args: {} });
    $('#mcp-url').value = location.origin + result.path;$('#mcp-token').value = 'Bearer ' + result.token;
    $('#mcp-connection').hidden = false;$('#mcp-status').textContent = 'Connection ready. Access expires at ' + new Date(result.expires).toLocaleTimeString() + '.';
  } catch (error) { $('#mcp-status').textContent = error.message; }
  finally { busy = false; }
};
$('#mcp-revoke').onclick = async () => {
  if (busy) return;busy = true;
  try { await api('/api/command', { command: 'developer.disconnect', args: {} });$('#mcp-token').value = '';$('#mcp-connection').hidden = true;$('#mcp-status').textContent = 'MCP clients disconnected. A read already in progress will finish its resume check; no further scan chunks will start.'; }
  catch (error) { $('#mcp-status').textContent = error.message; }
  finally { busy = false; }
};
$('#mcp-select').onclick = () => { $('#mcp-token').focus();$('#mcp-token').select(); };
$('#payload-file').onchange = async event => {
  const file = event.target.files[0]; if (!file || busy) return; busy = true;
  try {
    const { result } = await api('/api/command', { command: 'inbox.begin', args: { name: file.name, bytes: file.size } });
    for (let offset = 0; offset < file.size;) {
      const chunk = file.slice(offset, offset + 1024 * 1024);
      const response = await fetch(`/api/uploads/${result.id}?offset=${offset}`, { method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-TacHen-CSRF': csrf }, body: chunk });
      const progress = await response.json(); if (!response.ok) throw new Error(progress.error?.message || 'Upload failed.');
      offset = progress.offset; $('#upload-progress').textContent = `Uploading ${file.name}: ${Math.floor(offset / file.size * 100)}%`;
    }
    $('#upload-progress').textContent = 'Checking file structure and checksum…';
    await api('/api/command', { command: 'inbox.verify', args: { id: result.id } });
    $('#upload-progress').textContent = `${file.name} uploaded and verified. It has not been executed.`; await refresh();
  } catch (error) { $('#upload-progress').textContent = error.message; }
  finally { busy = false; event.target.value = ''; }
};
$('#package-stop').onclick = () => { packageStop = true; $('#package-progress').textContent = 'Stopping after the current chunk…'; };
$('#package-file').oncancel = () => { packageResume = null; };
$('#package-file').onchange = async event => {
  const file = event.target.files[0]; if (!file || packageUploading) return;
  const resume = packageResume; packageResume = null; packageUploading = true; packageStop = false; draw();
  let entry;
  try {
    if (resume) {
      if (file.name !== resume.name || file.size !== resume.bytes) throw Error('Choose the exact original package: its name and size must match.');
      ({ result: entry } = await api('/api/command', { command: 'package.status', args: { id: resume.id } }));
      if (entry.status !== 'uploading') throw Error('This file is no longer awaiting upload. Refresh its status.');
    } else {
      const hash = $('#package-hash').value.trim().toLowerCase();
      if (hash && !/^[a-f0-9]{64}$/.test(hash)) throw Error('Expected SHA-256 must contain exactly 64 hexadecimal characters.');
      ({ result: entry } = await api('/api/command', { command: 'package.begin', args: { name: file.name, bytes: file.size, ...(hash ? { sha256: hash } : {}) } }));
    }
    for (let offset = entry.offset; offset < file.size;) {
      if (packageStop) throw Error('Upload stopped. Completed chunks were retained; use Resume upload to continue.');
      const response = await fetch(`/api/package-uploads/${entry.id}?offset=${offset}`, { method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-TacHen-CSRF': csrf }, body: file.slice(offset, offset + 1024 * 1024) });
      const result = await response.json(); if (!response.ok) throw Error(result.error?.message || 'Package upload failed.');
      offset = result.offset; $('#package-progress').textContent = `${file.name}: ${Math.floor(offset / file.size * 100)}% · ${formatBytes(offset)} / ${formatBytes(file.size)}`;
    }
    await api('/api/command', { command: 'job.enqueue', args: { kind: 'package.verify', input: { id: entry.id }, key: requestKey() } });
    $('#package-progress').textContent = 'Upload complete. Verification is running in Activity; you may close this page.';
  } catch (error) { $('#package-progress').textContent = error.message; }
  finally { packageUploading = false; event.target.value = ''; await refresh(); }
};
$('#disconnect').onclick = async () => {
  try { await api('/api/disconnect', {}); connected = false; clearTimeout(timer); $('#mcp-token').value = '';$('#mcp-connection').hidden = true;$('#connection').textContent = 'Disconnected'; notice('Disconnected. Reload this page to reconnect.'); }
  catch (error) { notice(error.message); }
};
async function refresh() {
  if (!connected) return;
  try { state = await api('/api/state');
    if (state.saves?.updatedAt && savePage.updatedAt !== state.saves.updatedAt) await loadSaves(0);
    if (cheatPack && !$('#cheats').hidden) ({ result: cheatPack } = await api('/api/command', { command: 'cheat.inspect', args: { sha256: cheatPack.sha256 } }));
    draw(); }
  catch (error) { $('#connection').textContent = 'Connection unavailable'; notice(error.message); }
}
async function poll() { if (!connected) return; if (!document.hidden && !busy) await refresh(); timer = setTimeout(poll, document.hidden ? 15000 : 2500); }
try { const session = await api('/api/session', {}); csrf = session.csrf; state = session.state; draw(); timer = setTimeout(poll, 2500); }
catch (error) { $('#connection').textContent = 'Connection unavailable'; notice(error.message); }
