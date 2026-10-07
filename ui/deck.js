// SPDX-License-Identifier: GPL-3.0-or-later
let csrf, state, connected = true, timer, busy = false;
let libraryPage = { games: [], total: 0, offset: 0 }, libraryBusy = false;
let packageUploading = false, packageStop = false, packageResume = null;
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
function draw() {
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
      'payload.dispatch': 'Load payload', 'plugin.start': 'Start plugin', 'game.module.start': 'Load game module', 'deck.start': 'Start command deck' }[job.kind] || job.kind;
    const node = row(title, job.error?.message || job.result?.message || job.progress?.phase || 'Waiting for execution',
      job.result?.phase === 'dispatched' && job.status === 'completed' ? 'Dispatched' : job.status, job.status === 'completed');
    node.classList.add('job-row');
    const actions = el('div', 'actions');
    if (job.progress?.total > 0) {
      const progress = el('progress'); progress.max = job.progress.total; progress.value = job.progress.completed;
      progress.setAttribute('aria-label', 'Operation progress'); node.append(progress,
        el('small', '', `${Math.floor(job.progress.completed / job.progress.total * 100)}% · ${formatBytes(job.progress.completed)} / ${formatBytes(job.progress.total)}`));
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
  try { await api('/api/disconnect', {}); connected = false; clearTimeout(timer); $('#connection').textContent = 'Disconnected'; notice('Disconnected. Reload this page to reconnect.'); }
  catch (error) { notice(error.message); }
};
async function refresh() {
  if (!connected) return;
  try { state = await api('/api/state'); draw(); }
  catch (error) { $('#connection').textContent = 'Connection unavailable'; notice(error.message); }
}
async function poll() { if (!connected) return; if (!document.hidden && !busy) await refresh(); timer = setTimeout(poll, document.hidden ? 15000 : 2500); }
try { const session = await api('/api/session', {}); csrf = session.csrf; state = session.state; draw(); timer = setTimeout(poll, 2500); }
catch (error) { $('#connection').textContent = 'Connection unavailable'; notice(error.message); }
