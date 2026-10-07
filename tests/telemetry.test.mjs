import test from 'node:test';
import assert from 'node:assert/strict';
import { CounterWindow, installTelemetry, telemetryText } from '../src/telemetry.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { store, ids } from './helpers.mjs';
const sample = (time, overrides = {}) => ({ time, ring: String(time * 60 / 1000), scanout: String(time * 60 / 1000), cpuUsec: String(time * 4000), cpus: 8, rssBytes: 512 * 1024 ** 2, ...overrides });
test('counter differences retain uint64 precision and CPU means total logical capacity', () => {
  const rates = new CounterWindow(), high = 0xffffffffffff0000n;
  let out = rates.consume(sample(1000, { ring: String(high) }));assert.equal(out.fps, null);assert.equal(out.cpuPercent, null);
  out = rates.consume(sample(1500, { ring: String(high + 30n) }));
  assert.equal(out.fps, 60);assert.equal(out.fpsSource, 'agc-ring');assert.equal(out.cpuPercent, 50);assert.equal(out.rssBytes, 512 * 1024 ** 2);
});
test('counter stalls, regressions, missing sources and stale intervals never reuse an old rate', () => {
  const rates = new CounterWindow();rates.consume(sample(1000));assert.equal(rates.consume(sample(1500)).fps, 60);
  let out = rates.consume(sample(2000, { ring: '90', scanout: undefined }));assert.equal(out.fps, null);
  out = rates.consume(sample(2500, { ring: '3', scanout: undefined, cpuUsec: '0' }));assert.equal(out.fps, null);assert.equal(out.cpuPercent, null);
  out = rates.consume(sample(8000));assert.equal(out.fps, null);assert.equal(out.cpuPercent, null);
  out = rates.consume(sample(8500, { ring: '18446744073709551616', scanout: undefined }));assert.equal(out.fps, null);
});
test('display fallback is explicitly different from game FPS, including sustained multipass submissions', () => {
  const rates = new CounterWindow();rates.consume(sample(1000, { ring: undefined }));
  let out = rates.consume(sample(1500, { ring: undefined }));assert.equal(out.fps, 60);assert.equal(out.fpsSource, 'display-scanout');
  rates.reset();for (let i = 1; i <= 101; i++) out = rates.consume(sample(i * 500, { ring: String(i * 90) }));
  assert.equal(out.fps, 60);assert.equal(out.fpsSource, 'display-scanout');assert.match(out.reason, /game frame rate is unavailable/);
  assert.match(telemetryText({ settings: { overlay: { fps: true } }, telemetry: out }), /^Display 60/);
});
async function fixture(t) {
  let time = 1000, serial = 0;const calls = [], responses = new Map();
  const native = { telemetryStart(...args) { calls.push(args);return ++serial; }, telemetryPoll: id => responses.get(id) || null };
  const runtime = await new TacRuntime(await store(), { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    install(runtime) { installTelemetry(runtime, native, { now: () => time }); }
  }, { id: ids() }).start();t.after(() => runtime.close());
  runtime.game = { pid: 91, generation: '100:0/91/101:0', titleId: 'PPSA00001' };
  const settings = patch => runtime.settings({ overlay: patch }, runtime.store.snapshot().revision);
  const reply = (id, overrides = {}) => responses.set(id, { serial: id, valid: true, pid: runtime.game.pid, generation: runtime.game.generation, ...sample(time), ...overrides });
  return { runtime, native, calls, responses, settings, reply, tick(ms = 0) { time += ms;runtime.telemetry.tick(); } };
}
test('sampler does no disabled/idle/safe work and publishes only fresh game-bound observations', async t => {
  const f = await fixture(t);f.tick();assert.equal(f.calls.length, 0);
  await f.settings({ fps: true, ram: true, cpu: true });f.tick();assert.equal(f.calls.length, 1);f.reply(1);f.tick();
  assert.equal(f.runtime.snapshot().telemetry.fps, null);f.tick(500);f.reply(2);f.tick();assert.equal(f.runtime.snapshot().telemetry.fps, 60);
  f.runtime.game = null;f.tick(500);assert.equal(f.runtime.snapshot().telemetry.fps, null);assert.equal(f.calls.length, 2);
  f.runtime.game = { pid: 91, generation: '100:0/91/999:0', titleId: 'PPSA00001' };
  f.runtime.graph.safe = true;f.tick(1000);assert.equal(f.calls.length, 2);
  f.runtime.graph.safe = false;f.tick();assert.equal(f.calls.length, 3);f.reply(3);f.tick();assert.equal(f.runtime.snapshot().telemetry.fps, null);
});
test('a stalled native sample is never replaced; late and reused-PID samples are discarded', async t => {
  const f = await fixture(t);await f.settings({ fps: true });f.tick();f.tick(5000);
  assert.equal(f.calls.length, 1);assert.match(f.runtime.snapshot().telemetry.reason, /still pending/);
  f.runtime.game.generation = '100:0/91/999:0';f.tick();f.reply(1, { generation: '100:0/91/101:0' });f.tick();
  assert.equal(f.runtime.snapshot().telemetry.fps, null);f.tick(500);assert.equal(f.calls.length, 2);
  await f.settings({ fps: false });f.reply(2);f.tick();assert.equal(f.runtime.snapshot().telemetry.fps, null);assert.equal(f.calls.length, 2);
});
test('jobs take precedence and a native busy result schedules no second worker', async t => {
  const f = await fixture(t);await f.settings({ ram: true });f.runtime.jobs.running.set('fixture', {});f.tick();assert.equal(f.calls.length, 0);
  f.runtime.jobs.running.clear();f.native.telemetryStart = () => null;f.tick();assert.equal(f.runtime.telemetry.pending, null);
  assert.equal(f.runtime.snapshot().telemetry.rssBytes, null);
});
test('turning a preference off and back on discards a pending sample and previous interval', async t => {
  const f = await fixture(t);await f.settings({ fps: true });f.tick();await f.settings({ fps: false });await f.settings({ fps: true });
  f.reply(1);f.tick();assert.equal(f.runtime.telemetry.last, null);f.tick(500);f.reply(2);f.tick();assert.equal(f.runtime.snapshot().telemetry.fps, null);
});
