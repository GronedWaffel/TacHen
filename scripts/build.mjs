// SPDX-License-Identifier: GPL-3.0-or-later
import { build } from 'esbuild';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = path.resolve(process.env.PS5_PAYLOAD_SDK || path.join(root, '../ps-neighbourhood/tools/ps5-sdk-0.43/ps5-payload-sdk'));
const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
await fs.mkdir(path.join(root, 'build'), { recursive: true });
const assets = {};
for (const file of ['index.html', 'deck.css', 'deck.js']) assets[file] = await fs.readFile(path.join(root, 'ui', file), 'utf8');
await fs.writeFile(path.join(root, 'build/ui-assets.json'), JSON.stringify(assets));
const alias = {
  'node:http': path.join(root, 'platform/runtime/http.mjs'), 'node:fs/promises': path.join(root, 'platform/runtime/fs.mjs'),
  'node:crypto': path.join(root, 'platform/runtime/crypto.mjs'),
  'node:net': path.join(root, 'platform/runtime/net.mjs'),
  'node:path': 'path-browserify', 'stream': 'readable-stream', 'buffer': 'buffer/', 'events': 'events/'
};
await build({ absWorkingDir: root, entryPoints: ['platform/console-entry.mjs'], bundle: true, platform: 'browser',
  format: 'iife', target: 'es2022', outfile: 'build/runtime.js', alias });
const bundle = await fs.readFile(path.join(root, 'build/runtime.js'));
await fs.writeFile(path.join(root, 'build/bundle.h'), 'static const unsigned char tachen_bundle[]={' + [...bundle, 0].join(',') + '};\n');
await fs.writeFile(path.join(root, 'build/assets.S'), '.section .rodata,"a",@progbits\n.global tachen_assets_start\n.global tachen_assets_end\ntachen_assets_start:\ntachen_assets_end:\n.section .note.GNU-stack,"",@progbits\n');
const q = 'vendor/quickjs';
const sources = ['platform/runtime/host.c', 'build/assets.S', ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c', 'cutils.c'].map(file => q + '/' + file)];
const args = ['cc', '-Os', '-Wno-unreachable-code-generic-assoc', '-D_GNU_SOURCE', '-DCONFIG_VERSION="2026-06-04"', '-I' + q, '-Ibuild',
  '-target', 'x86_64-linux-none', '-U__linux__', '-D__FreeBSD__=11', '-D__PS5__', '-DTACHEN_EMBEDDED',
  '-isystem', sdk + '/target/include', '-fPIE', '-fno-stack-protector', '-fno-plt', '-femulated-tls',
  '-nostdlib', '-pie', '-Wl,--hash-style=gnu', '-Wl,-z,max-page-size=0x4000', '-Wl,-T,' + sdk + '/ldscripts/elf_x86_64.x',
  ...sources, sdk + '/target/lib/crt1.o', sdk + '/target/lib/libc.a', '-L', sdk + '/target/lib', '-ldl', '-lkernel_web', '-lSceLibcInternal', '-lSceNetCtl', '-o', 'build/tachen-runtime.elf'];
const result = spawnSync(zig, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
if (result.status !== 0) throw Error(result.error?.message || result.stderr || 'Native build failed');
const elf = await fs.readFile(path.join(root, 'build/tachen-runtime.elf'));
if (elf.subarray(0, 4).toString('hex') !== '7f454c46' || elf[4] !== 2 || elf.readUInt16LE(18) !== 62) throw Error('Output is not an x86-64 ELF');
await fs.writeFile(path.join(root, 'build/manifest.json'), JSON.stringify({ name: 'TacHen runtime development',
  version: '0.1.0-dev', kind: 'coordinator-and-local-phone-interface', completeHen: false, hardwareVerified: false,
  sha256: createHash('sha256').update(elf).digest('hex'), bytes: elf.length,
  bundledJavaScriptBytes: bundle.length, sourceEntry: 'platform/console-entry.mjs' }, null, 2) + '\n');
console.log(`Built TacHen runtime ELF: ${elf.length} bytes. Hardware untested; native HEN feature integrations remain outstanding.`);
