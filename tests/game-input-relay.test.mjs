import test from 'node:test';
import assert from 'node:assert/strict';
import { GameInputRelay } from '../src/game-input-relay.mjs';
import { GameLifecycle } from '../src/game-lifecycle.mjs';
import { encodeDeck } from '../src/deck.mjs';
function fixture() {
  let now = 1000, serial = 0, events = [];
  const calls = [], samples = new Map(), game = { pid: 91, generation: '100:0/91/200:0', metadataHash: 'a'.repeat(64) };
  const runtime = { game, graph: { safe: false }, gameStatus: { phase: 'ready' },
    jobs: { running: new Set() }, capabilities: new Map([['deck', { available: true }], ['game-overlay', { available: false }]]),
    capability(id, available) { this.capabilities.get(id).available = available; }, gameInput: { observation: { generation: game.generation, phase: 'prepared' } } };
  const native = { gameInputClock: () => now,
    gameInputExchange(pid, generation, metadataHash, epoch, mode, owner, connection) {
      calls.push({ pid, generation, metadataHash, epoch, mode, owner, connection });const id = ++serial;
      samples.set(id, { serial: id, pid, generation, metadataHash, epoch, result: 0, busy: false, time: now, deadline: now + 400, events });events = [];return id;
    }, gameInputExchangePoll: id => samples.get(id) };
  const relay = runtime.gameInputRelay = new GameInputRelay(runtime, native);
  const feedback = (extra = {}) => relay.receive({ epoch: relay.epoch, serial: relay.frame().serial, open: false, owner: -1, connection: 0, ready: true, renderedAt: now, ...extra });
  const step = (ms = 25) => { now += ms;relay.tick(); };
  const event = (buttons = 6, handle = 17, connection = 3) => ({ sequence: serial + 1, buttons, handle, connection, time: now });
  return { runtime, relay, native, calls, samples, feedback, step, event, events: value => { events = value; }, now: () => now, setNow: value => { now = value; } };
}
function prepared(f) { f.feedback();f.step();f.step();assert.equal(f.relay.frame().active, 1); }
test('game input relay waits for observed owner, capture acknowledgement and renderer delivery', () => {
  const f = fixture();prepared(f);assert.equal(f.calls[0].mode, 1);assert.equal(f.relay.frame().captured, false);
  f.feedback();f.events([f.event()]);f.step();f.step();let frame = f.relay.frame();assert.equal(frame.events.length, 1);
  f.feedback({ open: true, owner: 17, connection: 3 });f.step();assert.equal(f.calls.at(-1).mode, 2);assert.equal(f.relay.frame().captured, false);
  f.step();frame = f.relay.frame();assert.equal(frame.captured, true);assert.equal(frame.owner, 17);assert.ok(frame.captureAt > 0);
  const armedAt = frame.captureAt;f.feedback({ open: true, owner: 17, connection: 3 });f.events([f.event(0)]);f.step();f.step();
  assert.equal(f.relay.frame().captureAt, armedAt); // Renewals do not discard all prior captured events.
  f.feedback();f.step();f.step();assert.equal(f.calls.at(-1).mode, 1);assert.equal(f.relay.frame().captured, false);
});
test('undelivered frames are retained until acknowledgement, then expire without replay', () => {
  const f = fixture();prepared(f);const first = f.relay.frame();f.step(50);assert.equal(f.calls.length, 1);assert.equal(f.relay.frame().serial, first.serial);
  f.step(175);assert.notEqual(f.relay.epoch, first.epoch);assert.equal(f.relay.frame().active, 2);
  assert.equal(f.relay.frame().events.length, 0);
});
test('stalled native worker is never replaced and late completion cannot resurrect capture', () => {
  const f = fixture();f.feedback();f.step();const pending = f.relay.pending;f.samples.get(pending.serial).busy = true;
  assert.equal(f.relay.observationBusy(), true);f.step(250);assert.equal(f.relay.observationBusy(), false);
  f.feedback();f.step();assert.equal(f.calls.length, 1);assert.equal(f.relay.pending.serial, pending.serial);
  f.samples.get(pending.serial).busy = false;f.step();assert.equal(f.relay.frame().captured, false);assert.equal(f.relay.frame().events.length, 0);
});
test('renderer loss, native failures, wrong generation and pre-capture stale events release ownership', () => {
  for (const modify of [f => { f.samples.get(f.relay.pending.serial).result = -1; },
    f => { f.samples.get(f.relay.pending.serial).generation = 'replacement'; },
    f => { f.samples.get(f.relay.pending.serial).events = [{ ...f.event(), time: f.now() - 500 }]; },
    f => f.feedback({ ready: false })]) {
    const f = fixture();f.feedback();f.step();const epoch = f.relay.epoch;modify(f);f.step();
    assert.notEqual(f.relay.epoch, epoch);assert.equal(f.relay.frame().active, 2);assert.equal(f.relay.frame().events.length, 0);
  }
  const f = fixture();prepared(f);f.runtime.game = { ...f.runtime.game, generation: 'replacement' };f.step();assert.equal(f.relay.frame().active, 2);
  f.runtime.game = null;f.runtime.gameStatus.phase = 'uncertain';assert.equal(f.relay.frame().active, 2);
  f.runtime.gameStatus.phase = 'idle';assert.equal(f.relay.frame().active, 0);
});
test('unsafe and busy work never starts an exchange; controller reconnect cannot inherit capture', () => {
  const f = fixture();f.feedback();f.runtime.graph.safe = true;f.step();assert.equal(f.calls.length, 0);
  f.runtime.graph.safe = false;f.runtime.jobs.running.add('native-job');f.step();assert.equal(f.calls.length, 0);f.runtime.jobs.running.clear();
  f.step();f.step();f.feedback();f.events([f.event()]);f.step();f.step();
  assert.throws(() => f.feedback({ open: true, owner: 17, connection: 4 }), { code: 'INPUT_OWNER' });
  assert.throws(() => f.feedback({ renderedAt: f.now() + 1 }), { code: 'INPUT_FEEDBACK_TIME' });
  assert.throws(() => f.feedback({ owner: '17' }), { code: 'INPUT_FEEDBACK' });
  f.feedback();f.events([f.event(0, 17, 4)]);f.step();f.step();
  assert.throws(() => f.feedback({ open: true, owner: 17, connection: 3 }), { code: 'INPUT_OWNER' });
});
test('game input packets use independent wire fields without changing menu identity', () => {
  const f = fixture();prepared(f);f.feedback();f.events([f.event(0x4000)]);f.step();f.step();
  const bytes = encodeDeck({ sequence: 7, page: 0, rows: [], title: 'TacHen', ready: true, input: f.relay.frame() });
  assert.equal(bytes.length, 6120);assert.equal(bytes.readUInt32LE(8), 7);assert.equal(bytes.readUInt32LE(3000), f.relay.epoch);
  assert.equal(bytes.readUInt32LE(3024), 1);assert.equal(bytes.readUInt32LE(3048), 0x4000);assert.equal(bytes.readInt32LE(3052), 17);
  assert.equal(Number(bytes.readBigUInt64LE(3064)), f.relay.frame().events[0].time);
});
test('lifecycle defers only for a verified short-lived input worker and retries the census', async () => {
  const f = fixture(), monitor = new GameLifecycle(f.runtime, { systemProbe: () => ({ busy: true }) });
  f.runtime.gameStatus.phase = 'ready';f.feedback();f.step();f.samples.get(f.relay.pending.serial).busy = true;
  await monitor.refresh();assert.equal(monitor.deferred, true);assert.ok(f.runtime.game);
  f.step(250);await monitor.refresh();assert.equal(monitor.deferred, false);assert.equal(f.runtime.game, null);
});
