import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComponentAssets } from '../src/components.mjs';
import { PayloadInbox } from '../src/inbox.mjs';
import { ids, checksum } from './helpers.mjs';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tachen-component-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = await fs.readFile(new URL('../build/components/kstuff.elf', import.meta.url));
  const entry = { id: 'kstuff', file: 'kstuff.elf', offset: 0, bytes: data.length, sha256: checksum(data) };
  const inbox = await new PayloadInbox(root, { id: ids() }).init(); let reads = 0;
  return { data, entry, inbox, reads: () => reads, assets: new ComponentAssets(inbox, [entry], (offset, size) => {
    assert.ok(size <= 1024 * 1024); reads++; return data.subarray(offset, offset + size);
  }) };
}
test('embedded component extraction streams bounded chunks, deduplicates concurrent calls and reuses verified bytes', async t => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.assets.ensure('kstuff'), f.assets.ensure('kstuff')]);
  assert.equal(first.id, second.id); assert.equal(first.sha256, f.entry.sha256); assert.equal((await f.inbox.list()).length, 1);
  const count = f.reads(); assert.equal((await f.assets.ensure('kstuff')).id, first.id); assert.equal(f.reads(), count);
});
test('component extraction resumes a partial image, then detects corruption even with matching metadata', async t => {
  const f = await fixture(t), partial = await f.inbox.begin({ name: f.entry.file, bytes: f.entry.bytes, sha256: f.entry.sha256 });
  await f.inbox.append(partial.id, 0, f.data.subarray(0, 512));
  assert.equal((await f.assets.ensure('kstuff')).id, partial.id);
  const file = await fs.open(f.inbox.file(partial.id, '.payload'), 'r+');
  await file.write(Buffer.from([0xff]), 0, 1, f.data.length - 1); await file.close();
  await assert.rejects(f.assets.ensure('kstuff'), { code: 'PAYLOAD_HASH_MISMATCH' });
});
