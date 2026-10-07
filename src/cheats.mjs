// SPDX-License-Identifier: GPL-3.0-or-later
// JSON field compatibility follows etaHEN CheatManager's public JSON format.
// Executable code-cave relocation and encrypted formats need separate adapters.
import { invariant, TacError } from './errors.mjs';
import { requireGame } from './firmware.mjs';
const titlePattern = /^(PPSA|PPSB|CUSA|PCAS|PCJS|PCKS|CUHJ|SCUS)\d{5}$/;
const versionPattern = /^(?:\d{2}\.\d{3}\.\d{3}|\d{2}\.\d{2})$/;
function text(value, maximum, field) {
  invariant(typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x08\x0b-\x1f]/.test(value),
    'CHEAT_FORMAT', `Invalid cheat ${field}.`); return value;
}
function hex(value, field) {
  invariant(typeof value === 'string' && /^(?:[a-fA-F0-9]{2})+$/.test(value) && value.length <= 8192,
    'CHEAT_BYTES', `Invalid ${field} patch bytes.`); return value.toLowerCase();
}
export function importCheatJson(source, { titleId, version }) {
  invariant(titlePattern.test(titleId) && versionPattern.test(version), 'CHEAT_IDENTITY', 'Cheats require an exact title ID and version.');
  invariant(typeof source === 'string' && source.length <= 4 * 1024 * 1024, 'CHEAT_SIZE', 'Cheat document is too large.');
  let document;
  try { document = JSON.parse(source); } catch { throw new TacError('CHEAT_JSON', 'The cheat file is not valid JSON.'); }
  invariant(document && !Array.isArray(document), 'CHEAT_FORMAT', 'Cheat document must be an object.');
  if (document.id != null) invariant(document.id === titleId, 'CHEAT_IDENTITY', 'Cheat title ID differs from the selected game.');
  if (document.version != null) invariant(document.version === version, 'CHEAT_IDENTITY', 'Cheat version differs from the selected game.');
  const name = text(document.name, 200, 'name'), process = text(document.process, 128, 'process');
  invariant(!/[/\\]/.test(process), 'CHEAT_PROCESS', 'Cheat process must be a module name.');
  invariant(Array.isArray(document.mods) && document.mods.length > 0 && document.mods.length <= 1024, 'CHEAT_FORMAT', 'Invalid cheat list.');
  let totalBytes = 0;
  const cheats = document.mods.map((mod, index) => {
    invariant(mod && Array.isArray(mod.memory) && mod.memory.length > 0 && mod.memory.length <= 256, 'CHEAT_FORMAT', 'Invalid cheat memory patches.');
    const memory = mod.memory.map(patch => {
      invariant(patch && typeof patch.offset === 'string' && /^(?:0x)?[0-9a-fA-F]{1,16}$/.test(patch.offset),
        'CHEAT_OFFSET', 'Invalid module-relative patch offset.');
      invariant(!patch.absolute && !patch.codeCaveReloc, 'CHEAT_ADDRESS_MODE', 'This patch requires an address-mode adapter that is not installed.');
      const offset = BigInt(patch.offset.startsWith('0x') ? patch.offset : '0x' + patch.offset);
      const on = hex(patch.on, 'enabled'), off = hex(patch.off, 'disabled');
      invariant(on.length === off.length, 'CHEAT_LENGTH', 'Enabled and disabled patches must have matching lengths.');
      const section = patch.section == null || patch.section === '' ? 0 : Number(patch.section);
      invariant(Number.isSafeInteger(section) && section >= 0 && section < 16, 'CHEAT_SECTION', 'Invalid module section.');
      totalBytes += on.length / 2;
      return { offset: '0x' + offset.toString(16), section, on, off };
    });
    invariant(totalBytes <= 1024 * 1024, 'CHEAT_SIZE', 'Cheat patches exceed the total size limit.');
    return { id: String(index), name: text(mod.name, 200, 'name'), description: typeof mod.description === 'string' ? mod.description.slice(0, 2000) : '', memory };
  });
  return { schema: 1, titleId, version, name, process, credits: Array.isArray(document.credits) ? document.credits.filter(x => typeof x === 'string').map(x => x.slice(0, 200)).slice(0, 32) : [], cheats };
}
function sameGame(a, b) {
  return a && b && ['pid', 'generation', 'titleId', 'version'].every(key => a[key] === b[key]);
}
export class CheatSession {
  constructor(adapter) { this.adapter = adapter; this.busy = false; this.blocked = false; }
  async set(game, pack, cheatId, enabled) {
    requireGame(game);
    invariant(typeof enabled === 'boolean', 'CHEAT_STATE', 'Cheat state must be enabled or disabled.');
    invariant(!this.busy && !this.blocked, 'CHEAT_BUSY', 'Cheat execution is busy or requires recovery.');
    invariant(game.titleId === pack.titleId && game.version === pack.version, 'CHEAT_MISMATCH',
      'These cheats target a different title or game version.');
    const cheat = pack.cheats.find(item => item.id === cheatId);
    invariant(cheat, 'CHEAT_MISSING', 'Cheat was not found.');
    this.busy = true; let lease, outcome, failure; const written = [];
    try {
      invariant(sameGame(await this.adapter.identity(), game), 'GAME_CHANGED', 'The running game changed.');
      lease = await this.adapter.acquire(game);
      invariant(lease?.stopped === true && sameGame(await lease.identity(), game), 'GAME_NOT_STOPPED', 'Could not obtain a verified stopped game instance.');
      const patches = [];
      for (const memory of cheat.memory) {
        const section = await lease.section(pack.process, memory.section);
        invariant(section && section.readable === true && section.patchable === true, 'SECTION_UNAVAILABLE', 'The target module section is not safely patchable.');
        const address = BigInt(section.base) + BigInt(memory.offset), bytes = Buffer.from(enabled ? memory.on : memory.off, 'hex');
        const expected = Buffer.from(enabled ? memory.off : memory.on, 'hex');
        invariant(address >= BigInt(section.base) && address + BigInt(bytes.length) <= BigInt(section.base) + BigInt(section.size),
          'PATCH_BOUNDS', 'A cheat patch extends outside its module section.');
        const original = Buffer.from(await lease.read(address, bytes.length));
        invariant(original.length === bytes.length && original.equals(expected), 'PATCH_MISMATCH',
          'Game bytes differ from this cheat’s expected state.', { action: 'Check the game version and conflicting mods. No changes were applied.' });
        patches.push({ address, bytes, original });
      }
      patches.sort((a, b) => a.address < b.address ? -1 : 1);
      invariant(patches.every((patch, i) => !i || patches[i - 1].address + BigInt(patches[i - 1].bytes.length) <= patch.address),
        'PATCH_OVERLAP', 'This cheat contains overlapping patches.');
      invariant(sameGame(await lease.identity(), game), 'GAME_CHANGED', 'The game instance changed before patching.');
      for (const patch of patches) {
        // Include the in-flight write in rollback: a failed write can be partial.
        written.push(patch); await lease.write(patch.address, patch.bytes);
        invariant(Buffer.from(await lease.read(patch.address, patch.bytes.length)).equals(patch.bytes), 'PATCH_VERIFY', 'A patch write could not be verified.');
      }
      await lease.flush(patches.map(patch => ({ address: patch.address, length: patch.bytes.length })));
      outcome = { completed: true, cheatId, enabled, game: { ...game }, patches: patches.length };
    } catch (error) {
      failure = error;
      if (written.length && lease) {
        try {
          invariant(sameGame(await lease.identity(), game), 'GAME_CHANGED', 'Cannot roll back into a different game instance.');
          for (const patch of written.reverse()) {
            await lease.write(patch.address, patch.original);
            invariant(Buffer.from(await lease.read(patch.address, patch.original.length)).equals(patch.original), 'ROLLBACK_VERIFY', 'Rollback verification failed.');
          }
          await lease.flush(written.map(patch => ({ address: patch.address, length: patch.original.length })));
        } catch {
          this.blocked = true; failure = new TacError('PATCH_RECOVERY_REQUIRED', 'The patch could not be completely rolled back.',
            { action: 'Close the game before applying further cheats.' });
        }
      }
    } finally {
      if (lease) {
        try { invariant(await lease.release() === true, 'RESUME_FAILED', 'The game did not confirm resuming.'); }
        catch { this.blocked = true; failure = new TacError('RESUME_FAILED', 'The game did not confirm resuming.',
          { action: 'Check the console before making another change.' }); }
      }
      this.busy = false;
    }
    if (failure) throw failure;
    return outcome;
  }
}
