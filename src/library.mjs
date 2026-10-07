// SPDX-License-Identifier: GPL-3.0-or-later
import { invariant, TacError, clone, publicError } from './errors.mjs';
import { localRequest } from './local-http.mjs';
const TITLE = /^(?:PPSA|PPSB|CUSA|PCAS|PCJS|PCKS|CUHJ|SCUS)\d{5}$/;
export const sameService = (a, b) => a?.ready && b?.ready && a.boot === b.boot && a.pid === b.pid && a.generation === b.generation && a.version === b.version;
const text = (value, limit) => typeof value === 'string' && value.length <= limit && !/[\x00-\x1f]/.test(value);
function game(raw) {
  invariant(raw && TITLE.test(raw.title_id) && text(raw.title_name, 512) && text(raw.path, 1024) &&
    text(raw.content_id, 128) && ['ps4', 'ps5', 'unknown'].includes(raw.platform) &&
    ['installed', 'mounted', 'installed_pkg', 'source_available', 'can_manage_source'].every(key => typeof raw[key] === 'boolean'),
    'LIBRARY_RESPONSE', 'ShadowMount returned an incomplete game record.');
  return { titleId: raw.title_id, name: raw.title_name, contentId: raw.content_id, platform: raw.platform,
    path: raw.path, sourceType: text(raw.source_type, 64) ? raw.source_type : 'unknown',
    installed: raw.installed, mounted: raw.mounted, installedPackage: raw.installed_pkg,
    sourceAvailable: raw.source_available, canMount: raw.can_manage_source && !raw.installed_pkg,
    bytes: Number.isSafeInteger(raw.app_db_size_bytes) && raw.app_db_size_bytes >= 0 ? raw.app_db_size_bytes : null };
}
export function installLibrary(runtime, { request = localRequest, timeout = 15000 } = {}) {
  let refreshing = null;
  runtime.libraryState = { games: [], updatedAt: null, error: null, available: false };
  async function ready() {
    const evidence = await runtime.nativeServices.inspect('shadowmount');
    invariant(evidence.ready, 'SHADOWMOUNT_NOT_READY', evidence.reason || 'Start and verify ShadowMount before opening the library.');
    return evidence;
  }
  async function call(route, body = {}, limit = 4 * 1024 * 1024, acceptedStatuses = [200]) {
    const response = await request(10101, '/api/v1/' + route, { method: 'POST', body, maxBytes: limit, timeout, acceptedStatuses });
    const data = JSON.parse(response.text);
    invariant(data?.status === 0, 'SHADOWMOUNT_OPERATION', data?.error || 'ShadowMount did not complete the requested operation.');
    return data;
  }
  async function scan() {
    const before = await ready();
    // include_size=false uses cached metadata; never walk multi-hundred-GB game
    // trees just to populate the phone list. Unknown size stays unknown.
    const data = await call('games', { include_size: false });
    invariant(Array.isArray(data.games) && data.games.length <= 8192 && data.count === data.games.length,
      'LIBRARY_RESPONSE', 'ShadowMount returned an invalid game list.');
    const games = data.games.map(game), ids = new Set(games.map(item => item.titleId));
    invariant(ids.size === games.length, 'LIBRARY_AMBIGUOUS', 'The library contains duplicate title identities.');
    invariant(sameService(before, await ready()), 'SERVICE_CHANGED', 'ShadowMount restarted while reading the library.');
    return { games, service: before };
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const result = await scan();
        runtime.libraryState = { games: result.games, updatedAt: runtime.now(), error: null, available: true };
        return page();
      } catch (error) {
        runtime.libraryState.available = false; runtime.libraryState.error = publicError(error); throw error;
      } finally { runtime.sequence++; refreshing = null; }
    })();
    return refreshing;
  }
  async function target(input) {
    invariant(input && TITLE.test(input.titleId) && typeof input.mounted === 'boolean', 'LIBRARY_INPUT', 'Choose a game and a mount state.');
    const current = await scan(), item = current.games.find(item => item.titleId === input.titleId);
    invariant(item?.canMount && item.sourceAvailable, 'LIBRARY_SOURCE', 'This game source is unavailable or is an installed package.');
    if (input.path) invariant(input.path === item.path && input.contentId === item.contentId, 'LIBRARY_CHANGED', 'The game source changed after this request.');
    if (input.service) invariant(sameService(input.service, current.service), 'SERVICE_CHANGED', 'ShadowMount restarted after this request.');
    return { titleId: item.titleId, path: item.path, contentId: item.contentId, mounted: input.mounted,
      priorMounted: typeof input.priorMounted === 'boolean' ? input.priorMounted : item.mounted, service: current.service };
  }
  runtime.jobs.register('library.mount', {
    validate: target, resources: () => ['shadowmount-library'], timeout: timeout + 15000, cancellable: false,
    async run(input, context) {
      try { await target(input); }
      catch (error) { error.noSideEffects = true; throw error; }
      if (input.priorMounted === input.mounted) return observe(input);
      await context.progress({ completed: 0, total: 1, phase: input.mounted ? 'Mounting game source' : 'Unmounting game source' });
      // Upstream's exact pinned implementation checks active games/sleep and
      // returns EBUSY before changing a live game's mount. No override is sent.
      const result = await call(input.mounted ? 'games/mount' : 'games/unmount', { title_id: input.titleId }, 65536);
      invariant(result.title_id === input.titleId && result.mounted === input.mounted, 'MOUNT_RESPONSE', 'The mount response does not match this request.');
      const verified = await observe(input); await refresh(); return verified;
    },
    verify: async (result, input) => result?.completed === true && result.titleId === input.titleId &&
      result.mounted === input.mounted && sameService(input.service, await ready()),
    reconcile: job => observe(job.args, true)
  });
  async function observe(input, reconciliation = false) {
    const result = await scan(), item = result.games.find(item => item.titleId === input.titleId);
    invariant(sameService(input.service, result.service) && item?.path === input.path && item.contentId === input.contentId,
      'MOUNT_IDENTITY', 'The service or game identity changed before mount verification.');
    if (reconciliation && item.mounted !== input.mounted && item.mounted === input.priorMounted) return { absent: true };
    invariant(item.mounted === input.mounted, 'MOUNT_UNCONFIRMED', 'The desired mount state has not been verified.');
    return { completed: true, titleId: input.titleId, mounted: input.mounted, message: input.mounted ? 'Game source mounted and verified.' : 'Game source unmounted and verified.' };
  }
  function page({ search = '', offset = 0 } = {}) {
    invariant(typeof search === 'string' && search.length <= 128 && Number.isSafeInteger(offset) && offset >= 0,
      'LIBRARY_QUERY', 'Invalid library search.');
    const term = search.trim().toLowerCase();
    const matches = runtime.libraryState.games.filter(item => !term || (item.name + ' ' + item.titleId).toLowerCase().includes(term));
    return { games: clone(matches.slice(offset, offset + 100)), total: matches.length, offset,
      updatedAt: runtime.libraryState.updatedAt, available: runtime.libraryState.available, error: runtime.libraryState.error };
  }
  runtime.library = { refresh, page, scan, ready, call };
  runtime.capability('shadowmount', true, 'ShadowMount game library and verified mount controls; storage conversion jobs are still being integrated.');
  return runtime.library;
}
