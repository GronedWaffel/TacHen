// SPDX-License-Identifier: GPL-3.0-or-later
import { invariant, TacError } from './errors.mjs';
import { FIRMWARES } from './firmware.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = (code, message) => Object.assign(new TacError(code, message), { noSideEffects: true });
export function installPackageInstaller(runtime, native, { delay = sleep, now = Date.now } = {}) {
  const available = FIRMWARES.includes(runtime.identity.firmware) && typeof native.packageStart === 'function' && typeof native.packagePoll === 'function';
  runtime.capability('packages', available, available
    ? 'Isolated native installer with durable progress receipts. Console validation is still pending.'
    : 'Package staging is available; native installation requires a supported TacHen firmware profile and installer helper.');
  async function validate(input) {
    invariant(available, 'PACKAGE_FIRMWARE', 'Native installation requires a supported TacHen firmware profile and installer helper.');
    const item = await runtime.packageInbox.describe(input?.id);
    invariant(item.status === 'verified', 'PACKAGE_NOT_VERIFIED', 'Finish package verification before installing.');
    const verification = runtime.jobs.snapshot().findLast(job => job.kind === 'package.verify' && job.args.id === item.id && job.status === 'completed');
    const hash = verification?.result?.sha256;
    invariant(typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'PACKAGE_CHECKSUM', 'Run package verification before installing this file.');
    const result = { id: item.id, sha256: hash, bytes: item.bytes, contentId: item.package.contentId,
      platform: item.package.platform, type: item.package.type, patch: item.package.patch, name: item.package.titleId + '.pkg' };
    if (input.sha256) invariant(input.sha256 === result.sha256 && input.contentId === result.contentId && input.bytes === result.bytes,
      'PACKAGE_CHANGED', 'The package changed after this install was queued.');
    return result;
  }
  function receipt(id, input) {
    const value = native.packagePoll(id);
    invariant(value && value.request === id && value.upload === input.id && value.sha256 === input.sha256 && value.contentId === input.contentId && value.bytes === input.bytes,
      'PACKAGE_RECEIPT', 'Native installation receipt does not match this package. No resubmission was issued.');
    invariant(Number.isInteger(value.stage) && value.stage >= 1 && value.stage <= 8 && Number.isFinite(value.ageMs) && value.ageMs >= 0,
      'PACKAGE_RECEIPT', 'Native installation receipt is invalid.');
    return value;
  }
  function outcome(value) {
    return value.stage === 6 && value.accepted && value.observed && value.error === 0
      ? { completed: true, request: value.request, sha256: value.sha256, contentId: value.contentId,
        message: 'Console reported full installation after observed progress.', evidence: value } : null;
  }
  runtime.jobs.register('package.install', {
    validate, resources: input => ['package-installer', 'package-file:' + input.id], timeout: 49 * 60 * 60 * 1000, cancellable: false,
    async run(input, context) {
      try { await validate(input); } catch (error) { error.noSideEffects = true; throw error; }
      // Only contention before the helper starts is retried. A recorded native
      // submission is never replayed on timeout, disconnect or app restart.
      const deadline = now() + 60000;
      for (;;) {
        const probe = native.systemProbe();
        if (!probe.busy) {
          if (probe.kstuff?.state !== 'installed' || !probe.kstuff.injectionReady) throw clean('PACKAGE_DEPENDENCY', 'Verified kstuff must be ready before installation.');
          try { native.packageStart(context.id, input.id, input.sha256, input.contentId, input.type,
            input.platform === 'ps5' ? 5 : 4, input.patch ? 1 : 0, input.bytes, input.name); break; }
          catch (error) { if (error.code !== 'NATIVE_BUSY' || error.noSideEffects !== true) throw error; }
        }
        if (now() >= deadline || context.signal.aborted) throw clean('NATIVE_BUSY', 'Another native operation is still active; no package was submitted.');
        await delay(250);
      }
      await context.checkpoint({ request: context.id, sha256: input.sha256, contentId: input.contentId });
      for (;;) {
        const status = receipt(context.id, input); context.evidence?.(status);
        const result = outcome(status); if (result) return result;
        if (status.stage === 7 && status.noSideEffects) throw clean('PACKAGE_REJECTED', status.message);
        invariant(status.stage !== 8 && status.sameBoot && status.ageMs <= 60000 && !context.signal.aborted,
          'PACKAGE_UNCERTAIN', status.stage === 8 ? status.message : 'Installer stopped reporting progress. Its source file is retained; no retry was issued.');
        await context.progress({ completed: status.completedBytes, total: status.totalBytes, phase: status.message });
        await delay(500);
      }
    },
    verify(result, input) { const status = receipt(result.request, input); return Boolean(outcome(status)) && result.sha256 === input.sha256; },
    reconcile(job) {
      const status = receipt(job.id, job.args);
      if (status.stage === 7 && status.noSideEffects) return { absent: true };
      return outcome(status);
    }
  });
}
