// SPDX-License-Identifier: GPL-3.0-or-later
import { invariant, TacError, publicError } from './errors.mjs';
import { payloadDispatchHandler } from './payload-loader.mjs';
import { localGet } from './local-http.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const definitions = {
  kstuff: { needle: 'kstuff' },
  shadowmount: { needle: 'shadowmount', port: 10101, route: '/api/v1/version' },
  'payload-manager': { needle: 'pldmgr', port: 8084, route: '/version' }
};
const match = (probe, id) => probe.processes.filter(p => (p.name + ' ' + p.thread).toLowerCase().includes(definitions[id].needle));
const unknown = reason => ({ ready: false, absent: false, reason });
export function serviceInspector(native, { get = localGet } = {}) {
  return async function inspect(id) {
    invariant(Object.hasOwn(definitions, id), 'SERVICE_UNKNOWN', 'Unknown native component.');
    const first = native.systemProbe();
    if (first.busy) return unknown('Native dispatch is still running.');
    invariant(typeof first.boot === 'string' && Array.isArray(first.processes), 'SYSTEM_PROBE', 'Native system evidence is incomplete.');
    if (id === 'kstuff') {
      if (first.kstuff.state === 'installed' && first.kstuff.injectionReady)
        return { ready: true, id, boot: first.boot, firmware: first.firmware, hooks: 'installed', injectionReady: true };
      if (first.kstuff.state === 'unmodified' && !match(first, id).length)
        return { absent: true, ready: false, id, boot: first.boot };
      return unknown('kstuff hooks are changing, incomplete, or unsuitable for injection. No second copy was started.');
    }
    const processes = match(first, id), port = first.ports[id];
    if (!processes.length && port === 0) return { absent: true, ready: false, id, boot: first.boot };
    if (processes.length !== 1 || port !== 1) return unknown('The component process and listener do not agree.');
    const process = processes[0];
    if (!Number.isInteger(process.pid) || process.pid <= 0 || !process.generation) return unknown('The component process identity is incomplete.');
    let api;
    try {
      const response = await get(definitions[id].port, definitions[id].route);
      if (id === 'shadowmount') {
        api = JSON.parse(response.text);
        if (api.status !== 0 || api.api_version !== 1 || api.shadowmount_version !== '1.7beta4' ||
          !Array.isArray(api.capabilities) || !['list_games', 'storage_job_status', 'mount_game'].every(key => api.capabilities.includes(key)))
          return unknown('ShadowMount returned a different API or component version.');
      } else {
        if (response.text.trim() !== '0.5.2') return unknown('Payload Manager returned an unsupported version.');
        const config = JSON.parse((await get(8084, '/get_config')).text);
        if (![config.AUTOLOAD_ENABLED, config.AUTO_BROWSER_OPEN, config.KILL_DISC_PLAYER_ON_STARTUP, config.AUTO_INSTALL_APP].every(x => x === false || x === 0))
          return unknown('Payload Manager has independent startup actions enabled. Review its configuration first.');
        api = { version: '0.5.2' };
      }
    } catch (error) { return unknown(error.message || 'The component API is not ready.'); }
    const second = native.systemProbe();
    if (second.busy || second.boot !== first.boot || second.ports[id] !== 1 || match(second, id).length !== 1 ||
      !match(second, id).some(p => p.pid === process.pid && p.generation === process.generation)) return unknown('The component restarted during readiness verification.');
    if (second.kstuff.state !== 'installed' || !second.kstuff.injectionReady) return unknown('kstuff readiness was lost during component verification.');
    return { ready: true, id, boot: first.boot, pid: process.pid, generation: process.generation,
      version: id === 'shadowmount' ? api.shadowmount_version : api.version,
      capabilities: id === 'shadowmount' ? api.capabilities : [] };
  };
}
const sameInstance = (a, b) => a?.ready === true && b?.ready === true && a.id === b.id && a.boot === b.boot &&
  (a.id === 'kstuff' ? b.hooks === 'installed' && b.injectionReady : a.pid === b.pid && a.generation === b.generation && a.version === b.version);

export function installNativeServices(runtime, native, assets, { delay = sleep, get = localGet, timeout = 90000 } = {}) {
  const inspect = serviceInspector(native, { get });
  const dispatch = payloadDispatchHandler(runtime, native, { delay, managed: true });
  runtime.componentHashes = new Set(Object.keys(definitions).map(id => assets.get(id).sha256));
  runtime.jobs.register('component.start', {
    resources: () => ['native-payload-dispatch'], timeout: timeout + 30000, cancellable: false,
    async validate(input) {
      invariant(Object.hasOwn(definitions, input?.component), 'SERVICE_UNKNOWN', 'Choose a supported component.');
      invariant(!runtime.graph.safe, 'SAFE_START', 'Automatic native startup is disabled while recovery is pending.');
      const pinned = assets.get(input.component);
      if (input.sha256) invariant(input.sha256 === pinned.sha256, 'COMPONENT_CHANGED', 'Queued component differs from this build.');
      return { component: input.component, ...await assets.ensure(input.component) };
    },
    async run(input, context) {
      let evidence;
      try {
        invariant(!runtime.graph.safe, 'SAFE_START', 'Recovery mode prevents starting a native component.');
        evidence = await inspect(input.component);
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
        if (evidence.ready) return { completed: true, evidence, adopted: false };
        await context.progress({ completed: 0, total: 1, phase: 'Waiting for ' + input.component + ' readiness' });
        await delay(500);
      }
      throw new TacError('COMPONENT_NOT_READY', evidence.reason || 'The component did not finish initialization.',
        { action: 'Inspect this startup attempt. A second copy will not be launched automatically.' });
    },
    verify: async result => sameInstance(result.evidence, await inspect(result.evidence?.id)),
    async reconcile(job) {
      const evidence = await inspect(job.args.component);
      if (evidence.ready) return { completed: true, evidence, reconciled: true };
      const receipt = native.loaderPoll(job.id);
      // A spawn receipt plus an absent process is not permission to repeat a
      // kernel operation. Only an unexecuted request can be retried in this boot.
      if (evidence.absent && (!receipt || receipt.stage === 4 && receipt.noSideEffects)) return { absent: true };
      return null;
    }
  });
  for (const id of Object.keys(definitions)) {
    runtime.graph.register({ id, dependencies: id === 'kstuff' ? ['coordinator'] : ['kstuff'],
      optional: id !== 'kstuff', timeout: timeout + 60000, inspect: () => inspect(id),
      verify: async evidence => sameInstance(evidence, await inspect(id)),
      async start({ signal }) {
        const existing = await inspect(id); if (existing.ready) return existing;
        invariant(existing.absent, 'COMPONENT_CONFLICT', existing.reason || 'Component state is unknown.');
        const job = await runtime.jobs.enqueue('component.start', { component: id }, 'component_' + runtime.session + '_' + id);
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
  let timer = null, monitoring = false, checking = false;
  const misses = new Map();
  async function checkResident() {
    if (checking || runtime.jobs.running.size) return;
    checking = true;
    try {
      for (const id of Object.keys(definitions)) {
        if (!runtime.graph.ready(id)) { misses.delete(id); continue; }
        let evidence;
        try { evidence = await inspect(id); } catch (error) { evidence = unknown(error.message); }
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
    async startConfigured() {
      if (runtime.graph.safe) return;
      await runtime.store.transaction(state => { state.startup.pending = true; });
      let failure = null;
      try {
        await runtime.graph.start('kstuff');
        for (const id of ['shadowmount', 'payload-manager']) {
          if (runtime.store.snapshot().settings.services[id === 'shadowmount' ? 'shadowmount' : 'payloadManager']) await runtime.graph.start(id);
        }
      } catch (error) { failure = publicError(error); }
      await runtime.store.transaction(state => {
        state.startup.pending = false; state.startup.safe = !!failure;
        state.history.push({ id: runtime.id(), session: runtime.session, at: runtime.now(), type: 'startup', undo: false,
          message: failure ? 'Native startup needs attention' : 'Native components are ready', detail: failure?.message || 'Component identities and readiness were verified.' });
        state.history = state.history.slice(-256);
      });
      if (failure) runtime.graph.safe = true;
      runtime.sequence++;
    }
  };
}
