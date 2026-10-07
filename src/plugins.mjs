// SPDX-License-Identifier: GPL-3.0-or-later
import { canonical, clone, invariant, TacError, publicError } from './errors.mjs';
import { validatePlugin } from './plugin-schema.mjs';
import { GameModules } from './game-modules.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = (code, message) => Object.assign(new TacError(code, message), { noSideEffects: true });
const matches = (target, game) => target && game && target.titleId === game.titleId && target.version === game.version;

// These containers are standalone plugin processes. A game target controls
// TacHen's autostart policy; it does not magically constrain third-party code.
export class Plugins {
  constructor(runtime, native, { delay = sleep, interval = 5000 } = {}) {
    this.runtime = runtime; this.native = native; this.delay = delay; this.interval = interval;
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
    invariant(input && Number.isSafeInteger(input.revision), 'REVISION_REQUIRED', 'Refresh the plugin list before making changes.');
    const info = await this.runtime.inbox.verify(input.upload);
    const module = ['prx', 'sprx'].includes(info.format);
    invariant(info.format === 'plugin' || module && input.scope === 'game', 'PLUGIN_FORMAT', 'Native PRX modules require a specific game target.');
    const item = validatePlugin({ ...info, upload: info.id, scope: input.scope, target: input.target ?? null, autostart: false,
      ...(module ? { pluginId: 'module:' + info.sha256, pluginVersion: null,
        platform: info.platform || (/^(PPSA|PPSB|MOUU)/.test(input.target?.titleId) ? 'ps5' : 'ps4') } : {}) });
    await this.runtime.store.transaction(state => {
      invariant(!state.plugins.some(other => other.sha256 === item.sha256 || other.pluginId === item.pluginId),
        'PLUGIN_CONFLICT', 'This file or plugin identity is already registered.');
      state.plugins.push(item);
    }, input.revision);
    this.runtime.sequence++; return this.list();
  }
  async configure({ sha256, autostart, revision }) {
    invariant(typeof autostart === 'boolean' && Number.isSafeInteger(revision), 'PLUGIN_CONFIG', 'Choose an autostart setting from the current list.');
    await this.runtime.store.transaction(state => {
      const item = state.plugins.find(item => item.sha256 === sha256);
      invariant(item, 'PLUGIN_MISSING', 'Plugin is no longer registered.'); item.autostart = autostart;
    }, revision);
    this.runtime.sequence++; return this.list();
  }
  list() {
    return this.entries().map(item => ({ ...item, observation: clone(this.observations.get(item.sha256) || {
      phase: 'uninspected', message: item.format === 'plugin' ? 'Process state has not been checked.' : 'Game module state has not been checked.' }) }));
  }
  handler() {
    const self = this, runtime = this.runtime;
    const validate = async input => {
      invariant(input && /^[a-f0-9]{64}$/.test(input.sha256) && ['manual', 'automatic', 'profile'].includes(input.source),
        'PLUGIN_INPUT', 'Choose a registered plugin and launch mode.');
      const item = self.find(input.sha256), configuration = canonical(item);
      invariant(item.format === 'plugin', 'PLUGIN_FORMAT', 'This file is a game module; use the native module loader.');
      invariant(!runtime.graph.safe, 'SAFE_STARTUP', 'Plugin startup is held during safe startup.');
      const probe = self.native.systemProbe();
      invariant(!probe.busy && probe.kstuff?.injectionReady === true && typeof probe.boot === 'string',
        'PLUGIN_READINESS', 'Wait for verified kstuff readiness before starting a plugin.');
      if (!input.boot) invariant(!runtime.jobs.snapshot().some(job => job.kind === 'plugin.start' &&
        job.args.pluginId === item.pluginId && job.args.boot === probe.boot && !['failed', 'cancelled'].includes(job.status)),
        'PLUGIN_ALREADY_ATTEMPTED', 'This plugin already has an active or unresolved launch in this boot. Check its existing operation.');
      if (input.source === 'automatic') invariant(item.autostart && (item.scope === 'system' || matches(item.target, runtime.game)),
        'PLUGIN_AUTOSTART', 'This plugin is no longer enabled for the current game.');
      const info = await runtime.inbox.verify(item.upload);
      invariant(info.format === 'plugin' && info.sha256 === item.sha256 && info.pluginId === item.pluginId &&
        info.pluginVersion === item.pluginVersion && canonical(self.find(input.sha256)) === configuration,
        'PLUGIN_CHANGED', 'Plugin bytes or configuration changed before launch.');
      const gameScoped = input.source === 'profile' || input.source === 'automatic' && item.scope === 'game';
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
      async run(input, context) {
        try { await validate(input); } catch (error) { error.noSideEffects = true; throw error; }
        for (;;) {
          try {
            invariant(!context.signal.aborted, 'PLUGIN_CANCELLED', 'Plugin launch ended before native dispatch.');
            // Recheck after waits: never launch into a different game or boot.
            const item = self.find(input.sha256);
            invariant(canonical(item) === input.configuration && (input.source === 'manual' || input.source === 'profile' &&
              runtime.game?.generation === input.generation && (item.scope === 'system' || matches(item.target, runtime.game)) || input.source === 'automatic' && item.autostart &&
              (item.scope === 'system' || matches(item.target, runtime.game) && runtime.game.generation === input.generation)),
              'PLUGIN_CONTEXT_CHANGED', 'Plugin startup conditions changed while waiting.');
          } catch (error) { error.noSideEffects = true; throw error; }
          try { self.native.pluginStart(context.id, input.upload, input.sha256); break; }
          catch (error) { if (error.code !== 'LOADER_BUSY') throw error; await self.delay(250); }
        }
        for (;;) {
          const receipt = self.native.loaderPoll(context.id), outcome = result(receipt, input, context.id);
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
    if (!this.entries().length) return;
    const probe = this.native.systemProbe();
    if (probe.busy) {
      for (const item of this.entries()) this.observations.set(item.sha256, { phase: 'uncertain', message: 'Native operation in progress; plugin status is temporarily unavailable.' });
      this.runtime.sequence++; return;
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
      else observation = { phase: item.autostart ? 'armed' : 'stopped', message: item.autostart ?
        item.scope === 'game' ? 'Waiting for the exact game title and version.' : 'Waiting for verified native services.' : 'Ready to start, including before a game opens.' };
      this.observations.set(item.sha256, observation);
      const key = probe.boot + ':' + item.sha256;
      if (!prior && !this.attempts.has(key) && item.autostart && !this.runtime.loadouts?.ownsAutostart(item.sha256) && !this.runtime.graph.safe && probe.kstuff?.injectionReady === true &&
          (item.scope === 'system' || matches(item.target, this.runtime.game))) {
        this.attempts.add(key);
        try { await this.runtime.jobs.enqueue('plugin.start', { sha256: item.sha256, source: 'automatic' }, this.runtime.id()); }
        catch (error) {
          if (error.code === 'PLUGIN_READINESS') this.attempts.delete(key);
          this.observations.set(item.sha256, { phase: 'held', message: error.message, error: publicError(error) });
        }
      }
    }
    await this.modules.inspect(probe);
    this.runtime.sequence++;
  }
  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.inspect().catch(error => {
      for (const item of this.entries()) this.observations.set(item.sha256, { phase: 'uncertain', message: error.message });
      this.runtime.sequence++;
    }).finally(() => { this.pending = null; }); return this.pending;
  }
  start() {
    if (!this.stopped) return; this.stopped = false;
    const tick = async () => { if (this.stopped) return; await this.refresh(); if (!this.stopped) this.timer = setTimeout(tick, this.interval); };
    tick();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
export function installPlugins(runtime, native, options) {
  runtime.plugins = new Plugins(runtime, native, options);
  runtime.capability('plugins', true, 'Standalone .plugin processes and game-specific .prx/.sprx modules, with verified file and process identities. Console validation is pending.');
  return runtime.plugins;
}
