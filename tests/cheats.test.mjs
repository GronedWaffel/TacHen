import test from 'node:test';
import assert from 'node:assert/strict';
import { importCheatJson, CheatSession } from '../src/cheats.mjs';
import { Profiles } from '../src/profiles.mjs';
import { store } from './helpers.mjs';
const game = { titleId: 'PPSA04263', version: '01.000.000', pid: 91, generation: 'boot-a-process-91-1' };
function document() { return { name: 'Fixture game', process: 'eboot.bin', credits: ['Fixture author'],
  mods: [{ name: 'Test patch', memory: [{ offset: '10', on: '9090', off: '0102', section: '0' }, { offset: '20', on: '9090', off: '0304' }] }] }; }
function pack() { return importCheatJson(JSON.stringify(document()), game); }
function fixture() {
  const memory = Buffer.alloc(256); Buffer.from('0102', 'hex').copy(memory, 16); Buffer.from('0304', 'hex').copy(memory, 32);
  const state = { writes: 0, releases: 0, flushes: 0, failWrite: 0, failResume: false, identity: { ...game } };
  const lease = { stopped: true, identity: async () => state.identity,
    section: async () => ({ base: '0x1000', size: '0x100', readable: true, patchable: true }),
    read: async (address, size) => Buffer.from(memory.subarray(Number(address - 0x1000n), Number(address - 0x1000n) + size)),
    write: async (address, bytes) => {
      state.writes++; bytes.copy(memory, Number(address - 0x1000n));
      if (state.writes === state.failWrite) throw Error('simulated failure after partial side effect');
    }, flush: async () => { state.flushes++; }, release: async () => { state.releases++; return !state.failResume; }
  };
  const session = new CheatSession({ identity: async () => state.identity, acquire: async () => lease });
  return { memory, state, lease, session };
}
test('JSON cheats preserve credits and normalize exact module-relative patches', () => {
  const p = pack(); assert.deepEqual(p.credits, ['Fixture author']); assert.equal(p.cheats[0].memory[0].offset, '0x10');
  const bad = document(); bad.mods[0].memory[0].section = '-1';
  assert.throws(() => importCheatJson(JSON.stringify(bad), game), { code: 'CHEAT_SECTION' });
});
test('wrong game version is rejected before the process is touched', async () => {
  const f = fixture(); await assert.rejects(f.session.set({ ...game, version: '01.001.000' }, pack(), '0', true), { code: 'CHEAT_MISMATCH' });
  assert.equal(f.state.writes, 0); assert.equal(f.state.releases, 0);
});
test('all expected bytes are checked before any patch, and mismatch resumes the game', async () => {
  const f = fixture(); f.memory[32] = 255;
  await assert.rejects(f.session.set(game, pack(), '0', true), { code: 'PATCH_MISMATCH' });
  assert.equal(f.state.writes, 0); assert.equal(f.state.releases, 1);
});
test('verified enabling and disabling restore the exact initial game bytes', async () => {
  const f = fixture(), original = Buffer.from(f.memory);
  assert.equal((await f.session.set(game, pack(), '0', true)).completed, true);
  assert.equal(f.memory.subarray(16, 18).toString('hex'), '9090');
  await f.session.set(game, pack(), '0', false); assert.deepEqual(f.memory, original); assert.equal(f.state.releases, 2);
});
test('a write failure rolls back the in-flight write as well as earlier writes', async () => {
  const f = fixture(), original = Buffer.from(f.memory); f.state.failWrite = 2;
  await assert.rejects(f.session.set(game, pack(), '0', true), /simulated failure/);
  assert.deepEqual(f.memory, original); assert.equal(f.state.writes, 4); assert.equal(f.state.releases, 1);
});
test('failed resume blocks later patches rather than claiming success', async () => {
  const f = fixture(); f.state.failResume = true;
  await assert.rejects(f.session.set(game, pack(), '0', true), { code: 'RESUME_FAILED' });
  await assert.rejects(f.session.set(game, pack(), '0', false), { code: 'CHEAT_BUSY' });
});
test('PID reuse is caught by process generation even when title and version match', async () => {
  const f = fixture(); f.state.identity.generation = 'boot-a-process-91-2';
  await assert.rejects(f.session.set(game, pack(), '0', true), { code: 'GAME_CHANGED' }); assert.equal(f.state.writes, 0);
});
test('loadouts bind exact versions and never partially autostart missing components', async () => {
  const profiles = new Profiles(await store()), hash = 'a'.repeat(64);
  await profiles.save({ ...game, name: 'Story mode', plugins: [hash], cheats: [], overlay: { fps: true }, autostart: true }, 0);
  const missing = profiles.plan(game, { plugins: [], cheats: [] });
  assert.equal(missing.autostart, false); assert.equal(missing.issues[0].code, 'PLUGIN_MISSING');
  const ready = profiles.plan(game, { plugins: [{ sha256: hash, titleId: game.titleId, version: game.version, compatible: true }], cheats: [] });
  assert.equal(ready.autostart, false); assert.equal(ready.actions[0].generation, game.generation);
  assert.equal(profiles.plan({ ...game, version: '01.002.000' }, { plugins: [], cheats: [] }).profile, null);
});


test('unequal on/off lengths check every supplied expected byte and restore captured tails after failure',async()=>{
  const value=document();value.mods[0].memory[0].on='90919293';
  const p=importCheatJson(JSON.stringify(value),game),f=fixture();f.memory[18]=0x55;f.memory[19]=0x66;
  const initial=Buffer.from(f.memory);f.state.failWrite=2;
  await assert.rejects(f.session.set(game,p,'0',true),/simulated failure/);assert.deepEqual(f.memory,initial);
  f.state.failWrite=0;await f.session.set(game,p,'0',true);
  assert.equal(f.memory.subarray(16,20).toString('hex'),'90919293');
  f.memory[19]=0xff;const writes=f.state.writes;
  await assert.rejects(f.session.set(game,p,'0',false),{code:'PATCH_MISMATCH'});assert.equal(f.state.writes,writes);
  f.memory[19]=0x93;await f.session.set(game,p,'0',false);
  assert.equal(f.memory.subarray(16,20).toString('hex'),'01029293','disable writes precisely the author-supplied Off bytes');
});
