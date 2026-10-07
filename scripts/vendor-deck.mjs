// SPDX-License-Identifier: GPL-3.0-or-later
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(root, '../snipers-youtube-experimental/etahen-13.60/Source Code/shellui');
const output = path.join(root, 'vendor/deck'); await fs.mkdir(output, { recursive: true });
const provenance = [];
for (const name of ['src/relocate.cpp', 'include/relocate.h', 'src/hde64.cpp', 'include/hde64.h', 'include/table64.h']) {
  const original = await fs.readFile(path.join(source, name));
  let content = original.toString().replaceAll('../include/hde64.h', 'hde64.h').replaceAll('../include/table64.h', 'table64.h');
  // The decoder is compiled with HDE_DECODE_ONLY; no etaHEN UI is imported.
  await fs.writeFile(path.join(output, path.basename(name)), content);
  provenance.push({ file: name, sha256: createHash('sha256').update(original).digest('hex'),
    source: 'GronedWaffel etaHEN local supported-firmware tree; original HDE64 by Vyacheslav Patkov',
    adaptation: 'Flatten local include paths; decode-only build' });
}
await fs.writeFile(path.join(root, 'vendor/deck-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log('Imported instruction relocation and HDE64 only; no existing project modified.');
