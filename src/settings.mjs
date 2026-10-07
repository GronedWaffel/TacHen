// SPDX-License-Identifier: GPL-3.0-or-later
import { clone, invariant } from './errors.mjs';
export const defaults = Object.freeze({
  overlay: { fps: false, ram: false, cpu: false, ip: false, adaptive: true },
  services: { ftp: true, inboxAutoRun: false },
  developer: { enabled: false, memoryWrites: false, diagnostics: false },
  appearance: { accent: 'mint', reducedMotion: false }
});
const fields = {
  overlay: { fps: 'boolean', ram: 'boolean', cpu: 'boolean', ip: 'boolean', adaptive: 'boolean' },
  services: { ftp: 'boolean', inboxAutoRun: 'boolean' },
  developer: { enabled: 'boolean', memoryWrites: 'boolean', diagnostics: 'boolean' },
  appearance: { accent: ['mint', 'amber', 'ice'], reducedMotion: 'boolean' }
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
    startup: { pending: false, session: null, safe: false }, jobs: [], profiles: {}, history: [] };
}
export function validateState(state) {
  invariant(state?.schema === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0 &&
    Array.isArray(state.jobs) && state.jobs.length <= 1024 && Array.isArray(state.history) &&
    state.history.length <= 256 && state.startup && typeof state.startup.pending === 'boolean' &&
    state.profiles && typeof state.profiles === 'object' && !Array.isArray(state.profiles),
  'STATE_INVALID', 'Saved TacHen state is not valid.');
  state.settings = mergeSettings(defaults, state.settings);
  state.knownGood = mergeSettings(defaults, state.knownGood);
  return state;
}
