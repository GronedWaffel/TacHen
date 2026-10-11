// SPDX-License-Identifier: GPL-3.0-or-later
import { canonical, clone, invariant, TacError, publicError } from './errors.mjs';
import { validatePlugin } from './plugin-schema.mjs';
import { GameModules } from './game-modules.mjs';
import { waitForNativeProbe } from './native-readiness.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = (code, message) => Object.assign(new TacError(code, message), { noSideEffects: true });
const matches = (target, game) => target && game && target.titleId === game.titleId && target.version === game.version;

// These containers are standalone plugin processes. A game target controls
// manual loadout selection; it does not constrain third-party code.
export class Plugins {
  constructor(runtime, native, { delay = sleep, interval = 5000, log = () => {} } = {}) {
    this.runtime = runtime; this.native = native; this.delay = delay; this.interval = interval;
    this.log = message => { try { log('TacHen plugin registration: ' + message); } catch {} };
    this.attempts = new Set(); this.observations = new Map(); this.pending = null; this.stopped = true;
    runtime.jobs.register('plugin.start', this.handler());
    this.modules = new GameModules(this);
  }
  entries() { return this.runtime.store.snapshot().plugins; }
  find(sha256) {
    const item = this.entries().find(item => item.sha256 === sha256);
    invariant(item, 'PLUGIN_MISSING', 'Register this plugin from the payload inbox first.'); return item;
  }
  async register(input) {
    let phase = 'verify';
    try {
      invariant(input && Number.isSafeInteger(input.revision), 'REVISION_REQUIRED', 'Refresh the plugin list before making changes.');
      const info = await this.runtime.inbox.verify(input.upload);
      phase = 'target';
      this.log(`verified format=${info.format} container=${info.container || 'unknown'} platform=${info.platform || 'selected-game'}`);
      const module = ['prx', 'sprx'].includes(info.format);
      invariant(info.format === 'plugin' || module && input.scope === 'game', 'PLUGIN_FORMAT', 'Native PRX modules require a specific game target.');
      const item = validatePlugin({ ...info, upload: info.id, scope: input.scope, target: input.target ?? null, autostart: false,
        ...(module ? { pluginId: 'module:' + info.sha256, pluginVersion: null,
          platform: info.platform || (/^(PPSA|PPSB|MOUU)/.test(input.target?.titleId) ? 'ps5' : 'ps4') } : {}) });
      phase = 'save';
      // Registration only adds this verified identity and explicit target.
      // Background jobs can advance the global revision during verification;
      // merge into current state and check duplicates inside the transaction.
      await this.runtime.store.transaction(state => {
        invariant(!state.plugins.some(other => other.sha256 === item.sha256 || other.pluginId === item.pluginId),
          'PLUGIN_CONFLICT', 'This file or plugin identity is already registered.');
        state.plugins.push(item);
        this.runtime.changes.record(state, { change: 'plugin-register', target: item.sha256, after: item,
          message: 'Plugin registered', detail: 'Registration adds a verified file to the catalog; it does not load the code.' });
      });
      this.log(`saved format=${item.format} platform=${item.platform || 'standalone'} title=${item.target?.titleId || 'none'} version=${item.target?.version || 'none'}`);
      this.runtime.sequence++; return this.list();
    } catch (error) {
      const code = /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNKNOWN';
      this.log(`failed phase=${phase} code=${code}`); throw error;
    }
  }
  async configure({ sha256, autostart, revision }) {
    invariant(typeof autostart === 'boolean' && Number.isSafeInteger(revision), 'PLUGIN_CONFIG', 'Choose an autostart setting from the current list.');
    invariant(autostart === false, 'PLUGIN_MANUAL_ONLY', 'Plugin autostart has been removed. Load plugins manually once you are in game.');
    await this.runtime.store.transaction(state => {
      const item = state.plugins.find(item => item.sha256 === sha256);
      invariant(item, 'PLUGIN_MISSING', 'Plugin is no longer registered.');
      const before = item.autostart;item.autostart = autostart;
      this.runtime.changes.record(state, { change: 'plugin-config', target: sha256, before, after: autostart,
        message: 'Plugin autostart changed', detail: 'Autostart affects future launches; loaded code stays resident.' });
    }, revision);
    this.runtime.sequence++; return this.list();
  }
  list(state=this.runtime.store.snapshot()) {
    const pendingFiles=new Set(state.jobs.filter(job=>['plugin.start','game.module.start'].includes(job.kind)&&!['completed','failed','cancelled'].includes(job.status)).map(job=>job.args.sha256));
    const held=this.runtime.graph.safe||this.runtime.recovery?.pending;
    return state.plugins.map(item => {
      const module=item.format!=='plugin';let observation=clone(this.observations.get(item.sha256)||{
        phase:'uninspected',message:module?'Game module state has not been checked.':'Process state has not been checked.'});
      // A sampled 'loaded' label belongs to one process instance. Do not let
      // it disable a reopened game while the next plugin census is pending.
      if(module&&observation.generation&&this.runtime.game?.generation&&observation.generation!==this.runtime.game.generation)
        observation={phase:'stopped',message:'New game instance detected. Ready to load for this session.'};
      const pending=pendingFiles.has(item.sha256);
      const targetReady=!module||matches(item.target,this.runtime.game)&&item.platform===this.runtime.game.platform;
      const reason=held?'Startup recovery is holding native operations.':pending?'An existing operation must finish or be reconciled first.':!targetReady?
        'Open the exact target game and version, then load the plugin manually.':
        !['stopped','armed','uninspected','failed','held','cancelled'].includes(observation.phase)?observation.message||'Review the existing plugin operation before starting another.':null;
      return {...item,observation,controls:{canStart:!reason,startReason:reason,jobKind:module?'game.module.start':'plugin.start',
        startLabel:module?'Load into game':'Start now',lifetime:module?'Resident until the target game closes.':
          'Loaded code remains resident; closing this menu does not undo its patches.'}};
    });
  }
  handler() {
    const self = this, runtime = this.runtime;
    const validate = async input => {
      invariant(input && /^[a-f0-9]{64}$/.test(input.sha256) && ['manual', 'automatic', 'profile'].includes(input.source),
        'PLUGIN_INPUT', 'Choose a registered plugin and launch mode.');
      invariant(input.source !== 'automatic', 'PLUGIN_MANUAL_ONLY', 'Plugins load manually. It is recommended to not start plugins until you are in game.');
      const item = self.find(input.sha256), configuration = canonical(item);
      invariant(item.format === 'plugin', 'PLUGIN_FORMAT', 'This file is a game module; use the native module loader.');
      invariant(!runtime.graph.safe, 'SAFE_STARTUP', 'Plugin startup is held during safe startup.');
      const probe = await waitForNativeProbe(self.native, { delay: self.delay });
      invariant(!probe.busy && probe.kstuff?.injectionReady === true && typeof probe.boot === 'string',
        'PLUGIN_READINESS', 'Wait for verified kstuff readiness before starting a plugin.');
      if (!input.boot) invariant(!runtime.jobs.snapshot().some(job => job.kind === 'plugin.start' &&
        job.args.pluginId === item.pluginId && job.args.boot === probe.boot && !['failed', 'cancelled'].includes(job.status)),
        'PLUGIN_ALREADY_ATTEMPTED', 'This plugin already has an active or unresolved launch in this boot. Check its existing operation.');
      const info = await runtime.inbox.verify(item.upload);
      invariant(info.format === 'plugin' && info.sha256 === item.sha256 && info.pluginId === item.pluginId &&
        info.pluginVersion === item.pluginVersion && canonical(self.find(input.sha256)) === configuration,
        'PLUGIN_CHANGED', 'Plugin bytes or configuration changed before launch.');
      const gameScoped = input.source === 'profile';
      const game = gameScoped ? clone(runtime.game) : null;
      invariant(!gameScoped || game && (item.scope === 'system' || matches(item.target, game)) && typeof game.generation === 'string', 'PLUGIN_GAME_CHANGED', 'The target game changed before launch.');
      const accepted = { sha256: item.sha256, upload: item.upload, pluginId: item.pluginId, pluginVersion: item.pluginVersion,
        source: input.source, boot: probe.boot, generation: game?.generation ?? null, configuration };
      if (input.boot) invariant(input.boot === accepted.boot && input.configuration === configuration && input.generation === accepted.generation,
        'PLUGIN_CONTEXT_CHANGED', 'The accepted plugin context changed. Submit a new launch after reviewing it.');
      return accepted;
    };
    const result = (receipt, input, request) => {
      invariant(receipt?.request === request && receipt.sha256 === input.sha256 && receipt.plugin === true,
        'PLUGIN_RECEIPT', 'Plugin dispatch receipt identity differs from this operation.');
      if (receipt.stage !== 3) return null;
      invariant(receipt.pluginId === input.pluginId && receipt.pluginVersion === input.pluginVersion && Number.isSafeInteger(receipt.pid) && receipt.pid > 1 &&
        typeof receipt.generation === 'string' && /^\d+:\d+\/\d+\/[1-9]\d*:\d+$/.test(receipt.generation) && receipt.generation.startsWith(input.boot + '/' + receipt.pid + '/'),
        'PLUGIN_RECEIPT', 'Plugin process generation was not verified.');
      return { completed: true, phase: 'plugin-dispatched', initialized: false, request, sha256: input.sha256,
        pluginId: input.pluginId, pid: receipt.pid, generation: receipt.generation,
        message: 'Plugin process dispatched. Its own initialization and game behavior are not yet confirmed.' };
    };
    return {
      validate, resources: input => ['native-payload-dispatch', 'plugin:' + input.pluginId], timeout: 120000, cancellable: false,
      guard(input, state) {
        invariant(!state.jobs.some(job => job.kind === 'plugin.start' && job.args.pluginId === input.pluginId &&
          job.args.boot === input.boot && !['failed','cancelled'].includes(job.status)),
        'PLUGIN_ALREADY_ATTEMPTED', 'This plugin already has an active or unresolved launch in this boot. Check its existing operation.');
      },
      async run(input, context) {
        try { await validate(input); } catch (error) { error.noSideEffects = true; throw error; }
        for (;;) {
          try {
            invariant(!context.signal.aborted, 'PLUGIN_CANCELLED', 'Plugin launch ended before native dispatch.');
            // Recheck after waits: never launch into a different game or boot.
            const item = self.find(input.sha256);
            invariant(canonical(item) === input.configuration && (input.source === 'manual' || input.source === 'profile' &&
              runtime.game?.generation === input.generation && (item.scope === 'system' || matches(item.target, runtime.game))),
              'PLUGIN_CONTEXT_CHANGED', 'Plugin startup conditions changed while waiting.');
          } catch (error) { error.noSideEffects = true; throw error; }
          try { self.native.pluginStart(context.id, input.upload, input.sha256); break; }
          catch (error) { if (error.code !== 'LOADER_BUSY') throw error; await self.delay(250); }
        }
        for (;;) {
          const receipt = self.native.loaderPoll(context.id); context.evidence?.(receipt);
          const outcome = result(receipt, input, context.id);
          if (outcome) return outcome;
          if (receipt.stage === 4 && receipt.noSideEffects) throw clean('PLUGIN_REJECTED', receipt.message);
          if (receipt.stage === 4 || receipt.stage === 5) throw new TacError('PLUGIN_UNCERTAIN', receipt.message);
          invariant([1, 2].includes(receipt.stage), 'PLUGIN_RECEIPT', 'Unknown plugin dispatch stage.');
          await context.progress({ completed: 0, total: 1, phase: receipt.stage === 1 ? 'Verifying plugin container' : 'Starting plugin process' });
          await self.delay(250);
        }
      },
      verify: async (result, input) => result.completed && result.phase === 'plugin-dispatched' && result.sha256 === input.sha256 && result.initialized === false,
      async reconcile(job) {
        const receipt = self.native.loaderPoll(job.id);
        if (!receipt) return null;
        const outcome = result(receipt, job.args, job.id);
        return outcome || (receipt.stage === 4 && receipt.noSideEffects ? { absent: true } : null);
      }
    };
  }
  async inspect() {
    this.deferred = false;
    if (this.runtime.recovery?.pending) return;
    if (!this.entries().length) return;
    const probe = this.native.systemProbe();
    if (probe.busy) {
      // Contention is not evidence that a plugin failed or changed instances.
      // Preserve the last observation and its generation; dispatch still obtains
      // a fresh census and durable receipts before it can execute anything.
      this.deferred = true;return;
    }
    invariant(typeof probe.boot === 'string' && Array.isArray(probe.processes), 'PLUGIN_PROBE', 'Plugin process census is unavailable.');
    const jobs = this.runtime.jobs.snapshot();
    for (const item of this.entries().filter(item => item.format === 'plugin')) {
      const attempts = jobs.filter(job => job.kind === 'plugin.start' && job.args.pluginId === item.pluginId && job.args.boot === probe.boot);
      const prior = [...attempts].reverse().find(job => job.result?.generation) || attempts.at(-1), result = prior?.result;
      let observation;
      if (result?.generation) {
        const process = probe.processes.find(process => process.pid === result.pid);
        observation = process?.generation === result.generation && process.name === item.pluginId
          ? { phase: 'process-active', message: 'Plugin process is present. Feature initialization is plugin-specific.', pid: result.pid }
          : { phase: 'exited', message: 'The original plugin process has ended. Existing patches are not automatically undone.' };
      } else if (prior) observation = { phase: prior.status, message: prior.error?.message || prior.progress?.phase || 'Plugin launch is tracked in Activity.' };
      else observation = { phase: 'stopped', message: 'It is recommended to not start plugins until you are in game.' };
      this.observations.set(item.sha256, observation);
    }
    await this.modules.inspect(probe);
    this.runtime.sequence++;
  }
  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.inspect().catch(error => {
      for (const item of this.entries()) this.observations.set(item.sha256, { ...this.observations.get(item.sha256), phase: 'uncertain', message: error.message });
      this.runtime.sequence++;
    }).finally(() => { this.pending = null; }); return this.pending;
  }
  start() {
    if (!this.stopped) return; this.stopped = false;
    // Respond to a verified game start/exit immediately instead of waiting
    // another full plugin polling interval. If a scan is in flight, follow it
    // with a fresh one so the new instance is not lost to coalescing.
    this.unsubscribe = this.runtime.gameLifecycle?.subscribe(event => {
      if (!['start','exit','available'].includes(event.type) || this.stopped) return;
      return this.pending ? this.pending.then(() => { if (!this.stopped) return this.refresh(); }) : this.refresh();
    });
    const tick = async () => { if (this.stopped) return; await this.refresh(); if (!this.stopped) this.timer = setTimeout(tick, this.deferred ? 25 : this.interval); };
    tick();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); this.unsubscribe?.();this.unsubscribe=null; }
}
export function installPlugins(runtime, native, options) {
  runtime.plugins = new Plugins(runtime, native, options);
  runtime.capability('plugins', true, 'Standalone .plugin processes and game-specific .prx/.sprx modules, with verified file and process identities. Console validation is pending.');
  return runtime.plugins;
}
