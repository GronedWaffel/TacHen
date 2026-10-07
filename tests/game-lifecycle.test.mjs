import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGameMetadata, readSfo } from '../src/game-metadata.mjs';
import { GameLifecycle, selectGameProcess } from '../src/game-lifecycle.mjs';
function sfo(fields) {
  const entries = Object.entries(fields), keys = 20 + entries.length * 16;
  const keyBytes = Buffer.from(entries.map(([key]) => key + '\0').join(''));
  const start = (keys + keyBytes.length + 3) & ~3, data = entries.map(([, value]) => Buffer.from(value + '\0'));
  const capacities = data.map(value => (value.length + 3) & ~3);
  const bytes = Buffer.alloc(start + capacities.reduce((a, b) => a + b, 0));
  bytes.writeUInt32LE(0x46535000); bytes.writeUInt32LE(0x101, 4); bytes.writeUInt32LE(keys, 8);
  bytes.writeUInt32LE(start, 12); bytes.writeUInt32LE(entries.length, 16); keyBytes.copy(bytes, keys);
  let keyAt = 0, dataAt = 0;
  for (let i = 0; i < entries.length; i++) {
    const at = 20 + i * 16; bytes.writeUInt16LE(keyAt, at); bytes.writeUInt16LE(0x204, at + 2);
    bytes.writeUInt32LE(data[i].length, at + 4); bytes.writeUInt32LE(capacities[i], at + 8); bytes.writeUInt32LE(dataAt, at + 12);
    data[i].copy(bytes, start + dataAt); keyAt += Buffer.byteLength(entries[i][0]) + 1; dataAt += capacities[i];
  }
  return bytes;
}
const json = (overrides = {}) => Buffer.from(JSON.stringify({ titleId: 'PPSA00001', contentVersion: '01.002.003',
  localizedParameters: { defaultLanguage: 'en-US', 'en-US': { titleName: 'Example game' } }, ...overrides }));
test('game metadata uses exact mounted PS5 contentVersion and PS4 APP_VER', () => {
  const ps5 = inspectGameMetadata('json', json(), 'PPSA00001'); assert.equal(ps5.version, '01.002.003'); assert.equal(ps5.name, 'Example game');
  const ps4 = inspectGameMetadata('sfo', sfo({ TITLE_ID: 'CUSA00001', TITLE: 'Example PS4', APP_VER: '01.09', VERSION: '99.99' }), 'CUSA00001');
  assert.equal(ps4.version, '01.09'); assert.equal(ps4.platform, 'ps4'); assert.equal(ps4.metadataHash.length, 64);
});
test('wrong title, missing patch version and invalid UTF-8 cannot authorize game modifications', () => {
  assert.throws(() => inspectGameMetadata('json', json(), 'PPSA00002'), { code: 'GAME_METADATA_IDENTITY' });
  assert.throws(() => inspectGameMetadata('sfo', sfo({ TITLE_ID: 'CUSA00001', VERSION: '01.00' }), 'CUSA00001'), { code: 'GAME_SFO_FIELD' });
  assert.throws(() => inspectGameMetadata('json', json({ contentVersion: '1.2' }), 'PPSA00001'), { code: 'GAME_VERSION' });
  const corrupt = json(); corrupt[corrupt.indexOf('Example')] = 0xff;
  assert.throws(() => inspectGameMetadata('json', corrupt, 'PPSA00001'), { code: 'GAME_METADATA_STRING' });
});
test('SFO key/value bounds, duplicates and overlapping storage are rejected', () => {
  const input = sfo({ TITLE_ID: 'CUSA00001', APP_VER: '01.09' });
  for (const mutate of [b => b.writeUInt32LE(0xffffffff, 12), b => b.writeUInt32LE(0xffffffff, 28),
    b => b.writeUInt16LE(0, 36), b => b.writeUInt32LE(0, 48)]) {
    const bytes = Buffer.from(input); mutate(bytes); assert.throws(() => readSfo(bytes));
  }
});
const process = (pid = 101, generation = 'boot/101/100:0') => ({ pid, generation, appId: 24, titleId: 'PPSA00001', name: 'eboot.bin' });
function fixture() {
  const runtime = { sequence: 0, game: null }; let processes = [process()], busy = false, available = true, metadata = json(), scope = 'running-sandbox';
  const native = { systemProbe: () => ({ busy, appInfoAvailable: available, processes }),
    gameMetadata: () => ({ format: 'json', bytes: metadata, scope }) };
  const monitor = new GameLifecycle(runtime, native), events = []; monitor.subscribe(event => events.push(event));
  return { runtime, monitor, events, processes: value => { processes = value; }, busy: value => { busy = value; },
    available: value => { available = value; }, metadata: value => { metadata = value; }, scope: value => { scope = value; } };
}
test('two consistent observations publish one game start and an actual absence publishes one exit', async () => {
  const f = fixture(); await f.monitor.refresh(); assert.equal(f.runtime.game, null); assert.equal(f.runtime.gameStatus.phase, 'discovering');
  await f.monitor.refresh(); assert.equal(f.runtime.game.version, '01.002.003'); assert.equal(f.events[0].type, 'start');
  await f.monitor.refresh(); assert.equal(f.events.length, 1); f.processes([]); await f.monitor.refresh();
  assert.deepEqual(f.events.map(e => e.type), ['start', 'exit']); assert.equal(f.runtime.gameStatus.phase, 'idle');
});
test('PID reuse invalidates the old instance before allowing a new lifecycle', async () => {
  const f = fixture(); await f.monitor.refresh(); await f.monitor.refresh();
  f.processes([process(101, 'boot/101/999:0')]); await f.monitor.refresh(); assert.equal(f.runtime.game, null);
  assert.deepEqual(f.events.map(e => e.type), ['start', 'unavailable']); await f.monitor.refresh();
  assert.deepEqual(f.events.map(e => e.type), ['start', 'unavailable', 'exit', 'start']);
  assert.equal(f.runtime.game.generation, 'boot/101/999:0');
});
test('native contention holds game actions without inventing an exit or duplicate start', async () => {
  const f = fixture(); await f.monitor.refresh(); await f.monitor.refresh(); f.busy(true); await f.monitor.refresh();
  assert.equal(f.runtime.game, null); assert.equal(f.runtime.gameStatus.phase, 'uncertain');
  f.busy(false); await f.monitor.refresh(); await f.monitor.refresh();
  assert.deepEqual(f.events.map(e => e.type), ['start', 'unavailable', 'available']);
});
test('ambiguous apps and cached-only metadata remain unverified', async () => {
  assert.throws(() => selectGameProcess([process(), { ...process(102), appId: 25 }]), { code: 'GAME_AMBIGUOUS' });
  assert.equal(selectGameProcess([process(), { ...process(102), name: 'worker' }]).pid, 101);
  const f = fixture(); f.scope('appmeta-cache'); await f.monitor.refresh(); assert.equal(f.runtime.game, null);
  assert.equal(f.runtime.gameStatus.error.code, 'GAME_METADATA_SOURCE'); f.available(false); await f.monitor.refresh();
  assert.equal(f.runtime.gameStatus.error.code, 'GAME_API_UNAVAILABLE');
});
test('subscriber faults are contained and do not stop other lifecycle consumers', async () => {
  const f = fixture(); let notified = 0; f.monitor.subscribe(() => { throw Error('plugin failed'); }); f.monitor.subscribe(() => { notified++; });
  await f.monitor.refresh(); await f.monitor.refresh(); assert.equal(notified, 1); assert.equal(f.runtime.gameStatus.phase, 'ready');
  assert.equal(f.runtime.lifecycleErrors.length, 1);
});
test('slow lifecycle consumers never delay exit detection and their old instance signal is aborted', async () => {
  const f = fixture(); let signal;
  f.monitor.subscribe(event => { if (event.type === 'start') { signal = event.signal; return new Promise(() => {}); } });
  await f.monitor.refresh(); await f.monitor.refresh(); assert.equal(signal.aborted, false);
  f.processes([]); await f.monitor.refresh(); assert.equal(signal.aborted, true); assert.equal(f.runtime.gameStatus.phase, 'idle');
});
