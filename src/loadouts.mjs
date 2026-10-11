// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from 'node:crypto';
import { Profiles } from './profiles.mjs';
import { requireGame } from './firmware.mjs';
import { canonical, clone, invariant, TacError, publicError } from './errors.mjs';
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const same = (a, b) => b && ['pid', 'generation', 'titleId', 'version', 'metadataHash'].every(k => a[k] === b[k]);
const terminal = job => ['completed', 'failed', 'cancelled'].includes(job.status);
const succeeded = job => job.status === 'completed' && ({ 'plugin.start': 'plugin-dispatched', 'game.module.start': 'module-started', 'cheat.set': 'applied' })[job.kind] === job.result?.phase;
const waiting = new Set(['FEATURE_UNAVAILABLE', 'MODULE_READINESS', 'PLUGIN_READINESS', 'CHEAT_READINESS']);
export class Loadouts {
  constructor(runtime, native, { delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.runtime = runtime;this.native = native;this.delay = delay;
    this.library = new Profiles(runtime.store, { changed: (state, target, before, after) => runtime.changes.record(state, {
      change: 'profile', target, before, after, message: after ? 'Game loadout saved' : 'Game loadout removed',
      detail: 'Saved choices changed. Applied plugins and cheats are tracked as separate operations.' }) });
    this.active = null;this.observation = null;this.attempts = new Set();this.pending = null;this.timer = null;this.stopped = true;
    runtime.jobs.register('loadout.apply', this.handler());
  }
  profile(game = this.runtime.game) { return game ? this.library.list().find(p => p.titleId === game.titleId && p.version === game.version) || null : null; }
  ownsAutostart(sha256) { const p = this.profile();return Boolean(p?.autostart && p.plugins.includes(sha256)); }
  overlay() { return !this.runtime.graph.safe && this.active && same(this.active.game, this.runtime.game) ? clone(this.active.overlay) : {}; }
  overrideOverlay(patch) { if (this.active && same(this.active.game, this.runtime.game)) Object.assign(this.active.overlay, patch); }
  snapshot() {
    return { profiles: this.library.list(), active: this.active && same(this.active.game, this.runtime.game) ? clone(this.active) : null, observation: clone(this.observation) };
  }
  async save({ profile, revision }) { await this.library.save(profile, revision);this.runtime.sequence++;return this.snapshot(); }
  async remove({ titleId, version, revision }) { await this.library.remove(titleId, version, revision);this.runtime.sequence++;return this.snapshot(); }
  releaseOverlay() { this.active = null;this.runtime.telemetry?.reset();this.runtime.sequence++;return this.snapshot(); }
  context(input = {}) {
    const r = this.runtime, game = clone(requireGame(r.game)), profile = this.profile(game);
    invariant(!r.graph.safe, 'SAFE_STARTUP', 'Loadouts are held during safe startup.');
    invariant(profile && (!input.titleId || input.titleId === game.titleId && input.version === game.version), 'PROFILE_MISSING', 'Open the exact game and version for this saved loadout.');
    invariant(/^[a-f0-9]{64}$/.test(game.metadataHash || ''), 'PROFILE_GAME', 'Wait for verified running-game metadata.');
    const profileHash = hash(profile), source = input.source || 'manual';
    invariant(['manual', 'automatic'].includes(source) && (source !== 'automatic' || profile.autostart), 'PROFILE_SOURCE', 'Automatic loadout startup is disabled.');
    invariant(source !== 'automatic' || !profile.plugins.length, 'PLUGIN_MANUAL_ONLY', 'Loadouts containing plugins must be applied manually once you are in game.');
    if (input.profileHash) invariant(input.profileHash === profileHash, 'PROFILE_CHANGED', 'This loadout changed after it was reviewed.');
    if (input.generation) invariant(same(input, game), 'PROFILE_GAME_CHANGED', 'The accepted loadout belongs to another game instance.');
    return { game, profile, accepted: { pid: game.pid, generation: game.generation, titleId: game.titleId, version: game.version,
      metadataHash: game.metadataHash, profileHash, source } };
  }
  async plan(input = {}) {
    const { game, profile, accepted } = this.context(input), r = this.runtime, probe = this.native.systemProbe?.();
    invariant(probe && !probe.busy && probe.kstuff?.injectionReady && typeof probe.boot === 'string' &&
      game.generation.startsWith(probe.boot + '/' + game.pid + '/'), 'PROFILE_READINESS', 'Wait for verified kernel services and game identity.');
    const steps = [], issues = [], jobs = r.jobs.snapshot();
    const issue = (label, error) => issues.push({ label, ...publicError(error) });
    const add = async (kind, args, label, prior) => {
      if (prior && !terminal(prior)) throw new TacError('PROFILE_OPERATION_PENDING', `${label} already has unresolved work in Activity.`);
      if (prior && succeeded(prior)) {
        if (kind === 'plugin.start') invariant(probe.processes?.some(p => p.pid === prior.result.pid && p.generation === prior.result.generation && p.name === prior.args.pluginId),
          'PROFILE_PLUGIN_ENDED', `${label} is no longer running. Its once-per-boot launch will not be repeated.`);
        if (kind !== 'cheat.set' || prior.args.enabled) { steps.push({ kind, label, existing: prior.id });return; }
      }
      const handler = r.jobs.handlers.get(kind);invariant(handler, 'FEATURE_UNAVAILABLE', `${label} has no installed native adapter.`);
      steps.push({ kind, label, args: await handler.validate(args) });
    };
    for (const sha256 of profile.plugins) {
      const item = r.plugins?.entries().find(item => item.sha256 === sha256), label = item?.name || 'Missing plugin';
      try {
        invariant(item, 'PLUGIN_MISSING', 'Register the loadout plugin from Payloads first.');
        invariant(item.scope === 'system' || item.target.titleId === game.titleId && item.target.version === game.version, 'PROFILE_PLUGIN_TARGET', `${label} targets another game/version.`);
        const kind = item.format === 'plugin' ? 'plugin.start' : 'game.module.start';
        const prior = jobs.filter(j => j.kind === kind && j.args.sha256 === sha256 &&
          (kind === 'plugin.start' ? j.args.boot === probe.boot : j.args.generation === game.generation)).at(-1);
        await add(kind, { sha256, source: 'profile' }, label, prior);
      } catch (error) { issue(label, error); }
    }
    const packs = new Map();
    for (const ref of profile.cheats) {
      let label = 'Cheat ' + ref.id;
      try {
        invariant(r.cheats, 'FEATURE_UNAVAILABLE', 'Cheat support is not installed.');
        if (!packs.has(ref.pack)) packs.set(ref.pack, await r.cheats.inspect(ref.pack));
        const pack = packs.get(ref.pack), cheat = pack.cheats.find(c => c.id === ref.id);label = cheat?.name || label;
        invariant(pack.titleId === game.titleId && pack.version === game.version && cheat?.supported, 'PROFILE_CHEAT_TARGET', `${label} is unavailable for this exact game/version.`);
        const prior = jobs.filter(j => j.kind === 'cheat.set' && j.args.sha256 === ref.pack && j.args.cheatId === ref.id && j.args.generation === game.generation).at(-1);
        await add('cheat.set', { sha256: ref.pack, cheatId: ref.id, enabled: true }, label, prior);
      } catch (error) { issue(label, error); }
    }
    for (const [key, enabled] of Object.entries(profile.overlay)) {
      const feature = key === 'fps' ? 'fps' : key === 'ip' ? 'ip-overlay' : 'resources';
      if (enabled && !r.capabilities.get(feature)?.available) issue(key.toUpperCase(), new TacError('FEATURE_UNAVAILABLE', r.capabilities.get(feature)?.reason || 'Overlay support is not ready.'));
    }
    invariant(same(game, r.game) && hash(this.profile()) === accepted.profileHash, 'PROFILE_CHANGED', 'Game or loadout changed during preflight.');
    return { accepted, profile, game, steps, issues, canApply: issues.length === 0 };
  }
  async preview(input) {
    const plan = await this.plan(input);return { ...plan, steps: plan.steps.map(({ kind, label, existing }) => ({ kind, label, existing: existing || null })) };
  }
  requirePlan(plan) {
    invariant(plan.canApply, plan.issues.every(issue => waiting.has(issue.code)) ? 'PROFILE_READINESS' : 'PROFILE_PREFLIGHT',
      plan.issues.map(issue => issue.label + ': ' + issue.message).join('\n'));
  }
  adoptionCurrent(step, game) {
    const jobs = this.runtime.jobs.snapshot(), prior = jobs.find(job => job.id === step.existing);
    if (!prior || !succeeded(prior)) return false;
    const latest = jobs.filter(job => job.kind === prior.kind && job.args.sha256 === prior.args.sha256 &&
      (prior.kind === 'plugin.start' ? job.args.boot === prior.args.boot : job.args.generation === game.generation) &&
      (prior.kind !== 'cheat.set' || job.args.cheatId === prior.args.cheatId)).at(-1);
    if (latest?.id !== prior.id || prior.kind === 'cheat.set' && !prior.args.enabled) return false;
    if (prior.kind !== 'plugin.start') return true;
    const probe = this.native.systemProbe();
    return !probe.busy && probe.boot === prior.args.boot && probe.processes?.some(p =>
      p.pid === prior.result.pid && p.generation === prior.result.generation && p.name === prior.args.pluginId);
  }
  result(input, profile, steps, applied, message) {
    return { completed: true, phase: applied ? 'loadout-applied' : 'loadout-stopped', fullyApplied: applied,
      generation: input.generation, profileHash: input.profileHash, name: profile.name, steps, message };
  }
  handler() {
    const self = this, r = this.runtime;
    return {
      async validate(input) { const plan = await self.plan(input);self.requirePlan(plan);return plan.accepted; },
      // Only one coordinator can occupy a queue slot; its child uses the other
      // slot and its ordinary native resources. Parents never own child locks.
      resources: () => ['loadout-coordinator'], timeout: 15 * 60 * 1000, cancellable: false,
      async run(input, context) {
        let plan;
        try { plan = await self.plan(input);self.requirePlan(plan); }
        catch (error) { error.noSideEffects = true;throw error; }
        const steps = [];
        for (let i = 0;i < plan.steps.length;i++) {
          const step = plan.steps[i];
          if (context.signal.aborted) throw new TacError('PROFILE_TIMEOUT', 'Loadout stopped waiting. Reconcile its recorded child operation before retrying.');
          if (!same(input, r.game) || r.graph.safe || hash(self.profile()) !== input.profileHash)
            return self.result(input, plan.profile, steps, false, 'Loadout stopped because the game or saved choices changed. Completed steps were retained.');
          if (step.existing) {
            if (!self.adoptionCurrent(step, input)) return self.result(input, plan.profile, steps, false,
              `${step.label} changed after preflight. Remaining steps were not started; review Activity.`);
            steps.push({ id: step.existing, label: step.label, adopted: true });continue;
          }
          const key = `loadout_${context.id}_${i}`;
          await context.checkpoint({ index: i, childKey: key, steps: steps.map(({ id, adopted }) => ({ id, adopted })), name: plan.profile.name });
          let child;
          try { child = await r.jobs.enqueue(step.kind, step.args, key); }
          catch (error) { return self.result(input, plan.profile, steps, false, `${step.label} did not start: ${error.message}. Earlier steps were retained.`); }
          steps.push({ id: child.id, label: step.label, adopted: false });
          await context.checkpoint({ index: i, steps: steps.map(({ id, adopted }) => ({ id, adopted })), name: plan.profile.name });
          for (;;) {
            const current = r.jobs.snapshot().find(j => j.id === child.id);
            invariant(current, 'PROFILE_CHILD_MISSING', 'A recorded loadout operation is missing; no replacement was issued.');
            if (terminal(current)) {
              if (!succeeded(current)) return self.result(input, plan.profile, steps, false, `${step.label} stopped: ${current.error?.message || current.result?.message || current.status}. Remaining steps were not started.`);
              break;
            }
            invariant(!context.signal.aborted && !['held', 'interrupted', 'uncertain'].includes(current.status), 'PROFILE_CHILD_UNCERTAIN', `${step.label} needs reconciliation in Activity. Remaining steps were not started.`);
            await self.delay(100);
          }
          await context.progress({ completed: i + 1, total: plan.steps.length, phase: step.label + ' recorded' });
        }
        if (!same(input, r.game) || r.graph.safe || hash(self.profile()) !== input.profileHash)
          return self.result(input, plan.profile, steps, false, 'Game or loadout changed before overlay activation. Recorded native steps were retained.');
        await context.checkpoint({ index: plan.steps.length, steps: steps.map(({ id, adopted }) => ({ id, adopted })), name: plan.profile.name, overlay: true });
        self.active = { job: context.id, name: plan.profile.name, profileHash: input.profileHash, game: clone(plan.game), overlay: clone(plan.profile.overlay) };
        r.telemetry?.reset();r.sequence++;
        return self.result(input, plan.profile, steps, true, 'Loadout steps recorded. Standalone plugin initialization is plugin-specific; cheat state describes the last verified application. Overlay choices last for this game instance.');
      },
      verify(result, input) {
        if (!result?.completed || result.generation !== input.generation || result.profileHash !== input.profileHash ||
          !['loadout-applied', 'loadout-stopped'].includes(result.phase) || !Array.isArray(result.steps)) return false;
        const jobs = r.jobs.snapshot();return result.steps.every(step => {
          const child = jobs.find(j => j.id === step.id);return child && terminal(child) && (!result.fullyApplied || succeeded(child));
        });
      },
      reconcile(job) {
        const saved = job.checkpoint, steps = clone(saved?.steps || []), jobs = r.jobs.snapshot();
        if (saved?.childKey) { const child = jobs.find(j => j.key === saved.childKey);if (child && !steps.some(s => s.id === child.id)) steps.push({ id: child.id, label: child.kind, adopted: false }); }
        if (steps.some(step => { const child = jobs.find(j => j.id === step.id);return !child || !terminal(child); })) return null;
        if (!saved) return { absent: true };
        return self.result(job.args, { name: saved.name }, steps, false, 'Recorded loadout steps reconciled. No remaining steps or overlay settings were replayed. Review before applying again.');
      }
    };
  }
  async inspect() {
    const r = this.runtime, profile = this.profile();
    if (this.attemptGeneration !== r.game?.generation) { this.attempts.clear();this.attemptGeneration = r.game?.generation; }
    if (!profile || !profile.autostart || r.graph.safe || r.recovery?.pending || r.jobs.running.size) return;
    const game = r.game, key = game.generation + ':' + hash(profile);
    if (this.attempts.has(key) || r.jobs.snapshot().some(j => j.kind === 'loadout.apply' && j.args.generation === game.generation && j.args.source === 'automatic')) return;
    if(profile.plugins.length){this.observation={generation:game.generation,message:'This loadout contains plugins. Apply it manually once you are in game.'};return;}
    this.attempts.add(key);
    if (this.attempts.size > 256) this.attempts.delete(this.attempts.values().next().value);
    try {
      const job = await r.jobs.enqueue('loadout.apply', { titleId: profile.titleId, version: profile.version, source: 'automatic' }, r.id());
      this.observation = { generation: game.generation, job: job.id, message: 'Automatic loadout queued.' };
    } catch (error) {
      if (['PROFILE_READINESS', 'STARTUP_BUSY'].includes(error.code)) this.attempts.delete(key);
      this.observation = { generation: game.generation, message: error.message, error: publicError(error) };
    }
    r.sequence++;
  }
  refresh() { if (!this.pending) this.pending = this.inspect().finally(() => { this.pending = null; });return this.pending; }
  start() {
    if (!this.stopped) return;this.stopped = false;
    const run = async () => { if (this.stopped) return;try { await this.refresh(); } catch (error) { this.observation = { message: error.message }; }if (!this.stopped) this.timer = setTimeout(run, 2000); };run();
  }
  stop() { this.stopped = true;clearTimeout(this.timer);this.timer = null; }
}
export function installLoadouts(runtime, native, options) {
  runtime.loadouts = new Loadouts(runtime, native, options);runtime.capability('profiles', true, 'Exact-version loadouts with preflight, individually recorded operations and temporary game overlays.');return runtime.loadouts;
}
