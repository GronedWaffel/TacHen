import { createHash } from 'node:crypto';
import { StateStore } from '../src/store.mjs';
export const checksum = value => createHash('sha256').update(value).digest('hex');
export function memoryStorage() {
  const files = new Map();
  return { files, fail: false, async read(name) { return files.get(name) ?? null; },
    async replace(name, value) { if (this.fail) throw Error('disk full'); files.set(name, value); } };
}
export async function store() { return new StateStore(memoryStorage(), checksum).open(); }
export function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
export async function until(predicate, description = 'condition') {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out: ' + description); await new Promise(resolve => setTimeout(resolve, 2)); }
}
export function ids() { let i = 0; return () => (++i).toString(16).padStart(32, '0'); }
