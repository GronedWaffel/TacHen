// SPDX-License-Identifier: GPL-3.0-or-later
// Fetch only pinned release files. Downloaded files are never executed here.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const urls = {
  kstuff: 'https://github.com/EchoStretch/kstuff-lite/releases/download/v1.11/kstuff.elf',
  shadowmount: 'https://github.com/drakmor/ShadowMountPlus/releases/download/1.7beta4/shadowmountplus.elf',
  'payload-manager': 'https://github.com/itsPLK/ps5-payload-manager/releases/download/v0.5.2/pldmgr_v0.5.2.elf'
};
const components = JSON.parse(await fs.readFile(path.join(root, 'vendor/components.json')));
await fs.mkdir(path.join(root, 'build/components'), { recursive: true });
for (const component of components) {
  const target = path.join(root, 'build/components', component.file);
  let data;
  try { data = await fs.readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!data) {
    const response = await fetch(urls[component.id], { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error('Component download failed: ' + component.id);
    const chunks = []; let count = 0;
    for await (const chunk of response.body) {
      count += chunk.length; if (count > component.bytes) throw Error('Component download exceeded pinned size'); chunks.push(chunk);
    }
    data = Buffer.concat(chunks);
  }
  if (data.length !== component.bytes || createHash('sha256').update(data).digest('hex') !== component.sha256)
    throw Error('Component differs from pinned release; review manually: ' + component.id);
  await fs.writeFile(target + '.part', data); await fs.rename(target + '.part', target);
  console.log(component.id + ' ' + component.version + ': checksum verified');
}
