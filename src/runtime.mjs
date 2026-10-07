// SPDX-License-Identifier: GPL-3.0-or-later
import { clone, invariant, TacError } from './errors.mjs';
import { mergeSettings } from './settings.mjs';
import { requireFirmware } from './firmware.mjs';
import { ServiceGraph } from './services.mjs';
import { JobQueue } from './jobs.mjs';

export const FEATURES = Object.freeze([
  ['deck', 'Command deck'], ['game-overlay', 'In-game command deck'], ['phone', 'Phone control'],
  ['payloads', 'Payload loader'], ['ftp', 'FTP server'], ['inbox', 'Payload inbox'],
  ['packages', 'Background package installation'], ['shadowmount', 'ShadowMount library'],
  ['kstuff', 'kstuff readiness'], ['payload-manager', 'Payload Manager'], ['plugins', 'System and game plugins'],
  ['fps', 'Game FPS'], ['resources', 'Resource overlay'], ['ip-overlay', 'IP overlay'],
  ['cheats', 'Game cheats'], ['saves', 'Save extraction and export'], ['mcp', 'Developer MCP'],
  ['profiles', 'Game loadouts'], ['updates', 'Staged updates and rollback']
]);
export class TacRuntime {
  constructor(store, platform, { id, now = Date.now } = {}) {
    this.store = store; this.platform = platform; this.id = id; this.now = now;
    this.sequence = 0; this.session = id(); this.game = null; this.started = false;
    this.inboxItems = [];
    this.graph = new ServiceGraph({ changed: () => this.sequence++ });
    this.jobs = new JobQueue(store, { id, now, changed: () => this.sequence++ });
    this.capabilities = new Map(FEATURES.map(([id, name]) => [id,
      { id, name, available: false, reason: 'Native integration is not installed in this build.' }]));
  }
  capability(id, available, reason = null) {
    invariant(this.capabilities.has(id), 'FEATURE_UNKNOWN', 'Unknown capability.');
    Object.assign(this.capabilities.get(id), { available, reason }); this.sequence++;
  }
  async start() {
    invariant(!this.started, 'ALREADY_STARTED', 'TacHen is already started.');
    this.identity = await this.platform.identity();
    if (this.identity.mode === 'console') requireFirmware(this.identity.firmware);
    const prior = this.store.snapshot();
    this.graph.safe = prior.startup.pending || this.store.recovered || prior.startup.safe;
    await this.store.transaction(state => {
      state.startup = { pending: true, session: this.session, safe: this.graph.safe };
      if (this.graph.safe) state.settings = clone(state.knownGood);
      // Authorization to write memory is deliberately never carried across boots.
      state.settings.developer.memoryWrites = false;
    });
    await this.jobs.recover();
    await this.platform.install(this);
    this.graph.validate(); this.started = true;
    // 'ready' here covers this coordinator only, never unstarted native services.
    await this.store.transaction(state => { state.startup.pending = false; });
    this.capability('deck', true); this.capability('phone', true);
    return this;
  }
  snapshot() {
    const state = this.store.snapshot();
    return { name: 'TacHen', version: '0.1.0-dev', sequence: this.sequence, revision: state.revision,
      session: this.session, identity: this.identity, safe: this.graph.safe, game: this.game,
      settings: state.settings, services: this.graph.snapshot(), capabilities: [...this.capabilities.values()].map(clone),
      inbox: clone(this.inboxItems), jobs: state.jobs.map(({ key, signature, args, ...job }) => job),
      history: state.history.filter(entry => entry.session === this.session),
      queue: { halted: this.jobs.halted, error: this.jobs.fault } };
  }
  async settings(patch, revision) {
    invariant(Number.isSafeInteger(revision), 'REVISION_REQUIRED', 'Settings require the displayed state revision.', { status: 400 });
    // A setting is not a claim that the associated renderer or service exists.
    const requested = mergeSettings(this.store.snapshot().settings, patch);
    const guarded = [['fps', requested.overlay.fps], ['resources', requested.overlay.ram || requested.overlay.cpu],
      ['ip-overlay', requested.overlay.ip], ['mcp', requested.developer.enabled], ['payloads', requested.services.inboxAutoRun]];
    for (const [feature, enabled] of guarded) if (enabled) invariant(this.capabilities.get(feature).available,
      'FEATURE_UNAVAILABLE', this.capabilities.get(feature).reason);
    await this.store.transaction(state => {
      state.settings = mergeSettings(state.settings, patch);
      state.history.push({ id: this.id(), session: this.session, at: this.now(), type: 'settings',
        message: 'Preferences changed', fields: Object.keys(patch), undo: false });
      state.history = state.history.slice(-256);
    }, revision);
    this.sequence++; return this.snapshot();
  }
  async execute(command, args) {
    invariant(this.started, 'NOT_READY', 'TacHen startup is incomplete.');
    switch (command) {
      case 'settings.update': return this.settings(args.patch, args.revision);
      case 'inbox.begin': {
        invariant(this.inbox, 'FEATURE_UNAVAILABLE', 'Payload inbox is not installed.');
        const result = await this.inbox.begin(args); this.inboxItems = await this.inbox.list(); return result;
      }
      case 'inbox.verify': {
        invariant(this.inbox, 'FEATURE_UNAVAILABLE', 'Payload inbox is not installed.');
        const result = await this.inbox.verify(args.id); this.inboxItems = await this.inbox.list(); return result;
      }
      case 'inbox.list': {
        invariant(this.inbox, 'FEATURE_UNAVAILABLE', 'Payload inbox is not installed.');
        return this.inboxItems = await this.inbox.list();
      }
      case 'job.enqueue': return this.jobs.enqueue(args.kind, args.input, args.key);
      case 'job.cancel': await this.jobs.cancel(args.id); break;
      case 'job.resume': await this.jobs.resume(args.id); break;
      case 'job.reconcile': await this.jobs.reconcile(args.id); break;
      case 'service.start': {
        // Return immediately so a phone request does not outlive its connection.
        // The graph and durable startup job publish the actual result separately.
        this.graph.start(args.id).catch(() => { this.sequence++; }); break;
      }
      case 'service.reconcile': await this.graph.reconcile(args.id); break;
      default: throw new TacError('COMMAND_UNKNOWN', 'Unknown command.', { status: 404 });
    }
    return this.snapshot();
  }
  async close() { this.nativeServices?.stopMonitoring(); this.jobs.stopDispatch(); await this.store.tail; }
}
