// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { importCheatFile } from '../src/cheat-import.mjs';
import { importCheatXml } from '../src/cheat-xml.mjs';
import { cheatPacket } from '../src/cheats.mjs';
import { CheatPacks } from '../src/cheat-packs.mjs';
import { store, memoryStorage } from './helpers.mjs';
const identity = { titleId: 'CUSA00001', version: '01.20' };
const xml = '<Trainer Game="MC4 fixture &amp; data" Process="eboot.bin" Moder="Fixture author" Cusa="CUSA00001" Version="01.20"><Cheat Text="Fixture patch"><Cheatline><Offset>10</Offset><ValueOn>90-90</ValueOn><ValueOff>01-02</ValueOff></Cheatline></Cheat></Trainer>';
function encrypt(value, padding = true) {
  const aes = createCipheriv('aes-256-cbc', Buffer.from('304c6528f659c766110239a51cl5dd9c'), Buffer.from('u@}kzW2u[u(8DWar'));
  aes.setAutoPadding(padding);return Buffer.concat([aes.update(value), aes.final()]).toString('base64');
}

test('MC4 decrypted with portable AES matches independent Node encryption and both native patch directions', async () => {
  const source = encrypt(xml), expected = importCheatXml(xml, identity);
  const pack = await importCheatFile(source, identity);assert.deepEqual(pack, expected);
  for (const enabled of [true, false]) assert.deepEqual(cheatPacket(pack, '0', enabled), cheatPacket(expected, '0', enabled));
  assert.deepEqual(await importCheatFile('\ufeff\r\n' + source.match(/.{1,76}/g).join('\r\n') + '\n', identity), expected);
});

test('MC4 accepts evidenced legacy escaped documents, toggles, encoding labels and short PS4 version spelling', async () => {
  const legacy = ('<?xml version="1.0" encoding="utf-16"?>' + xml).replace('Version="01.20"', 'Version="1.20"').replace('<Cheat Text=', '<Cheat Control="Toggel" Text=');
  const escaped = legacy.replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '\\&quot;');
  assert.deepEqual(await importCheatFile(encrypt(escaped), identity), importCheatXml(xml, identity));
  const utf16 = Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(legacy, 'utf16le')]);
  assert.deepEqual(await importCheatFile(encrypt(utf16), identity), importCheatXml(xml, identity));
  // Ordinary XML attribute entities remain data; only a whole escaped document is unwrapped.
  const withLiteral = xml.replace('MC4 fixture &amp; data', 'MC4 &lt;label&gt;');
  assert.equal((await importCheatFile(encrypt(withLiteral), identity)).name, 'MC4 <label>');
  await assert.rejects(importCheatFile(encrypt(legacy.replace('Toggel', 'Button')), identity), { code: 'CHEAT_XML' });
  await assert.rejects(importCheatFile(encrypt(legacy), { ...identity, version: '01.21' }), { code: 'CHEAT_IDENTITY' });
});

test('MC4 rejects malformed base64, blocks, padding, decoded text, expanded entities and unsupported addressing', async () => {
  const source = encrypt(xml);
  for (const invalid of ['', 'A'.repeat(25), source.slice(0, -4), source + 'junk', source.slice(0, -1) + '?', 'A'.repeat(24), 'A'.repeat(4 * 1024 * 1024 + 4)])
    await assert.rejects(importCheatFile(invalid, identity));
  const badPadding = Buffer.alloc(32, 0x41);badPadding[31] = 0;
  await assert.rejects(importCheatFile(encrypt(badPadding, false), identity), { code: 'CHEAT_MC4' });
  await assert.rejects(importCheatFile(encrypt(Buffer.from([0xff,0xfe,0x31])), identity), { code: 'CHEAT_MC4_TEXT' });
  await assert.rejects(importCheatFile(encrypt(Buffer.from([0xc0,0x80])), identity), { code: 'CHEAT_MC4_TEXT' });
  await assert.rejects(importCheatFile(encrypt('<!DOCTYPE Trainer SYSTEM "file:///secret">' + xml), identity), { code: 'CHEAT_XML' });
  await assert.rejects(importCheatFile(encrypt(xml.replace('</Cheatline>', '<Absolute>true</Absolute></Cheatline>')), identity), { code: 'CHEAT_ADDRESS_MODE' });
  await assert.rejects(importCheatFile(encrypt(xml.replace('CUSA00001', 'CUSA00002')), identity), { code: 'CHEAT_IDENTITY' });
  await assert.rejects(importCheatFile(encrypt('{}'), identity), { code: 'CHEAT_XML' });
});

test('MC4 and plain XML share canonical durable identity; rejected imports cannot create registry or files', async () => {
  const runtime = { store: await store(), sequence: 0 }, storage = memoryStorage(), packs = new CheatPacks(runtime, storage);
  const first = await packs.import({ source: encrypt(xml), ...identity });
  assert.deepEqual(await packs.import({ source: xml, ...identity }), first);
  assert.equal(packs.list().length, 1);assert.equal(storage.files.size, 1);
  assert.deepEqual((await packs.read(first.sha256)).credits, ['Fixture author']);
  const saved = new Map(storage.files), revision = runtime.store.snapshot().revision;
  await assert.rejects(packs.import({ source: encrypt(xml), ...identity, version: '01.21' }));
  await assert.rejects(packs.import({ source: 'Invalid MC4', ...identity }));
  assert.deepEqual(storage.files, saved);assert.equal(runtime.store.snapshot().revision, revision);
});
