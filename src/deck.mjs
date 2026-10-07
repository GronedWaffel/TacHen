// SPDX-License-Identifier: GPL-3.0-or-later
// Controller presentation uses the same commands, validation and durable jobs as
// the phone. No privileged operation is implemented inside the renderer.
import { invariant } from './errors.mjs';

export const DECK_WIRE = Object.freeze({ magic: 0x54414344, version: 1, bytes: 2800, rows: 8, rowBytes: 292 });
const pages = ['Home', 'Payloads', 'Games', 'Activity', 'Preferences'];
function text(buffer, offset, bytes, value) {
  const input = Buffer.from(String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' '));
  let length = Math.min(input.length, bytes - 1);
  // Do not split a UTF-8 code point at a fixed-width wire boundary.
  while (length < input.length && length && (input[length] & 0xc0) === 0x80) length--;
  input.copy(buffer, offset, 0, length);
}
export function encodeDeck(frame) {
  invariant(frame.rows.length <= 8, 'DECK_LIMIT', 'Too many deck rows.');
  const out = Buffer.alloc(DECK_WIRE.bytes);
  out.writeUInt32LE(DECK_WIRE.magic, 0); out.writeUInt16LE(1, 4);
  out.writeUInt16LE((frame.ready ? 1 : 0) | (frame.ipVisible ? 2 : 0), 6);
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
  return out;
}

export class ConsoleDeck {
  constructor(runtime) {
    this.runtime = runtime; this.page = 0; this.offset = 0; this.sequence = 0;
    this.signature = ''; this.current = null; this.requests = new Map(); this.tail = Promise.resolve();
    this.notice = ''; this.confirmation = null;
  }
  frame() {
    const runtime = this.runtime, state = runtime.snapshot();
    const items = [], row = (label, detail, command = null, args = {}, extra = {}) =>
      items.push({ label, detail, enabled: Boolean(command), command, args, ...extra });
    const feature = name => state.capabilities.find(x => x.id === name)?.available;
    if (this.confirmation) {
      row('Confirm: ' + this.confirmation.label, this.confirmation.detail, '$confirm');
      row('Cancel', 'Return without making changes', '$cancel');
    } else if (this.page === 0) {
      row('Your phone is a second controller', `Open http://${state.identity.ip}:8780 on the same network`);
      row(state.game?.name || 'Dashboard', state.game ? `${state.game.titleId} · ${state.game.version}` : state.gameStatus?.message || `Firmware ${state.identity.firmware || 'development'}`);
      for (const service of state.services.slice(0, 5))
        row(service.id, service.error?.message || service.phase || service.status,
          service.status === 'stopped' && !state.safe ? 'service.start' : null, { id: service.id });
      if (state.safe) row('Recovery startup', 'Automatic native startup is paused. Review Activity before retrying.');
    } else if (this.page === 1) {
      for (const item of state.inbox.filter(x => x.status === 'verified')) {
        const runnable = /\.elf$/i.test(item.name) && feature('payloads') && !runtime.componentHashes?.has(item.expectedSha256);
        row(item.name, runnable ? 'Run this verified payload' : 'Managed component or plugin; use its dedicated controls',
          runnable ? 'job.enqueue' : null, { kind: 'payload.dispatch', input: { id: item.id } }, { confirm: true });
      }
      if (!items.length) row('Payload inbox is empty', 'Upload from your phone or FTP into /payloads');
    } else if (this.page === 2) {
      row('Refresh library', runtime.libraryState?.error?.message || 'Read games from ShadowMount', runtime.library ? 'library.refresh' : null);
      for (const game of runtime.libraryState?.games || []) {
        const usable = feature('shadowmount') && game.sourceAvailable && game.canMount && !game.installedPackage;
        row(game.name, `${game.titleId} · ${game.platform} · ${game.mounted ? 'Mounted' : 'Not mounted'}`,
          usable ? 'job.enqueue' : null, { kind: 'library.mount', input: { titleId: game.titleId, path: game.path,
            contentId: game.contentId, mounted: !game.mounted } }, { confirm: true });
      }
    } else if (this.page === 3) {
      for (const job of [...state.jobs].reverse()) row(job.kind, `${job.status}: ${job.error?.message || job.progress?.message || ''}`);
      if (!items.length) row('Nothing is running', 'Transfers and payload jobs appear here');
    } else {
      for (const [key, label, capability] of [['ip', 'IP address on screen', 'ip-overlay'], ['fps', 'Game FPS', 'fps'],
        ['ram', 'Memory usage', 'resources'], ['cpu', 'CPU usage', 'resources']])
        row(label, feature(capability) ? (state.settings.overlay[key] ? 'On' : 'Off') : 'Renderer is not ready',
          feature(capability) ? 'settings.update' : null,
          { revision: state.revision, patch: { overlay: { [key]: !state.settings.overlay[key] } } }, { on: state.settings.overlay[key] });
      row('Reduced motion', state.settings.appearance.reducedMotion ? 'On' : 'Off', 'settings.update',
        { revision: state.revision, patch: { appearance: { reducedMotion: !state.settings.appearance.reducedMotion } } }, { on: state.settings.appearance.reducedMotion });
    }
    // Six content rows leave room for navigation on long libraries/inboxes.
    this.offset = Math.min(this.offset, Math.max(0, Math.floor((items.length - 1) / 6) * 6));
    let selected = items.slice(this.offset, this.offset + 6);
    if (this.offset) selected.push({ label: 'Previous items', detail: '', enabled: true, command: '$previous' });
    if (this.offset + 6 < items.length) selected.push({ label: 'More items', detail: '', enabled: true, command: '$next' });
    const data = { ready: true, ipVisible: state.settings.overlay.ip, ip: state.identity.ip,
      page: this.page, title: `TacHen / ${this.confirmation ? 'Confirm action' : pages[this.page]}`,
      subtitle: this.notice || (state.safe ? 'Recovery startup' : 'Your console. Your controls.'),
      footer: 'L1 / R1 sections    X select    Circle back    L3 + R3 close', rows: selected };
    const signature = JSON.stringify(data);
    if (signature !== this.signature) {
      this.signature = signature; this.sequence = (this.sequence + 1) >>> 0 || 1;
      this.current = { ...data, sequence: this.sequence, rows: selected.map(item => ({ ...item, token: runtime.id() })) };
    }
    return this.current;
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
      if (input.kind === 'next' || input.kind === 'previous') {
        this.page = (this.page + (input.kind === 'next' ? 1 : pages.length - 1)) % pages.length;
        this.offset = 0; this.confirmation = null; this.notice = ''; return this.frame();
      }
      if (input.kind === 'back') { this.confirmation = null; this.page = 0; this.offset = 0; this.notice = ''; return this.frame(); }
      invariant(input.kind === 'select' && Number.isInteger(input.row) && input.row >= 0 && input.row < frame.rows.length,
        'DECK_ACTION', 'Invalid deck action.', { status: 400 });
      const selected = frame.rows[input.row];
      invariant(selected.enabled, 'DECK_DISABLED', 'This action is not available.');
      if (selected.command === '$previous') this.offset -= 6;
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
  async dispatch(row, key) {
    try {
      this.notice = 'Working. Progress is shared with your phone.';
      if (row.command === 'library.refresh') {
        this.runtime.execute(row.command, row.args || {}).then(() => { this.notice = 'Library refreshed.'; }, error => { this.notice = error.message; });
        return;
      }
      await this.runtime.execute(row.command, row.command === 'job.enqueue' ? { ...row.args, key } : row.args || {});
      this.notice = row.command === 'job.enqueue' ? 'Accepted. Follow progress in Activity.' : 'Updated.';
    } catch (error) { this.notice = error.message; throw error; }
  }
}
