// SPDX-License-Identifier: GPL-3.0-or-later
import { invariant, TacError } from './errors.mjs';
import { payloadDispatchHandler } from './payload-loader.mjs';
import { localRequest } from './local-http.mjs';
import { StartupRecovery } from './startup-recovery.mjs';
import { expiredStartup, sameExpiry } from './boot-recovery.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const definitions = {
  kstuff: { needle: 'kstuff' },
  shadowmount: { needle: 'shadowmount', port: 10101, route: '/api/v1/version' },
  'payload-manager': { needle: 'pldmgr', port: 8084, route: '/version' }
};
const match = (probe, id) => probe.processes.filter(p => (p.name + ' ' + p.thread).toLowerCase().includes(definitions[id].needle));
const unknown = (reason, reasonCode = 'COMPONENT_UNCONFIRMED') => ({ ready: false, absent: false, reason, reasonCode });
export function serviceInspector(native, { get = localRequest } = {}) {
  return async function inspect(id) {
    invariant(Object.hasOwn(definitions, id), 'SERVICE_UNKNOWN', 'Unknown native component.');
    const first = native.systemProbe();
    if (first.busy) return { ...unknown('Native operation is still running.', 'PROBE_BUSY'), busy: true };
    invariant(typeof first.boot === 'string' && Array.isArray(first.processes), 'SYSTEM_PROBE', 'Native system evidence is incomplete.');
    if (id === 'kstuff') {
      if (first.kstuff.state === 'installed' && first.kstuff.injectionReady)
        return { ready: true, id, boot: first.boot, firmware: first.firmware, hooks: 'installed', injectionReady: true };
      if (first.kstuff.state === 'unmodified' && !match(first, id).length)
        return { absent: true, ready: false, id, boot: first.boot };
      return unknown('kstuff hooks are changing, incomplete, or unsuitable for injection. No second copy was started.', 'KSTUFF_HOOKS_UNCONFIRMED');
    }
    const processes = match(first, id), port = first.ports[id];
    if (!processes.length && port === 0) return { absent: true, ready: false, id, boot: first.boot };
    if (processes.length !== 1 || port !== 1) return unknown('The component process and listener do not agree.', 'PROCESS_LISTENER_DISAGREE');
    const process = processes[0];
    if (!Number.isInteger(process.pid) || process.pid <= 0 || !process.generation) return unknown('The component process identity is incomplete.', 'PROCESS_IDENTITY_INCOMPLETE');
    let api;
    try {
      const response = await get(definitions[id].port, definitions[id].route, id === 'shadowmount' ? { method: 'POST', body: {} } : {});
      if (id === 'shadowmount') {
        api = JSON.parse(response.text);
        if (api.status !== 0 || api.api_version !== 1 || api.shadowmount_version !== '1.7beta4' ||
          !Array.isArray(api.capabilities) || !['list_games', 'storage_job_status', 'mount_game'].every(key => api.capabilities.includes(key)))
          return unknown('ShadowMount returned a different API or component version.', 'SHADOWMOUNT_API_MISMATCH');
      } else {
        if (response.text.trim() !== '0.5.2') return unknown('Payload Manager returned an unsupported version.', 'MANAGER_VERSION_MISMATCH');
        const config = JSON.parse((await get(8084, '/get_config')).text);
        if (![config.AUTOLOAD_ENABLED, config.AUTO_BROWSER_OPEN, config.KILL_DISC_PLAYER_ON_STARTUP, config.AUTO_INSTALL_APP].every(x => x === false || x === 0))
          return unknown('Payload Manager has independent startup actions enabled. Review its configuration first.', 'MANAGER_STARTUP_CONFLICT');
        api = { version: '0.5.2' };
      }
    } catch (error) { return unknown(error.message || 'The component API is not ready.', 'COMPONENT_API_UNAVAILABLE'); }
    const second = native.systemProbe();
    if (second.busy) return { ...unknown('Native operation deferred the second readiness observation.', 'PROBE_BUSY'), busy: true };
    if (second.boot !== first.boot || second.ports[id] !== 1 || match(second, id).length !== 1 ||
      !match(second, id).some(p => p.pid === process.pid && p.generation === process.generation)) return unknown('The component restarted during readiness verification.', 'COMPONENT_CHANGED');
    if (second.kstuff.state !== 'installed' || !second.kstuff.injectionReady) return unknown('kstuff readiness was lost during component verification.', 'KSTUFF_READINESS_LOST');
    return { ready: true, id, boot: first.boot, pid: process.pid, generation: process.generation,
      version: id === 'shadowmount' ? api.shadowmount_version : api.version,
      capabilities: id === 'shadowmount' ? api.capabilities : [] };
  };
}
const sameInstance = (a, b) => a?.ready === true && b?.ready === true && a.id === b.id && a.boot === b.boot &&
  (a.id === 'kstuff' ? b.hooks === 'installed' && b.injectionReady : a.pid === b.pid && a.generation === b.generation && a.version === b.version);

export function installNativeServices(runtime, native, assets, { delay = sleep, get = localRequest, timeout = 90000 } = {}) {
  const inspect = serviceInspector(native, { get });
  const dispatch = payloadDispatchHandler(runtime, native, { delay, managed: true });
  runtime.componentHashes = new Set(Object.keys(definitions).map(id => assets.get(id).sha256));
  runtime.jobs.register('component.start', {
    resources: () => ['native-payload-dispatch'], timeout: timeout + 30000, cancellable: false,
    async validate(input) {
      invariant(Object.hasOwn(definitions, input?.component), 'SERVICE_UNKNOWN', 'Choose a supported component.');
      invariant(!runtime.graph.safe || runtime.recovery?.permits(input.component), 'SAFE_START', 'Automatic native startup is disabled while recovery is pending.');
      const pinned = assets.get(input.component);
      if (input.sha256) invariant(input.sha256 === pinned.sha256, 'COMPONENT_CHANGED', 'Queued component differs from this build.');
      const probe = native.systemProbe();
      invariant(!probe.busy && typeof probe.boot === 'string', 'STARTUP_BOOT', 'Current boot identity is unavailable.');
      if (input.boot) invariant(input.boot === probe.boot, 'STARTUP_BOOT_CHANGED', 'This component request belongs to an earlier boot.');
      return { component: input.component, boot: probe.boot, ...await assets.ensure(input.component) };
    },
    async run(input, context) {
      let evidence;
      try {
        invariant(!runtime.graph.safe || runtime.recovery?.permits(input.component), 'SAFE_START', 'Recovery mode prevents starting a native component.');
        invariant(native.systemProbe().boot === input.boot, 'STARTUP_BOOT_CHANGED', 'The console boot changed before dispatch.');
        evidence = await inspect(input.component);
        context.evidence?.(evidence);
        if (evidence.ready) return { completed: true, evidence, adopted: true };
        invariant(evidence.absent, 'COMPONENT_CONFLICT', evidence.reason || 'Existing component state is uncertain.');
        if (input.component !== 'kstuff') invariant((await inspect('kstuff')).ready, 'KSTUFF_NOT_READY', 'Wait for verified kstuff initialization.');
        const competing = native.systemProbe();
        invariant(!competing.busy && !competing.processes.some(p => /etahen.*(?:critical|utility)|(?:critical|utility).*etahen/i.test(p.name + ' ' + p.thread)),
          'OTHER_HEN_RUNNING', 'Another HEN owns startup. Stop it through its normal lifecycle before starting TacHen components.');
      } catch (error) { error.noSideEffects = true; throw error; }
      // This fixed-path native operation durably backs up any existing config;
      // it disables secondary autoload/browser/app installation before launch.
      if (input.component === 'payload-manager') native.managerPrepare(context.id);
      await dispatch.run(input, context);
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline && !context.signal.aborted) {
        evidence = await inspect(input.component);
        context.evidence?.(evidence);
        if (evidence.ready) return { completed: true, evidence, adopted: false };
        await context.progress({ completed: 0, total: 1, phase: 'Waiting for ' + input.component + ' readiness' });
        await delay(500);
      }
      throw new TacError('COMPONENT_NOT_READY', evidence.reason || 'The component did not finish initialization.',
        { action: 'Inspect this startup attempt. A second copy will not be launched automatically.' });
    },
    verify: async result => sameInstance(result.evidence, await inspect(result.evidence?.id)),
    async reconcile(job) {
      const receipt = native.loaderPoll(job.id);
      if (receipt) invariant(receipt.request === job.id && receipt.sha256 === job.args.sha256, 'DISPATCH_RECEIPT', 'The previous startup receipt has a different identity.');
      const expired = expiredStartup(native, job, receipt);if (expired) return expired;
      const evidence = await inspect(job.args.component);
      if (evidence.ready) return { completed: true, evidence, reconciled: true };
      // A spawn receipt plus an absent process is not permission to repeat a
      // kernel operation. Only an unexecuted request can be retried in this boot.
      if (evidence.absent && (!receipt || receipt.stage === 4 && receipt.noSideEffects)) return { absent: true };
      return null;
    },
    verifyExpired: (outcome, job) => sameExpiry(outcome, expiredStartup(native, job, native.loaderPoll(job.id)))
  });
  for (const id of Object.keys(definitions)) {
    runtime.graph.register({ id, dependencies: id === 'kstuff' ? ['coordinator'] : ['kstuff'],
      optional: id !== 'kstuff', timeout: timeout + 60000, inspect: () => inspect(id),
      verify: async evidence => sameInstance(evidence, await inspect(id)),
      async start({ signal }) {
        const existing = await inspect(id); if (existing.ready) return existing;
        invariant(existing.absent, 'COMPONENT_CONFLICT', existing.reason || 'Component state is unknown.');
        const job = await runtime.jobs.enqueue('component.start', { component: id }, 'component_' + (runtime.recovery?.attempt || runtime.session) + '_' + id);
        while (!signal.aborted) {
          const current = runtime.jobs.snapshot().find(item => item.id === job.id);
          if (current.status === 'completed') return current.result.evidence;
          if (['failed', 'interrupted', 'cancelled', 'held', 'uncertain'].includes(current.status))
            throw new TacError(current.error?.code || 'COMPONENT_STOPPED', current.error?.message || 'The component startup needs inspection.');
          await delay(250);
        }
        throw new TacError('COMPONENT_WAIT_EXPIRED', 'The startup job is still recorded in Activity.');
      }
    });
  }
  runtime.capability('kstuff', true, 'Kernel hook markers are inspected on each readiness check.');
  runtime.recovery = new StartupRecovery(runtime, native);
  let timer = null, monitoring = false, checking = false;
  const misses = new Map();
  async function checkResident() {
    if (checking || runtime.jobs.running.size || runtime.recovery?.pending) return;
    checking = true;
    try {
      for (const id of Object.keys(definitions)) {
        if (!runtime.graph.ready(id)) { misses.delete(id); continue; }
        let evidence;
        try { evidence = await inspect(id); } catch (error) { evidence = unknown(error.message); }
        if (evidence.busy) continue; // Contention supplies no new evidence of service loss.
        if (sameInstance(runtime.graph.states.get(id).evidence, evidence)) { misses.delete(id); continue; }
        const count = (misses.get(id) || 0) + 1; misses.set(id, count);
        if (count < 2) continue;
        runtime.graph.invalidate(id, new TacError('SERVICE_READINESS_LOST', `${id} no longer matches its verified startup instance.`,
          { action: 'Check readiness before using features that depend on it. No automatic replacement was launched.' }));
        await runtime.store.transaction(state => {
          state.history.push({ id: runtime.id(), session: runtime.session, at: runtime.now(), type: 'service', undo: false,
            message: `${id} readiness changed`, detail: evidence.reason || 'Its process, kernel hooks or service identity changed.' });
          state.history = state.history.slice(-256);
        });
      }
    } finally { checking = false; }
  }
  return { inspect, checkResident,
    startMonitoring() {
      if (monitoring) return; monitoring = true;
      const tick = async () => {
        try { await checkResident(); } catch (error) { console.error('Service observation:', error.message); }
        if (monitoring) timer = setTimeout(tick, 10000);
      };
      timer = setTimeout(tick, 10000);
    },
    stopMonitoring() { monitoring = false; clearTimeout(timer); },
    startConfigured: () => runtime.recovery.startConfigured()
  };
}
