// SPDX-License-Identifier: GPL-3.0-or-later
let csrf, state, connected = true, timer, busy = false;
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
function draw() {
  document.body.dataset.accent = state.settings.appearance.accent;
  document.body.dataset.reducedMotion = String(state.settings.appearance.reducedMotion);
  $('#connection').textContent = 'Connected locally';
  $('#address').textContent = state.identity.ip;
  $('#firmware').textContent = state.identity.firmware ? 'PS5 · ' + state.identity.firmware : 'Local development · No PS5 connection';
  $('#context-title').textContent = state.game?.name || 'Command deck';
  $('#context-detail').textContent = state.game ? `${state.game.titleId} · ${state.game.version}` : 'Everything starts with a reliable session.';
  $('#session-title').textContent = state.safe ? 'Safe startup' : state.identity.mode === 'development' ? 'Development workspace' : 'TacHen coordinator online';
  $('#session-detail').textContent = state.safe ? 'Optional components are held while the previous startup is reviewed.' :
    state.identity.mode === 'development' ? 'Explore the deck locally. Native console integrations are listed honestly below.' : 'Use the deck from your console or phone. Component readiness is tracked separately.';
  $('#session-chips').replaceChildren(...[state.safe ? 'Optional startup held' : 'Shared state', 'No cloud account', 'Hardware validation pending'].map(text => el('span', 'chip', text)));
  $('#services').replaceChildren(...(state.services.length ? state.services.map(service => row(service.id, service.error?.message, service.status, service.status === 'ready')) : [el('p', 'empty', 'No native services started in this build.') ]));
  const available = state.capabilities.filter(item => item.available);
  $('#available-count').textContent = `${available.length} of ${state.capabilities.length} integrations`;
  $('#capabilities').replaceChildren(...available.map(item => { const card = el('article', 'cap'); card.append(el('span', 'indicator', 'AVAILABLE'), el('h3', '', item.name), el('p', '', item.reason || 'Connected to the shared TacHen runtime.')); return card; }));
  $('#component-list').replaceChildren(...state.capabilities.map(item => row(item.name, item.reason, item.available ? 'Available' : 'Not integrated', item.available)));
  $('#payload-file').disabled = !capability('inbox')?.available;
  $('#inbox-items').replaceChildren(...(state.inbox?.length ? state.inbox.map(item => row(item.name,
    `${(item.offset / 1048576).toFixed(1)} / ${(item.bytes / 1048576).toFixed(1)} MiB`, item.status, item.status === 'verified')) : [el('p', 'empty', 'Uploaded payloads will appear here.') ]));
  const active = state.jobs.filter(job => !['completed', 'cancelled', 'failed'].includes(job.status)); $('#job-count').textContent = active.length;
  $('#jobs').replaceChildren(...(state.jobs.length ? [...state.jobs].reverse().map(job => {
    const node = row(job.kind, job.error?.message || job.progress?.phase || 'Waiting for execution', job.status, job.status === 'completed');
    const actions = el('div', 'actions');
    for (const [label, action, show] of [['Cancel', 'cancel', ['queued', 'held'].includes(job.status)], ['Resume', 'resume', job.status === 'held'], ['Check result', 'reconcile', job.status === 'interrupted']]) {
      if (!show) continue; const button = el('button', '', label); button.onclick = () => command('job.' + action, { id: job.id }); actions.append(button);
    }
    if (actions.children.length) node.append(actions); return node;
  }) : [el('p', 'empty', 'No background operations yet.') ]));
  $('#history').replaceChildren(...(state.history.length ? [...state.history].reverse().map(item => row(item.message, item.fields?.join(', '), new Date(item.at).toLocaleTimeString())) : [el('p', 'empty', 'Changes made during this session will appear here.') ]));
  $('#accent').value = state.settings.appearance.accent; $('#reduced-motion').checked = state.settings.appearance.reducedMotion;
  for (const input of document.querySelectorAll('[data-overlay]')) {
    const key = input.dataset.overlay; input.checked = state.settings.overlay[key];
    const needed = { fps: 'fps', ram: 'resources', cpu: 'resources', ip: 'ip-overlay' }[key];
    input.disabled = needed ? !capability(needed)?.available : false;
  }
}
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
