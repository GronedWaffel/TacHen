import test from 'node:test';
import assert from 'node:assert/strict';
import { importCheatJson, cheatPacket, CheatSession } from '../src/cheats.mjs';
import { CheatPacks } from '../src/cheat-packs.mjs';
import { store, memoryStorage } from './helpers.mjs';
const game = { titleId: 'CUSA00001', version: '01.00', pid: 88, generation: 'boot:1/game:88' };
const relative = { offset: '10', on: '9090', off: '0102' }, absolute = { offset: '600020', on: '9191', off: '0304', absolute: true };
const source = (memory = [relative, absolute]) => JSON.stringify({ name: 'Original addressing fixture', process: 'eboot.bin', mods: [{ name: 'Mixed modes', memory }] });
const pack = (memory) => importCheatJson(source(memory), game);
test('address modes persist through canonical storage and versioned bidirectional packets', async () => {
  const runtime = { store: await store(), sequence: 0 }, catalog = new CheatPacks(runtime, memoryStorage());
  const entry = await catalog.import({ source: source(), ...game }), restored = await catalog.read(entry.sha256);
  assert.equal(restored.cheats[0].memory[1].absolute, true); assert(!('absolute' in restored.cheats[0].memory[0]));
  for (const enabled of [true, false]) {
    const wire = cheatPacket(restored, '0', enabled); assert.equal(wire.readUInt32LE(4), 2);
    assert.equal(wire.readUInt32LE(28), 0); assert.equal(wire.readUInt32LE(48), 1);
    assert.equal(wire.readBigUInt64LE(36), 0x600020n);
    assert.equal(wire.subarray(52, 54).toString('hex'), enabled ? '0304' : '9191');
  }
  assert.equal(cheatPacket(pack([relative]), '0', true).readUInt32LE(4), 1);
  assert.deepEqual(cheatPacket(pack([{ ...relative, absolute: false }]), '0', true), cheatPacket(pack([relative]), '0', true));
});
test('malformed mode flags, unsafe virtual addresses and same-mode overlaps are rejected', () => {
  for (const value of ['false', 0, 1, {}, []]) assert.throws(() => pack([{ ...absolute, absolute: value }]), { code: 'CHEAT_ADDRESS_MODE' });
  for (const offset of ['0', 'ffff', '7fffffffffff', '800000000000', 'ffffffffffffffff'])
    assert.throws(() => cheatPacket(pack([{ ...absolute, offset }]), '0', true), { code: 'PATCH_BOUNDS' });
  assert.throws(() => cheatPacket(pack([absolute, { ...absolute, offset: '600021' }]), '0', true), { code: 'PATCH_OVERLAP' });
  assert.throws(() => pack([{ ...absolute, codeCaveReloc: true }]), { code: 'CHEAT_ADDRESS_MODE' });
  // Absolute addresses explicitly bypass section rebasing; relative nonzero sections remain unsupported.
  assert.equal(cheatPacket(pack([{ ...absolute, section: 3 }]), '0', true).readUInt32LE(28), 1);
  assert.throws(() => cheatPacket(pack([{ ...relative, section: 3 }]), '0', true), { code: 'CHEAT_SECTION_UNSUPPORTED' });
});
function fixture({ alias = false, failWrite = 0 } = {}) {
  const memory = new Map([[0x400010n, Buffer.from('0102', 'hex')], [0x600020n, Buffer.from('0304', 'hex')]]);
  let writes = 0, releases = 0;
  const lease = { stopped: true, identity: async () => game,
    section: async () => ({ base: alias ? 0x600010n : 0x400000n, size: 0x100n, readable: true, patchable: true }),
    absolute: async (module, at, bytes) => { assert.equal(module, 'eboot.bin'); assert.equal(at, 0x600020n); assert.equal(bytes, 2);
      return { base: at, size: 2n, readable: true, patchable: true }; },
    read: async at => alias ? Buffer.from('0304', 'hex') : Buffer.from(memory.get(at)),
    write: async (at, bytes) => { writes++; memory.set(at, Buffer.from(bytes)); if (writes === failWrite) throw Error('partial write'); },
    flush: async () => {}, release: async () => { releases++; return true; } };
  return { lease, memory, writes: () => writes, releases: () => releases,
    session: new CheatSession({ identity: async () => game, acquire: async () => lease }) };
}
test('absolute regions use the same expected-byte and rollback transaction', async () => {
  const f = fixture(); await f.session.set(game, pack(), '0', true); assert.equal(f.memory.get(0x600020n).toString('hex'), '9191');
  await f.session.set(game, pack(), '0', false); assert.equal(f.memory.get(0x600020n).toString('hex'), '0304'); assert.equal(f.releases(), 2);
  const failing = fixture({ failWrite: 2 }); await assert.rejects(failing.session.set(game, pack(), '0', true), /partial write/);
  assert.equal(failing.memory.get(0x400010n).toString('hex'), '0102'); assert.equal(failing.memory.get(0x600020n).toString('hex'), '0304');
  assert.equal(failing.writes(), 4); assert.equal(failing.releases(), 1);
  const unsupported = fixture(); delete unsupported.lease.absolute;
  await assert.rejects(unsupported.session.set(game, pack(), '0', true), { code: 'CHEAT_ADDRESS_MODE' }); assert.equal(unsupported.writes(), 0);
});
test('resolved mixed-mode aliases cannot reach a write', async () => {
  const f = fixture({ alias: true });
  await assert.rejects(f.session.set(game, pack([{ ...relative, off: '0304' }, absolute]), '0', true), { code: 'PATCH_OVERLAP' });
  assert.equal(f.writes(), 0); assert.equal(f.releases(), 1);
});


test('version 3 encodes independent expected and desired counts with full-span bounds and overlaps',()=>{
  const input=pack([{...relative,on:'90919293'}]);
  const on=cheatPacket(input,'0',true),off=cheatPacket(input,'0',false);
  assert.equal(on.readUInt32LE(4),3);assert.equal(on.length,42);
  assert.equal(on.readUInt32LE(24),2);assert.equal(on.readUInt32LE(28),4);assert.equal(on.readUInt32LE(32),0);
  assert.equal(on.subarray(36).toString('hex'),'010290919293');
  assert.equal(off.readUInt32LE(24),4);assert.equal(off.readUInt32LE(28),2);
  assert.equal(off.subarray(36).toString('hex'),'909192930102');
  assert.throws(()=>cheatPacket(pack([{...relative,on:'90919293'},{...relative,offset:'13'}]),'0',true),{code:'PATCH_OVERLAP'});
  assert.throws(()=>cheatPacket(pack([{...absolute,offset:'7ffffffffffd',on:'90919293'}]),'0',true),{code:'PATCH_BOUNDS'});
});
