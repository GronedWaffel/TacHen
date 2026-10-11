// SPDX-License-Identifier: GPL-3.0-or-later
import { clone, invariant } from './errors.mjs';
import { validatePlugins } from './plugin-schema.mjs';
import { validateCheatRegistry } from './cheat-packs.mjs';
import { validateProfiles } from './profiles.mjs';
import { validateJobArchive } from './job-archive.mjs';
import { validateStartupPayloads } from './startup-payloads.mjs';
export const defaults = Object.freeze({
  overlay: { fps: false, ram: false, cpu: false, ip: false, adaptive: true },
  services: { ftp: true, inboxAutoRun: false, shadowmount: true, payloadManager: true },
  developer: { enabled: false, memoryWrites: false, diagnostics: false },
  appearance: { accent: 'mint', reducedMotion: false, gameCardDetails: false }
});
const fields = {
  overlay: { fps: 'boolean', ram: 'boolean', cpu: 'boolean', ip: 'boolean', adaptive: 'boolean' },
  services: { ftp: 'boolean', inboxAutoRun: 'boolean', shadowmount: 'boolean', payloadManager: 'boolean' },
  developer: { enabled: 'boolean', memoryWrites: 'boolean', diagnostics: 'boolean' },
  appearance: { accent: ['mint', 'amber', 'ice'], reducedMotion: 'boolean', gameCardDetails: 'boolean' }
};
export function mergeSettings(current, patch) {
  invariant(patch && typeof patch === 'object' && !Array.isArray(patch), 'BAD_SETTINGS', 'Invalid settings.', { status: 400 });
  const next = clone(current);
  for (const [group, values] of Object.entries(patch)) {
    invariant(Object.hasOwn(fields, group) && values && typeof values === 'object' && !Array.isArray(values),
      'BAD_SETTINGS', 'Unknown settings group.', { status: 400 });
    for (const [key, value] of Object.entries(values)) {
      const kind = Object.hasOwn(fields[group], key) ? fields[group][key] : null;
      invariant(kind && (Array.isArray(kind) ? kind.includes(value) : typeof value === kind),
        'BAD_SETTINGS', `Invalid setting ${group}.${key}.`, { status: 400 });
      next[group][key] = value;
    }
  }
  if (!next.developer.enabled) next.developer.memoryWrites = false;
  return next;
}
export function initialState() {
  return { schema: 1, revision: 0, settings: clone(defaults), knownGood: clone(defaults),
    startup: { pending: false, session: null, safe: false, native: null }, knownGoodReceipt: null, jobs: [], profiles: {}, plugins: [], cheats: [], history: [] };
}
export function validateState(state) {
  invariant(state?.schema === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0 &&
    Array.isArray(state.jobs) && state.jobs.length <= 1024 && Array.isArray(state.history) &&
    state.history.length <= 256 && state.startup && typeof state.startup.pending === 'boolean' &&
    state.profiles && typeof state.profiles === 'object' && !Array.isArray(state.profiles),
  'STATE_INVALID', 'Saved TacHen state is not valid.');
  state.settings = mergeSettings(defaults, state.settings);
  state.knownGood = mergeSettings(defaults, state.knownGood);
  const services = value => Array.isArray(value) && value.length <= 4 && new Set(value).size === value.length &&
    value.every(id => ['kstuff', 'native-deck', 'shadowmount', 'payload-manager'].includes(id));
  const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  invariant(typeof state.startup.safe === 'boolean' && (state.startup.session === null || id(state.startup.session)), 'STATE_INVALID', 'Saved startup identity is invalid.');
  if (state.startup.native != null) {
    const n = state.startup.native;
    invariant(n.boot == null || typeof n.boot === 'string' && n.boot.length > 0 && n.boot.length <= 80,
      'STATE_INVALID', 'Saved console boot identity is invalid.');
    invariant(id(n.id) && ['starting', 'ready', 'failed'].includes(n.status) && Number.isSafeInteger(n.at) && n.at >= 0 && services(n.services) &&
      (n.service === null || n.services.includes(n.service)) && (n.error === null || typeof n.error.code === 'string' && n.error.code.length <= 80 &&
      typeof n.error.message === 'string' && n.error.message.length <= 4096), 'STATE_INVALID', 'Saved native startup evidence is invalid.');
  }
  if (state.knownGoodReceipt != null) {
    const good = state.knownGoodReceipt;
    invariant(id(good.session) && Number.isSafeInteger(good.at) && good.at >= 0 && services(good.services) &&
      (good.firmware === null || /^\d{2}\.\d{2}$/.test(good.firmware)), 'STATE_INVALID', 'Saved verified-startup receipt is invalid.');
  }
  state.plugins = validatePlugins(state.plugins ?? []);
  state.startupPayloads = validateStartupPayloads(state.startupPayloads ?? []);
  state.cheats = validateCheatRegistry(state.cheats ?? []);
  state.profiles = validateProfiles(state.profiles);
  state.jobArchive = validateJobArchive(state.jobArchive);
  return state;
}
