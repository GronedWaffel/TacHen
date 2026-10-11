// SPDX-License-Identifier: GPL-3.0-or-later
import { canonical, clone, invariant, TacError, publicError } from './errors.mjs';
import { waitForNativeProbe } from './native-readiness.mjs';
const moduleFile = item => ['prx', 'sprx'].includes(item.format);
const matches = (item, game) => game && item.target?.titleId === game.titleId && item.target?.version === game.version && item.platform === game.platform;
const sameGame = (input, game) => game && ['pid', 'generation', 'titleId', 'version', 'metadataHash'].every(key => input[key] === game[key]);
const clean = (code, message) => Object.assign(new TacError(code, message), { noSideEffects: true });
export class GameModules {
  constructor(plugins) {
    this.plugins = plugins; this.runtime = plugins.runtime; this.native = plugins.native; this.attempts = new Set();
    this.runtime.jobs.register('game.module.start', this.handler());
  }
  entries() { return this.plugins.entries().filter(moduleFile); }
  observe(item, phase, message, details = {}) { this.plugins.observations.set(item.sha256, { phase, message, ...details }); }
  outcome(receipt, input, request) {
    invariant(receipt && receipt.request === request && receipt.sha256 === input.sha256 && receipt.pid === input.pid && receipt.generation === input.generation,
      'MODULE_RECEIPT', 'Module result does not match the requested file and game instance.');
    if (receipt.stage !== 4) return null;
    invariant(Number.isSafeInteger(receipt.handle) && receipt.handle >= 0 && Number.isSafeInteger(receipt.startResult) && receipt.startResult >= 0,
      'MODULE_RECEIPT', 'The game module initializer did not provide a successful result.');
    return { completed: true, phase: 'module-started', initialized: true, request, sha256: input.sha256,
      pid: input.pid, generation: input.generation, handle: receipt.handle, startResult: receipt.startResult,
      message: 'The game module initializer succeeded. Its individual features still depend on game compatibility.' };
  }
  ended(input, request) {
    const probe = this.native.systemProbe();
    if (probe.busy || !Array.isArray(probe.processes) || typeof probe.boot !== 'string' || !/^\d+:\d+$/.test(probe.boot)) return null;
    const process = probe.processes.find(p => p.pid === input.pid);
    if (probe.boot === input.boot && process && (!process.generation || process.generation === input.generation)) return null;
    return { completed: true, phase: 'game-ended', initialized: false, request, sha256: input.sha256,
      pid: input.pid, generation: input.generation,
      message: 'The target game instance has ended. Module startup was not confirmed; no retry was issued.' };
  }
  handler() {
    const self = this, { runtime, native, plugins } = this;
    const validate = async input => {
      invariant(input && /^[a-f0-9]{64}$/.test(input.sha256) && ['manual', 'automatic', 'profile'].includes(input.source), 'MODULE_INPUT', 'Choose a registered game module.');
      const item = plugins.find(input.sha256), configuration = canonical(item), game = clone(runtime.game);
      invariant(moduleFile(item), 'PLUGIN_FORMAT', 'Standalone .plugin files use their own process loader.');
      invariant(!runtime.graph.safe, 'SAFE_STARTUP', 'Game modules are held during safe startup.');
      invariant(matches(item, game) && Number.isSafeInteger(game.pid) && game.pid > 1 && /^[a-f0-9]{64}$/.test(game.metadataHash) &&
        typeof game.generation === 'string', 'MODULE_GAME', 'Open the exact target game and version, then choose Load into game.');
      const probe = await waitForNativeProbe(native, { delay: plugins.delay, check: () =>
        invariant(sameGame(game, runtime.game), 'MODULE_GAME', 'The target game changed while waiting to load the module.') });
      invariant(!probe.busy && probe.kstuff?.injectionReady === true && typeof probe.boot === 'string' && game.generation.startsWith(probe.boot + '/' + game.pid + '/'),
        'MODULE_READINESS', 'Wait for verified native services and game identity.');
      invariant(input.source !== 'automatic', 'PLUGIN_MANUAL_ONLY', 'Plugins load manually. It is recommended to not start plugins until you are in game.');
      if (!input.generation) invariant(!runtime.jobs.snapshot().some(job => job.kind === 'game.module.start' && job.args.sha256 === item.sha256 &&
        job.args.generation === game.generation && !['failed', 'cancelled'].includes(job.status)), 'MODULE_ALREADY_ATTEMPTED', 'This module already has a load attempt in the current game instance.');
      const info = await runtime.inbox.verify(item.upload);
      invariant(info.format === item.format && info.sha256 === item.sha256 && (!info.platform || info.platform === item.platform) &&
        canonical(plugins.find(input.sha256)) === configuration && sameGame(game, runtime.game), 'MODULE_CHANGED', 'Module configuration, bytes or target game changed before loading.');
      const accepted = { sha256: item.sha256, upload: item.upload, format: item.format, source: input.source, boot: probe.boot,
        pid: game.pid, generation: game.generation, titleId: game.titleId, version: game.version, metadataHash: game.metadataHash, configuration };
      if (input.generation) invariant(canonical(accepted) === canonical(input), 'MODULE_CONTEXT_CHANGED', 'The accepted module context changed. Submit a new load after reviewing it.');
      return accepted;
    };
    return {
      // The native worker serializes ptrace/setup with tac_native_claim. Once
      // published, the initializer runs inside this game, not the ELF sender.
      // An uncertain PRX outcome must retain this game's ownership without
      // disabling unrelated payloads and services for the rest of the session.
      validate, resources: input => ['game-modules:' + input.generation], timeout: 120000, cancellable: false,
      guard(input, state) {
        invariant(!state.jobs.some(job => job.kind === 'game.module.start' && job.args.sha256 === input.sha256 &&
          job.args.generation === input.generation && !['failed','cancelled'].includes(job.status)),
        'MODULE_ALREADY_ATTEMPTED', 'This module already has a load attempt in the current game instance.');
      },
      async run(input, context) {
        try { await validate(input); } catch (error) { error.noSideEffects = true; throw error; }
        for (;;) {
          try {
            invariant(!context.signal.aborted && sameGame(input, runtime.game) && canonical(plugins.find(input.sha256)) === input.configuration,
              'MODULE_CONTEXT_CHANGED', 'The target game or module settings changed while waiting.');
          } catch (error) { error.noSideEffects = true; throw error; }
          try { native.gameModuleStart(context.id, input.upload, input.sha256, input.pid, input.generation, input.titleId, input.metadataHash, input.format); break; }
          catch (error) {
            if (error.code === 'NATIVE_BUSY') { await plugins.delay(250);continue; }
            if (['MODULE_NATIVE','MODULE_LIMIT','MODULE_ALREADY_ATTEMPTED'].includes(error.code))
              throw new TacError(error.code,String(error.message).slice(0,384));
            throw error;
          }
        }
        for (;;) {
          const receipt = native.gameModulePoll(context.id, input.pid, input.generation); context.evidence?.(receipt);
          const result = self.outcome(receipt, input, context.id);
          if (result) return result;
          if (receipt.stage === 7 && receipt.noSideEffects) throw clean('MODULE_REJECTED', receipt.message);
          if ([5, 6, 7].includes(receipt.stage)) throw new TacError('MODULE_UNCERTAIN', receipt.message);
          invariant([1, 2, 3].includes(receipt.stage), 'MODULE_RECEIPT', 'Unknown game module operation stage.');
          if (!receipt.busy) { const ended = self.ended(input, context.id); if (ended) return ended; }
          invariant(!context.signal.aborted, 'MODULE_TIMEOUT', 'Module initialization was not confirmed in time. The existing attempt is retained; no retry was issued.');
          await context.progress({ completed: 0, total: 1, phase: typeof receipt.message === 'string' && receipt.message ? receipt.message.slice(0,192) : receipt.stage === 3 ? 'Waiting for the game module initializer' : 'Preparing game module' });
          await plugins.delay(250);
        }
      },
      verify: async (result, input) => result.completed && result.sha256 === input.sha256 && result.generation === input.generation && result.pid === input.pid &&
        (result.phase === 'module-started' && result.initialized === true || result.phase === 'game-ended' && result.initialized === false),
      async reconcile(job) {
        const ended = self.ended(job.args, job.id); if (ended) return ended;
        const receipt = native.gameModulePoll(job.id, job.args.pid, job.args.generation);
        if (receipt) {
          const result = self.outcome(receipt, job.args, job.id); if (result) return result;
          if (receipt.stage === 7 && receipt.noSideEffects) return { absent: true };
          if (receipt.busy) return null;
        }
        return self.ended(job.args, job.id);
      }
    };
  }
  async inspect(probe) {
    const game = this.runtime.game;
    // A complete census proving that the old instance ended allows its held
    // resources to settle. This does not retry a failed module or undo patches.
    for (const job of this.runtime.jobs.snapshot().filter(job => job.kind === 'game.module.start' && job.status === 'interrupted')) {
      if (this.ended(job.args, job.id)) {
        try { await this.runtime.jobs.reconcile(job.id); } catch { /* Keep unresolved work held. */ }
      }
    }
    const jobs = this.runtime.jobs.snapshot();
    for (const item of this.entries()) {
      const attempts = jobs.filter(job => job.kind === 'game.module.start' && job.args.sha256 === item.sha256);
      const prior = attempts.filter(job => job.args.generation === game?.generation).at(-1) || attempts.at(-1), result = prior?.result;
      const sameInstance = prior && probe.processes.some(process => process.pid === prior.args.pid && process.generation === prior.args.generation);
      if (sameInstance) {
        if (result?.initialized) this.observe(item, 'module-started', 'Module initializer succeeded; it stays resident until the game ends.', {generation:prior.args.generation});
        else this.observe(item, prior.status, prior.error?.message || prior.progress?.phase || 'Module operation is tracked in Activity.', {generation:prior.args.generation});
      } else this.observe(item, 'stopped', 'It is recommended to not start plugins until you are in game.');

    }
  }
}
