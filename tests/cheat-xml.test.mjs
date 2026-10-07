// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { importCheatXml, importCheatSource } from '../src/cheat-xml.mjs';
import { importCheatJson, cheatPacket } from '../src/cheats.mjs';
const identity = { titleId: 'CUSA00001', version: '01.00' };
const patch = '<Cheatline><Offset>10</Offset><Section>0</Section><ValueOn>90-90</ValueOn><ValueOff>01-02</ValueOff></Cheatline>';
const source = (line = patch, attrs = '') => `<Trainer Game="Test &amp; data" Process="eboot.bin" Moder="Fixture author" Cusa="CUSA00001" Version="01.00" ${attrs}><Items/><Genres Name="Action"/><Cheat Text="Test patch" Description="Offline fixture">${line}</Cheat></Trainer>`;
const json = () => JSON.stringify({ id: identity.titleId, version: identity.version, name: 'Test & data', process: 'eboot.bin', credits: ['Fixture author'],
  mods: [{ name: 'Test patch', description: 'Offline fixture', memory: [{ offset: '10', section: 0, on: '9090', off: '0102' }] }] });

test('SHN normalization preserves identity, credits and exact bidirectional native patch packets', () => {
  const shn = importCheatSource('\ufeff<?xml version="1.0" encoding="utf-8"?>\r\n' + source(), identity);
  const pack = importCheatJson(json(), identity);assert.deepEqual(shn, pack);
  for (const enabled of [true, false]) assert.deepEqual(cheatPacket(shn, '0', enabled), cheatPacket(pack, '0', enabled));
  assert.deepEqual(importCheatSource(json(), identity), pack);
});

test('SHN supports comments, CDATA, numeric entities and complete legacy block padding only', () => {
  const decorated = source().replace('Test &amp; data', 'Test &#38; data').replace('<Offset>10</Offset>', '<Offset><![CDATA[10]]></Offset><!--comment-->');
  assert.deepEqual(importCheatXml(decorated, identity), importCheatJson(json(), identity));
  const plain = source(), padding = 16 - Buffer.byteLength(plain) % 16;
  assert.deepEqual(importCheatXml(plain + String.fromCharCode(padding).repeat(padding), identity), importCheatJson(json(), identity));
  assert.throws(() => importCheatXml(plain + '\0', identity), { code: 'CHEAT_XML' });
  assert.throws(() => importCheatXml(plain + '\x04\x04\x03\x04', identity), { code: 'CHEAT_XML' });
});

test('XML cannot override exact title/version or silently enable unsupported addressing', () => {
  assert.throws(() => importCheatXml(source(), { ...identity, version: '01.01' }), { code: 'CHEAT_IDENTITY' });
  assert.throws(() => importCheatXml(source(), { ...identity, titleId: 'CUSA00002' }), { code: 'CHEAT_IDENTITY' });
  for (const value of ['true', 'false', '1', '0']) assert.throws(() => importCheatXml(source(patch.replace('</Cheatline>', `<Absolute>${value}</Absolute></Cheatline>`)), identity), { code: 'CHEAT_ADDRESS_MODE' });
  const section = importCheatXml(source(patch.replace('<Section>0', '<Section>1')), identity);
  assert.throws(() => cheatPacket(section, '0', true), { code: 'CHEAT_SECTION_UNSUPPORTED' });
});

test('XML refuses entity expansion, external declarations and malformed or ambiguous structure', () => {
  const invalid = [
    '<!DOCTYPE Trainer SYSTEM "file:///private">' + source(),
    source().replace('&amp;', '&unknown;'), source().replace('&amp;', '&#0;'), source().replace('&amp;', '&#xD800;'),
    source().replace('&amp;', '&#x110000;'), source().replace('&amp;', '&amp'),
    source().replace('Game="', 'Game="duplicate" Game="'), source().replace(' Process=', 'Process='),
    source().replace('</Trainer>', '</Other>'), source() + source(), source() + 'trailing',
    source().replace('<Items/>', '<Items><Unknown/></Items>'), source(patch.replace('<Section>0</Section>', '<Section>0</Section><Section>1</Section>')),
    source(patch.replace('<ValueOn>90-90', '<ValueOn>9-090')), source(patch.replace('<Offset>10', '<Offset><Value>10</Value>')),
    source(patch.replace('<Offset>10', '<Offset><![CDATA[10')), source().replace('<Items/>', '<!--bad--comment-->'),
    source().replace('<Items/>', '<?execute native?>'), source(patch, 'Unknown="ignored?"'),
    source(patch, 'xmlns="urn:other"'), source().replace('Test &amp; data', 'bad<value'),
    source().replace('<Offset>10</Offset>', '<Offset>]]></Offset>'), source().slice(0, -5),
    source().replace('<Items/>', '<Items><a><b><c><d><e><f><g><h/></g></f></e></d></c></b></a></Items>')
  ];
  for (const input of invalid) assert.throws(() => importCheatXml(input, identity), undefined, input.slice(0, 120));
});

test('imports bound decoded fields, node count and source byte size before registration', () => {
  assert.throws(() => importCheatXml(source().replace('Test &amp; data', 'a'.repeat(16385)), identity), { code: 'CHEAT_XML' });
  assert.throws(() => importCheatXml(source().replace('<Items/>', '<Items/>'.repeat(32769)), identity), { code: 'CHEAT_XML' });
  assert.throws(() => importCheatSource('😀'.repeat(1024 * 1024 + 1), identity), { code: 'CHEAT_SIZE' });
  assert.throws(() => importCheatSource('encrypted content', identity), { code: 'CHEAT_FORMAT' });
});
