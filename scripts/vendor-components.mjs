// SPDX-License-Identifier: GPL-3.0-or-later
// Explicit local import. No downloads, service changes or console access.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, '../snipers-youtube-experimental');
// Firmware profiles have independent pinned provenance. Importing component
// binaries must never overwrite the compatibility tables.
const components = [
  { id: 'kstuff', version: '1.11', file: 'kstuff.elf', sha256: 'ab9a6cb4d3b1daf139d4d646e402b1cf569071acd64599c936d7a3a6164dc779',
    from: 'etahen-13.60/Source Code/bootstrapper/assets/kstuff.elf', source: 'https://github.com/EchoStretch/kstuff-lite/tree/85fb88a526e58e357d6f1e626ce05af4acdb8b5d' },
  { id: 'shadowmount', version: '1.7beta4', file: 'shadowmountplus.elf', sha256: 'fc4e5f715e76660ce34bde2adb10eaf1d069cb2cdf06f7a380896dfb62bd0c4a',
    from: 'relapse-host/vendor/shadowmountplus-1.7beta4.elf', source: 'https://github.com/drakmor/ShadowMountPlus/tree/1.7beta4' },
  { id: 'payload-manager', version: '0.5.2', file: 'pldmgr.elf', sha256: '62b3ba2a4937c2afc502f9a4e7242cca538610ebb4ae2800c7c6f72e7f268e7c',
    from: '../relapse-host/site/downloads/Payload-Manager-0.5.2.elf', source: 'https://github.com/itsPLK/ps5-payload-manager/tree/v0.5.2' }
];
await fs.mkdir(path.join(root, 'build/components'), { recursive: true });
for (const entry of components) {
  const data = await fs.readFile(path.join(source, entry.from));
  if (createHash('sha256').update(data).digest('hex') !== entry.sha256) throw Error('Pinned component changed: ' + entry.id);
  entry.bytes = data.length;
  await fs.writeFile(path.join(root, 'build/components', entry.file), data);
  delete entry.from;
}
await fs.writeFile(path.join(root, 'vendor/components.json'), JSON.stringify(components, null, 2) + '\n');
console.log('Imported pinned raw components. Firmware profiles were preserved. Nothing executed.');
