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
await import('./build-game-gate.mjs');
const assets = {};
for (const file of ['index.html', 'deck.css', 'deck.js']) assets[file] = await fs.readFile(path.join(root, 'ui', file), 'utf8');
await fs.writeFile(path.join(root, 'build/ui-assets.json'), JSON.stringify(assets));
const components = JSON.parse(await fs.readFile(path.join(root, 'vendor/components.json')));
const parts = []; let assetOffset = 0;
for (const component of components) {
  const data = await fs.readFile(path.join(root, 'build/components', component.file));
  if (data.length !== component.bytes || createHash('sha256').update(data).digest('hex') !== component.sha256)
    throw Error('Bundled component checksum mismatch: ' + component.id);
  component.offset = assetOffset; assetOffset += data.length; parts.push(data);
}
await fs.writeFile(path.join(root, 'build/components.bin'), Buffer.concat(parts));
await fs.writeFile(path.join(root, 'build/components.json'), JSON.stringify(components));
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
await fs.writeFile(path.join(root, 'build/assets.S'), '.section .rodata,"a",@progbits\n.global tachen_assets_start\n.global tachen_assets_end\ntachen_assets_start:\n.incbin "build/components.bin"\ntachen_assets_end:\n.global tachen_deck_start\n.global tachen_deck_end\ntachen_deck_start:\n.incbin "build/tachen-deck.elf"\ntachen_deck_end:\n.section .note.GNU-stack,"",@progbits\n');
const q = 'vendor/quickjs';
const sources = ['platform/runtime/host.c', 'build/assets.S', 'platform/deck/publication.c',
    ...['elf-image.c', 'elf-map.c', 'loader-worker.c', 'loader-bindings.c', 'system-probe.c', 'manager-config.c', 'native-operation.c', 'deck-inject.c', 'deck-worker.c', 'trace-wait.c',
      'package-core.c', 'package-io.c', 'package-worker.c', 'game-info.c', 'game-source.c', 'game-metadata.c', 'plugin-image.c', 'dispatch-receipt.c', 'game-inject.c', 'process-current.c',
      'prx-image.c', 'module-session.c', 'module-worker.c', 'process-fresh.c', 'memory-map.c', 'cheat-transaction.c', 'cheat-worker.c'].map(file => 'platform/native/' + file),
  'platform/game/game-trampoline.cpp', 'vendor/deck/relocate.cpp', 'vendor/deck/hde64.cpp',
  ...['elfldr.c', 'pt.c', 'sha256.c', 'syscall-shim.S'].map(file => 'platform/loader/' + file),
  ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c', 'cutils.c'].map(file => q + '/' + file)];
const compile = ['cc', '-Os', '-Wno-unreachable-code-generic-assoc', '-D_GNU_SOURCE', '-DCONFIG_VERSION="2026-06-04"', '-I' + q, '-Ibuild',
  '-target', 'x86_64-linux-none', '-U__linux__', '-D__FreeBSD__=11', '-D__PS5__', '-DTACHEN_EMBEDDED',
  '-DETAHEN_PORT_1360', '-Iplatform/deck', '-Iplatform/game', '-Ivendor/deck', '-Iplatform/native', '-Iplatform/loader',
  '-isystem', sdk + '/target/include', '-fPIE', '-fno-stack-protector', '-fno-plt', '-femulated-tls',
  '-nostdlib'];
function run(args) {
  const result = spawnSync(zig, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  if (result.status !== 0) throw Error(result.error?.message || result.stderr || 'Native build failed');
}
const objects = [];
const packageObjects = [];
for (const source of ['platform/native/package-helper.c', 'platform/native/package-core.c', 'platform/native/package-io.c', 'platform/loader/sha256.c', 'platform/native/process-fresh.c']) {
  const object = 'build/pkg_' + source.replaceAll('/', '_') + '.o';
  run([...compile, '-std=c11', '-c', source, '-o', object]); packageObjects.push(object);
}
run(['ld.lld', '--no-dependent-libraries', '--wrap=kernel_get_proc', '-pie', '--hash-style=gnu', '-z', 'max-page-size=0x4000', '-T', sdk + '/ldscripts/elf_x86_64.x',
  ...packageObjects, sdk + '/target/lib/crt1.o', '-L', sdk + '/target/lib', '--start-group', sdk + '/target/lib/libc.a',
  '-ldl', '--end-group', '-lkernel_web', '-lSceLibcInternal', '-o', 'build/tachen-package-helper.elf']);
await fs.appendFile(path.join(root, 'build/assets.S'), '.section .rodata,"a",@progbits\n.global tachen_package_start\n.global tachen_package_end\ntachen_package_start:\n.incbin "build/tachen-package-helper.elf"\ntachen_package_end:\n');
const deckObjects = [];
for (const source of ['platform/deck/deck-core.c', 'platform/deck/deck-http.c', 'platform/deck/mono-api.c',
  'platform/deck/deck-view.c', 'platform/deck/deck-module.c', 'platform/deck/trampoline.cpp', 'vendor/deck/relocate.cpp', 'vendor/deck/hde64.cpp', 'platform/native/process-fresh.c']) {
  const object = 'build/' + source.replaceAll('/', '_') + '.o';
  run([...compile, '-Iplatform/deck', '-Ivendor/deck', '-DHDE_DECODE_ONLY',
    ...(source.endsWith('.cpp') ? ['-std=c++17', '-fno-exceptions', '-fno-rtti'] : ['-std=c11']), '-c', source, '-o', object]);
  deckObjects.push(object);
}
run(['ld.lld', '--no-dependent-libraries', '--wrap=kernel_get_proc', '-pie', '--hash-style=gnu', '-z', 'max-page-size=0x4000', '-T', sdk + '/ldscripts/elf_x86_64.x',
  ...deckObjects, sdk + '/target/lib/crt1.o', '-L', sdk + '/target/lib', '--start-group', sdk + '/target/lib/libc.a',
  '-ldl', '--end-group', '-lkernel_sys', '-lSceLibcInternal', '-o', 'build/tachen-deck.elf']);
for (const source of sources) {
  const object = 'build/' + source.replaceAll('/', '_') + '.o';
  run([...compile, ...(source.endsWith('.cpp') ? ['-std=c++17', '-fno-exceptions', '-fno-rtti', '-DHDE_DECODE_ONLY'] : []), '-c', source, '-o', object]); objects.push(object);
}
run(['ld.lld', '--no-dependent-libraries', '--wrap=syscall', '--wrap=__syscall', '--wrap=ptrace', '--wrap=kernel_get_proc',
  '-pie', '--hash-style=gnu', '-z', 'max-page-size=0x4000', '-T', sdk + '/ldscripts/elf_x86_64.x',
  ...objects, sdk + '/target/lib/crt1.o', '-L', sdk + '/target/lib', '--start-group', sdk + '/target/lib/libc.a',
  '-ldl', '--end-group', '-lkernel_web', '-lSceLibcInternal', '-lSceNetCtl', '-o', 'build/tachen-runtime.elf']);
const elf = await fs.readFile(path.join(root, 'build/tachen-runtime.elf'));
const deckElf = await fs.readFile(path.join(root, 'build/tachen-deck.elf'));
const packageElf = await fs.readFile(path.join(root, 'build/tachen-package-helper.elf'));
const gameCallback = JSON.parse(await fs.readFile(path.join(root, 'build/game/manifest.json'), 'utf8'));
if (elf.subarray(0, 4).toString('hex') !== '7f454c46' || elf[4] !== 2 || elf.readUInt16LE(18) !== 62) throw Error('Output is not an x86-64 ELF');
await fs.writeFile(path.join(root, 'build/manifest.json'), JSON.stringify({ name: 'TacHen runtime development',
  version: '0.1.0-dev', kind: 'coordinator-and-local-phone-interface', completeHen: false, hardwareVerified: false,
  sha256: createHash('sha256').update(elf).digest('hex'), bytes: elf.length,
  bundledJavaScriptBytes: bundle.length, sourceEntry: 'platform/console-entry.mjs',
  gameCallback: { ...gameCallback, nativeInjectorCompiled: true, coordinatorWired: true, injectionIntegrated: true },
  nativeDeck: { file: 'tachen-deck.elf', bytes: deckElf.length, sha256: createHash('sha256').update(deckElf).digest('hex'),
    hardwareVerified: false, injectionIntegrated: true, inGameInputIntegrated: false },
  packageInstaller: { file: 'tachen-package-helper.elf', bytes: packageElf.length, sha256: createHash('sha256').update(packageElf).digest('hex'),
    firmware: ['13.60'], hardwareVerified: false, isolatedProcess: true },
  components: components.map(({ id, version, sha256, bytes, source }) => ({ id, version, sha256, bytes, source })) }, null, 2) + '\n');
console.log(`Built TacHen runtime ELF: ${elf.length} bytes. Hardware untested; native HEN feature integrations remain outstanding.`);
