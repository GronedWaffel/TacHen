// SPDX-License-Identifier: GPL-3.0-or-later
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { invariant } from './errors.mjs';
import { inspectPayload, MAX_PAYLOAD } from './payload-format.mjs';

export class PayloadInbox {
  constructor(root, { id }) { this.root = root; this.id = id; this.locks = new Map(); }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    invariant(!(await fs.lstat(this.root)).isSymbolicLink(), 'INBOX_PATH', 'The inbox cannot be a symbolic link.');
    return this;
  }
  file(id, suffix) {
    invariant(/^[a-f0-9]{32}$/.test(id), 'UPLOAD_ID', 'Invalid upload identity.', { status: 400 });
    return path.join(this.root, id + suffix);
  }
  exclusive(id, action) {
    const prior = this.locks.get(id) || Promise.resolve();
    const operation = prior.catch(() => {}).then(action); this.locks.set(id, operation);
    operation.finally(() => { if (this.locks.get(id) === operation) this.locks.delete(id); }).catch(() => {});
    return operation;
  }
  async begin({ name, bytes, sha256 }) {
    return this.exclusive('reservation', async () => {
    invariant(typeof name === 'string' && /^[^/\\\x00-\x1f]{1,180}\.(elf|plugin|prx|sprx)$/i.test(name), 'PAYLOAD_NAME', 'Choose an ELF or supported plugin.');
    invariant(Number.isSafeInteger(bytes) && bytes >= 64 && bytes <= MAX_PAYLOAD, 'PAYLOAD_SIZE', 'Payload size must be between 64 bytes and 128 MiB.');
    invariant(sha256 == null || /^[a-f0-9]{64}$/.test(sha256), 'PAYLOAD_HASH', 'Invalid expected SHA-256.');
    const existing = (await fs.readdir(this.root)).filter(name => name.endsWith('.json'));
    invariant(existing.length < 256, 'INBOX_FULL', 'The inbox already contains 256 files.');
    const capacity = await fs.statfs(this.root), free = Number(capacity.bsize) * Number(capacity.bavail);
    const reserved = (await this.list()).filter(entry => entry.status === 'uploading').reduce((sum, entry) => sum + Math.max(0, entry.bytes - entry.offset), 0);
    invariant(free >= reserved + bytes + 16 * 1024 * 1024, 'NO_SPACE', 'Insufficient free space for this payload, existing uploads and the safety reserve.');
    const id = this.id(), meta = { id, name, bytes, expectedSha256: sha256 ?? null };
    const part = await fs.open(this.file(id, '.part'), 'wx', 0o600); await part.close();
    await fs.writeFile(this.file(id, '.json'), JSON.stringify(meta), { flag: 'wx', mode: 0o600 });
    return { ...meta, offset: 0, status: 'uploading' };
    });
  }
  async meta(id) {
    const file = this.file(id, '.json'), stat = await fs.lstat(file);
    invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size < 2048, 'UPLOAD_METADATA', 'Invalid upload metadata.');
    const meta = JSON.parse(await fs.readFile(file, 'utf8'));
    invariant(meta.id === id && Number.isSafeInteger(meta.bytes) && meta.bytes >= 64 && meta.bytes <= MAX_PAYLOAD,
      'UPLOAD_METADATA', 'Invalid upload metadata.');
    return meta;
  }
  async status(id) {
    const meta = await this.meta(id);
    for (const suffix of ['.payload', '.part']) {
      try {
        const stat = await fs.lstat(this.file(id, suffix));
        invariant(stat.isFile() && !stat.isSymbolicLink(), 'UPLOAD_FILE', 'The upload is not a regular file.');
        return { ...meta, offset: stat.size, status: suffix === '.payload' ? 'verified' : 'uploading' };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    invariant(false, 'UPLOAD_MISSING', 'The upload file is missing.', { status: 404 });
  }
  async append(id, offset, data) {
    invariant(Number.isSafeInteger(offset) && offset >= 0 && data.length > 0 && data.length <= 1024 * 1024,
      'UPLOAD_RANGE', 'Invalid upload chunk.', { status: 400 });
    return this.exclusive(id, async () => {
      const status = await this.status(id);
      invariant(status.status === 'uploading' && offset === status.offset && offset + data.length <= status.bytes,
        'UPLOAD_OFFSET', 'Upload offset changed. Resume from the returned offset.');
      const file = await fs.open(this.file(id, '.part'), 'r+');
      try {
        let written = 0;
        while (written < data.length) {
          const result = await file.write(data, written, data.length - written, offset + written);
          invariant(result.bytesWritten > 0, 'SHORT_WRITE', 'Payload write made no progress.'); written += result.bytesWritten;
        }
        await file.sync();
      } finally { await file.close(); }
      return { id, offset: offset + data.length, status: 'uploading' };
    });
  }
  async verify(id) {
    return this.exclusive(id, async () => {
      const status = await this.status(id);
      invariant(status.offset === status.bytes, 'UPLOAD_INCOMPLETE', 'Finish uploading the payload first.');
      const file = await fs.open(this.file(id, status.status === 'verified' ? '.payload' : '.part'), 'r');
      const hash = createHash('sha256'), prefix = Buffer.alloc(Math.min(status.bytes, 16384));
      let info;
      try {
        const first = await file.read(prefix, 0, prefix.length, 0);
        invariant(first.bytesRead === prefix.length, 'SHORT_READ', 'Could not inspect the complete payload header.');
        info = inspectPayload(prefix, status.name, { totalBytes: status.bytes });
        const chunk = Buffer.alloc(1024 * 1024);
        for (let position = 0; position < status.bytes;) {
          const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, status.bytes - position), position);
          invariant(bytesRead > 0, 'SHORT_READ', 'Payload verification ended early.'); hash.update(chunk.subarray(0, bytesRead)); position += bytesRead;
        }
        invariant((await file.stat()).size === status.bytes, 'PAYLOAD_CHANGED', 'Payload size changed during verification.');
      } finally { await file.close(); }
      const sha256 = hash.digest('hex');
      invariant(!status.expectedSha256 || sha256 === status.expectedSha256, 'PAYLOAD_HASH_MISMATCH', 'Payload checksum differs from the expected file.');
      if (status.status !== 'verified') await fs.rename(this.file(id, '.part'), this.file(id, '.payload'));
      // Always rehash before dispatch; this inbox entry is not an execution receipt.
      return { ...info, id, sha256, status: 'verified' };
    });
  }
  async list() {
    const result = [];
    for (const name of await fs.readdir(this.root)) {
      if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
      try { result.push(await this.status(name.slice(0, 32))); }
      catch { result.push({ id: name.slice(0, 32), status: 'unreadable', name: 'Incomplete inbox entry' }); }
    }
    return result;
  }
}
