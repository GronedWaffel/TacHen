// SPDX-License-Identifier: GPL-3.0-or-later
import { invariant } from './errors.mjs';
const uint = x => Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
export class GameInputRelay {
  constructor(runtime, native) {
    this.runtime = runtime;this.native = native;this.epoch = 1;this.serial = 0;this.key = '';this.pending = null;
    this.batch = null;this.feedback = null;this.owners = new Map();this.deadline = 0;this.capture = null;this.timer = null;this.stopped = true;
  }
  now() { return this.native.gameInputClock(); }
  target() {
    const r = this.runtime, game = r.game;
    if (!game || r.graph.safe || !r.capabilities.get('deck').available || r.gameInput?.observation?.generation !== game.generation || r.gameInput.observation.phase !== 'prepared') return null;
    return { ...game, key: game.generation + ':' + game.metadataHash };
  }
  rendered(now) {
    const f = this.feedback;
    return f?.ready && now >= f.at && now - f.at <= 300 && now >= f.renderedAt && now - f.renderedAt <= 300;
  }
  observationBusy() {
    const p = this.pending, now = this.now();
    return Boolean(p && p.key === this.target()?.key && now >= p.at && now - p.at <= 200 &&
      !this.runtime.jobs.running.size && this.native.gameInputExchangePoll(p.serial)?.busy);
  }
  reset() {
    this.epoch = (this.epoch + 1) >>> 0 || 1;this.serial = 0;this.batch = null;this.deadline = 0;this.capture = null;this.owners.clear();
  }
  receive(input) {
    invariant(input && uint(input.epoch) && uint(input.serial) && typeof input.open === 'boolean' && typeof input.ready === 'boolean' &&
      Number.isInteger(input.owner) && input.owner >= -1 && input.owner <= 0x7fffffff && uint(input.connection) && input.connection <= 255 &&
      Number.isSafeInteger(input.renderedAt) && input.renderedAt >= 0, 'INPUT_FEEDBACK', 'Invalid native renderer input feedback.', { status: 400 });
    const now = this.now();
    invariant(input.renderedAt <= now, 'INPUT_FEEDBACK_TIME', 'Renderer timestamp is ahead of the console clock.', { status: 400 });
    if (input.open && input.epoch === this.epoch) {
      const owner = this.owners.get(input.owner);
      invariant(owner && owner.connection === input.connection && now >= owner.at && now - owner.at <= 500,
        'INPUT_OWNER', 'The requesting controller is no longer verified.', { status: 409 });
    }
    this.feedback = { ...input, at: now };
    if (input.epoch === this.epoch && this.batch && input.serial === this.batch.serial) this.batch = null;
  }
  tick() {
    const now = this.now(), target = this.target(), key = target?.key || '';
    if (key !== this.key) { this.reset();this.key = key; }
    const ready = now > 0 && target && this.rendered(now);
    if (this.pending) {
      const pending = this.pending, sample = this.native.gameInputExchangePoll(pending.serial);
      if (sample?.busy) {
        if ((!ready || now < pending.at || now - pending.at > 200) && pending.epoch === this.epoch) this.reset();
        return; // Never replace a worker that has not actually completed.
      }
      this.pending = null;
      if (ready && pending.epoch === this.epoch && pending.key === key && now >= pending.at && now - pending.at <= 200 &&
        sample?.serial === pending.serial && sample.pid === target.pid && sample.generation === target.generation &&
        sample.metadataHash === target.metadataHash && sample.epoch === this.epoch && sample.result === 0 &&
        sample.time > 0 && sample.time <= now + 1 && sample.time >= pending.at && sample.deadline > now && sample.deadline - now <= 400 && Array.isArray(sample.events) && sample.events.length <= 128 &&
        sample.events.every(e => uint(e.sequence) && uint(e.buttons) && Number.isInteger(e.handle) && e.handle >= 0 && e.handle <= 0x7fffffff &&
          uint(e.connection) && e.connection <= 255 && e.time > 0 && e.time <= now + 1 && now - e.time <= 200)) {
        if (this.serial === 0xffffffff) { this.reset();return; }
        this.batch = { serial: ++this.serial, events: sample.events, at: now };
        const continued = this.capture?.owner === pending.owner && this.capture?.connection === pending.connection && this.deadline > now;
        this.capture = pending.mode === 2 ? { owner: pending.owner, connection: pending.connection, at: continued ? this.capture.at : sample.time } : null;
        this.deadline = sample.deadline;
        for (const [handle, owner] of this.owners) if (now - owner.at > 2000) this.owners.delete(handle);
        for (const e of sample.events) this.owners.set(e.handle, { connection: e.connection, at: e.time });
        if (this.owners.size > 16) { this.reset();return; }
      } else if (pending.epoch === this.epoch) this.reset();
    }
    if (!ready) { if (this.deadline || this.batch) this.reset();return; }
    if (this.batch) { if (now - this.batch.at > 200) this.reset();else return; }
    if (this.runtime.jobs.running.size) return;
    const feedback = this.feedback, owner = this.owners.get(feedback.owner);
    const capture = feedback.epoch === this.epoch && feedback.open && owner && owner.connection === feedback.connection && now - owner.at <= 500;
    const mode = capture ? 2 : 1;
    try {
      const serial = this.native.gameInputExchange(target.pid, target.generation, target.metadataHash, this.epoch, mode, capture ? feedback.owner : -1, capture ? feedback.connection : 0);
      invariant(uint(serial) && serial > 0, 'INPUT_EXCHANGE', 'Invalid input exchange identity.');
      this.pending = { serial, epoch: this.epoch, key, at: now, mode, owner: feedback.owner, connection: feedback.connection };
    } catch (error) { if (error.code !== 'NATIVE_BUSY') { this.reset();throw error; } }
  }
  frame() {
    const now = this.now(), target = this.target();
    const active = target && target.key === this.key && this.rendered(now) && this.deadline > now ? 1 :
      this.runtime.game || (this.runtime.gameStatus && this.runtime.gameStatus.phase !== 'idle') ? 2 : 0;
    return { epoch: this.epoch, serial: this.batch?.serial || this.serial, active, captured: active === 1 && Boolean(this.capture),
      owner: this.capture?.owner ?? -1, connection: this.capture?.connection ?? 0,
      captureAt: active === 1 ? this.capture?.at || 0 : 0,
      deadline: active === 1 ? Math.min(this.deadline, this.feedback.at + 300) : 0, events: active === 1 ? this.batch?.events || [] : [] };
  }
  start() {
    if (!this.stopped) return;this.stopped = false;
    this.timer = setInterval(() => {
      try { this.tick(); } catch { this.reset(); }
      const ready = this.frame().active === 1 && [...this.owners.values()].some(owner => this.now() - owner.at <= 300);
      if (this.runtime.capabilities.get('game-overlay').available !== ready)
        this.runtime.capability('game-overlay', ready, ready ? 'Game input and native renderer are responding.' : 'Waiting for current game input and native renderer.');
    }, 25);
  }
  stop() { this.stopped = true;clearInterval(this.timer);this.timer = null;this.reset();this.runtime.capability('game-overlay', false, 'Game input relay stopped.'); }
}
export function installGameInputRelay(runtime, native) {
  if (!['gameInputClock', 'gameInputExchange', 'gameInputExchangePoll'].every(k => typeof native[k] === 'function')) return null;
  return runtime.gameInputRelay = new GameInputRelay(runtime, native);
}
