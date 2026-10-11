// SPDX-License-Identifier: GPL-3.0-or-later
import { build } from 'esbuild';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {verifyLoadPages} from './elf-load-pages.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sourceFingerprint } from './source-fingerprint.mjs';
import { FIRMWARES } from '../src/firmware.mjs';
import { makeUpdatePackage } from '../src/update-format.mjs';
import { embeddingAssembly, verifyEmbeddedAsset } from './embedded-assets.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = path.resolve(process.env.PS5_PAYLOAD_SDK || path.join(root, '../ps-neighbourhood/tools/ps5-sdk-0.43/ps5-payload-sdk'));
const zig = process.env.ZIG || path.join(root, '../ps-neighbourhood/tools/zig-x86_64-windows-0.14.1/zig.exe');
await fs.mkdir(path.join(root, 'build'), { recursive: true });
await import('./check-firmware-profiles.mjs');
await import('./build-download-ca.mjs');
await import('./prepare-download.mjs');
await import('./prepare-catalog.mjs');
await import('./build-game-gate.mjs');
await import('./build-pad-bridge.mjs');
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
const buildIdentity = { source: await sourceFingerprint(root), components: components.map(({ id, version, sha256 }) => ({ id, version, sha256 })) };
await fs.writeFile(path.join(root,'build/update-source.h'), '#define TACHEN_SOURCE_HASH "' + buildIdentity.source + '"\n');
await build({ absWorkingDir: root, entryPoints: ['platform/console-entry.mjs'], bundle: true, platform: 'browser',
  format: 'iife', target: 'es2022', outfile: 'build/runtime.js', alias, define: { TACHEN_BUILD: JSON.stringify(buildIdentity) } });
const bundle = await fs.readFile(path.join(root, 'build/runtime.js'));
await fs.writeFile(path.join(root, 'build/bundle.h'), 'static const unsigned char tachen_bundle[]={' + [...bundle, 0].join(',') + '};\n');
const q = 'vendor/quickjs';
const sources = ['platform/runtime/host.c', 'platform/runtime/hash-bindings.c', 'build/assets.S', 'platform/deck/publication.c',
    'platform/native/app-launch-worker.c', 'platform/native/app-launch-io.c', 'platform/native/catalog.c', 'platform/native/download-core.c', 'platform/native/download-worker.c',
    'platform/native/update-core.c','platform/native/update-io.c','platform/native/update-bindings.c',
    ...['elf-image.c', 'elf-map.c', 'loader-worker.c', 'loader-bindings.c', 'system-probe.c', 'manager-config.c', 'native-operation.c', 'deck-inject.c', 'deck-launch.c', 'deck-worker.c', 'trace-wait.c',
      'package-core.c', 'package-io.c', 'package-worker.c', 'save-core.c', 'save-io.c', 'save-worker.c', 'save-recovery.c', 'save-recovery-io.c', 'game-info.c', 'game-source.c', 'game-metadata.c', 'plugin-image.c', 'dispatch-receipt.c', 'game-inject.c', 'game-imports.c', 'process-current.c', 'process-info.c',
      'prx-image.c', 'module-session.c', 'module-storage.c', 'module-worker.c', 'process-fresh.c', 'memory-map.c', 'cheat-transaction.c', 'cheat-worker.c', 'memory-inspect.c', 'fps-counters.c', 'telemetry-worker.c', 'user-read.c'].map(file => 'platform/native/' + file),
  'platform/native/fps-inject.c', 'platform/native/bc-fps-worker.c', 'platform/game/fps-trampoline.cpp',
  'platform/native/pad-worker.c', 'platform/native/pad-exchange.c', 'platform/native/user-write.c',
  'platform/game/game-trampoline.cpp', 'platform/game/pad-trampoline.cpp', 'vendor/deck/relocate.cpp', 'vendor/deck/hde64.cpp',
  ...['elfldr.c', 'pt.c', 'sha256.c', 'syscall-shim.S'].map(file => 'platform/loader/' + file),
  ...['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c', 'cutils.c'].map(file => q + '/' + file)];
const compile = ['cc', '-Os', '-Wno-unreachable-code-generic-assoc', '-D_GNU_SOURCE', '-DCONFIG_VERSION="2026-06-04"', '-I' + q, '-Ibuild', '-Ivendor/download',
  '-target', 'x86_64-linux-none', '-U__linux__', '-D__FreeBSD__=11', '-D__PS5__', '-DTACHEN_EMBEDDED',
  '-DETAHEN_PORT_1360', '-Iplatform/deck', '-Iplatform/game', '-Ivendor/deck', '-Iplatform/native', '-Iplatform/loader',
  '-isystem', sdk + '/target/include', '-fPIE', '-fno-stack-protector', '-fno-plt', '-femulated-tls',
  '-nostdlib'];
function run(args) {
  if(args[0]==='ld.lld'&&!args.includes('--eh-frame-hdr'))args=[args[0],'--eh-frame-hdr',...args.slice(1)];
  const result = spawnSync(zig, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(root, 'build/zig-cache') } });
  if (result.status !== 0) throw Error(result.error?.message || result.stderr || 'Native build failed');
  if(args[0]==='ld.lld'&&args.includes('-o'))verifyLoadPages(readFileSync(path.resolve(root,args[args.indexOf('-o')+1])));
}
const objects = [];
// The SDK's fallback *at functions expose raw kernel errors. Link the POSIX
// adapters in both the coordinator and isolated helpers that use these calls.
run([...compile, '-c', 'platform/loader/posix-at.S', '-o', 'build/posix-at.o']);
const posixAt = ['build/posix-at.o', ...['mkdirat', 'openat', 'renameat', 'unlinkat', 'fstatat'].map(name => '--wrap=' + name)];
const packageObjects = [];
for (const source of ['platform/native/package-helper.c', 'platform/native/package-core.c', 'platform/native/package-io.c', 'platform/native/package-http.c', 'platform/native/package-source.c', 'platform/loader/sha256.c', 'platform/native/process-fresh.c']) {
  const object = 'build/pkg_' + source.replaceAll('/', '_') + '.o';
  run([...compile, '-std=c11', '-c', source, '-o', object]); packageObjects.push(object);
}
run(['ld.lld', '--no-dependent-libraries', '--wrap=kernel_get_proc', '-pie', '--hash-style=gnu', '-z', 'max-page-size=0x4000', '-T', sdk + '/ldscripts/elf_x86_64.x',
  ...packageObjects, ...posixAt, sdk + '/target/lib/crt1.o', '-L', sdk + '/target/lib', '--start-group', sdk + '/target/lib/libc.a',
  '-ldl', '--end-group', '-lkernel_web', '-lSceLibcInternal', '--no-as-needed',
  '-lSceSystemService', '-lSceUserService', '-lSceIpmi', '-lSceAppInstUtil', '-o', 'build/tachen-package-helper.elf']);
const saveObjects = [];
for (const source of ['platform/native/save-helper.c', 'platform/native/save-core.c', 'platform/native/save-flow.c', 'platform/native/save-io.c', 'platform/loader/sha256.c', 'platform/native/process-fresh.c']) {
  const object = 'build/save_' + source.replaceAll('/', '_') + '.o';
  run([...compile, '-Wall', '-Wextra', '-Werror', '-std=c11', '-c', source, '-o', object]); saveObjects.push(object);
}
run(['ld.lld', '--no-dependent-libraries', '--wrap=kernel_get_proc', '-pie', '--hash-style=gnu', '-z', 'max-page-size=0x4000', '-T', sdk + '/ldscripts/elf_x86_64.x',
  ...saveObjects, ...posixAt, sdk + '/target/lib/crt1.o', '-L', sdk + '/target/lib', '--start-group', sdk + '/target/lib/libc.a',
  '-ldl', '--end-group', '-lkernel_web', '-lSceLibcInternal', '-o', 'build/tachen-save-helper.elf']);
const launchObjects=[];
for(const source of ['platform/native/app-launch-helper.c','platform/native/app-launch-io.c','platform/loader/sha256.c','platform/native/process-fresh.c']){
 const object='build/launch_'+source.replaceAll('/','_')+'.o';run([...compile,'-std=c11','-c',source,'-o',object]);launchObjects.push(object);
}
run(['ld.lld','--no-dependent-libraries','--wrap=kernel_get_proc','-pie','--hash-style=gnu','-z','max-page-size=0x4000','-T',sdk+'/ldscripts/elf_x86_64.x',...launchObjects,...posixAt,sdk+'/target/lib/crt1.o','-L',sdk+'/target/lib','--start-group',sdk+'/target/lib/libc.a','-ldl','--end-group','-lkernel_web','-lSceLibcInternal','-o','build/tachen-launch-helper.elf']);
const deckObjects = [];
const bootstrapTrace=process.env.TACHEN_BOOTSTRAP_TRACE==='1'?['-DTACHEN_BOOTSTRAP_TRACE','-DTACHEN_BOOTSTRAP_SCAN']:[];
for (const source of ['platform/deck/deck-core.c', 'platform/deck/deck-route.c', 'platform/deck/deck-http.c', 'platform/deck/mono-api.c',
  'platform/deck/deck-view.c', 'platform/deck/dashboard.c', 'platform/deck/cheats-window.c', 'platform/deck/deck-layout.c', 'platform/deck/deck-module.c', 'platform/deck/resident-init.c', 'platform/deck/resident-memory.c', 'platform/deck/trampoline.cpp', 'vendor/deck/relocate.cpp', 'vendor/deck/hde64.cpp', 'platform/native/process-fresh.c']) {
  const object = 'build/' + source.replaceAll('/', '_') + '.o';
  run([...compile, ...bootstrapTrace, '-Iplatform/deck', '-Ivendor/deck', '-DHDE_DECODE_ONLY',
    ...(source.endsWith('.cpp') ? ['-std=c++17', '-fno-exceptions', '-fno-rtti'] : ['-std=c11']), '-c', source, '-o', object]);
  deckObjects.push(object);
}
run(['ld.lld', '--no-dependent-libraries', '--wrap=kernel_get_proc', '-pie', '--hash-style=gnu', '-z', 'max-page-size=0x4000', '-T', sdk + '/ldscripts/elf_x86_64.x',
  '--wrap=__patch_init', '--wrap=__crt_syscall_init', '--wrap=__kernel_init', '--wrap=__rtld_init', '--wrap=kernel_copyout', ...deckObjects, sdk + '/target/lib/crt1.o', '-L', sdk + '/target/lib', '--start-group', sdk + '/target/lib/libc.a',
  '-ldl', '--end-group', '-lkernel_sys', '-lSceLibcInternal', '-o', 'build/tachen-deck.elf']);
const embeddedAssets = [];
for (const [symbol, file] of [['assets', 'components.bin'], ['deck', 'tachen-deck.elf'],
  ['launch','tachen-launch-helper.elf'], ['package', 'tachen-package-helper.elf'], ['save', 'tachen-save-helper.elf']]) {
  embeddedAssets.push({ symbol: 'tachen_' + symbol, path: 'build/' + file,
    bytes: await fs.readFile(path.join(root, 'build', file)) });
}
await fs.writeFile(path.join(root, 'build/assets.S'), embeddingAssembly(embeddedAssets));
for (const source of sources) {
  const object = 'build/' + source.replaceAll('/', '_') + '.o';
  run([...compile, ...bootstrapTrace, ...(source.startsWith('platform/native/save-') || source.startsWith('platform/native/update-') ? ['-Wall', '-Wextra', '-Werror', '-isystem', q] : []), ...(source.endsWith('.cpp') ? ['-std=c++17', '-fno-exceptions', '-fno-rtti', '-DHDE_DECODE_ONLY'] : []), '-Ibuild/catalog', '-c', source, '-o', object]); objects.push(object);
}
run(['ld.lld', '--no-dependent-libraries', '--wrap=syscall', '--wrap=__syscall', '--wrap=ptrace', '--wrap=kernel_get_proc',
  '-pie', '--hash-style=gnu', '-z', 'max-page-size=0x4000', '-T', sdk + '/ldscripts/elf_x86_64.x',
  ...objects, 'build/catalog/libsqlite3.a', ...posixAt, sdk + '/target/lib/crt1.o', '-L', sdk + '/target/lib', '--start-group', sdk + '/target/lib/libc.a',
  '-Lbuild/download', '-lcurl', '-lwolfssl', '-lpsl', '-lzstd', '-lz', '-ldl', '--end-group', '-lkernel_web', '-lSceLibcInternal', '-lSceNet', '-lSceNetCtl', '-o', 'build/tachen-runtime.elf']);
const elf = await fs.readFile(path.join(root, 'build/tachen-runtime.elf'));
const embeddedAssetChecks = embeddedAssets.map(asset => verifyEmbeddedAsset(elf, asset.symbol, asset.bytes));
const updatePackage=makeUpdatePackage(elf,{source:buildIdentity.source,label:'TacHen compatibility ' + buildIdentity.source.slice(0,12)});
await fs.writeFile(path.join(root,'build/tachen-update.tachen'),updatePackage);
await fs.writeFile(path.join(root, 'build/fallback.S'), embeddingAssembly([{ symbol: 'tachen_fallback', path: 'build/tachen-update.tachen', bytes: updatePackage }]));
const launcherObjects=[];
for(const source of ['platform/native/update-launcher.c','platform/native/update-core.c','platform/native/update-io.c','platform/native/elf-image.c','platform/native/elf-map.c','platform/native/process-fresh.c',
  'platform/native/trace-wait.c','platform/loader/elfldr.c','platform/loader/pt.c','platform/loader/sha256.c','platform/loader/syscall-shim.S','build/fallback.S']) {
  const object='build/launcher_'+source.replaceAll('/','_')+'.o';run([...compile,...(source.includes('/update-')?['-Wall','-Wextra','-Werror']:[]),'-c',source,'-o',object]);launcherObjects.push(object);
}
run(['ld.lld','--no-dependent-libraries','--wrap=syscall','--wrap=__syscall','--wrap=ptrace','--wrap=kernel_get_proc','-pie','--hash-style=gnu','-z','max-page-size=0x4000','-T',sdk+'/ldscripts/elf_x86_64.x',
  ...launcherObjects,sdk+'/target/lib/crt1.o','-L',sdk+'/target/lib','--start-group',sdk+'/target/lib/libc.a','-ldl','--end-group','-lkernel_web','-lSceLibcInternal','-o','build/tachen.elf']);
const launcher=await fs.readFile(path.join(root,'build/tachen.elf'));
const fallbackCheck = verifyEmbeddedAsset(launcher, 'tachen_fallback', updatePackage);
// The standard launcher intentionally follows saved update selection. Testers
// need an explicit artifact that selects the runtime shipped inside this ELF.
const bundledLauncherObject='build/bundled-update-launcher.o';
run([...compile,'-Wall','-Wextra','-Werror','-DTACHEN_BUNDLED_RUNTIME','-c','platform/native/update-launcher.c','-o',bundledLauncherObject]);
const bundledObjects=launcherObjects.map(object=>object==='build/launcher_platform_native_update-launcher.c.o'?bundledLauncherObject:object);
run(['ld.lld','--no-dependent-libraries','--wrap=syscall','--wrap=__syscall','--wrap=ptrace','--wrap=kernel_get_proc','-pie','--hash-style=gnu','-z','max-page-size=0x4000','-T',sdk+'/ldscripts/elf_x86_64.x',
  ...bundledObjects,sdk+'/target/lib/crt1.o','-L',sdk+'/target/lib','--start-group',sdk+'/target/lib/libc.a','-ldl','--end-group','-lkernel_web','-lSceLibcInternal','-o','build/tachen-bundled.elf']);
const bundledLauncher=await fs.readFile(path.join(root,'build/tachen-bundled.elf'));
const bundledFallbackCheck=verifyEmbeddedAsset(bundledLauncher,'tachen_fallback',updatePackage);
const deckElf = await fs.readFile(path.join(root, 'build/tachen-deck.elf'));
const packageElf = await fs.readFile(path.join(root, 'build/tachen-package-helper.elf'));
const saveElf = await fs.readFile(path.join(root, 'build/tachen-save-helper.elf'));
const gameCallback = JSON.parse(await fs.readFile(path.join(root, 'build/game/manifest.json'), 'utf8'));
const padBridge = JSON.parse(await fs.readFile(path.join(root, 'build/pad/manifest.json'), 'utf8'));
if (elf.subarray(0, 4).toString('hex') !== '7f454c46' || elf[4] !== 2 || elf.readUInt16LE(18) !== 62) throw Error('Output is not an x86-64 ELF');
await fs.writeFile(path.join(root, 'build/manifest.json'), JSON.stringify({ name: 'TacHen',
  version: JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version, kind: 'coordinator-and-local-phone-interface', completeHen: false, hardwareVerified: false,
  buildIdentity,
  embeddedAssets: { runtime: embeddedAssetChecks, launcher: fallbackCheck, bundledLauncher: bundledFallbackCheck },
  updatePackage:{file:'tachen-update.tachen',bytes:updatePackage.length,sha256:createHash('sha256').update(updatePackage).digest('hex'),format:updatePackage.readUInt32LE(8),stateSchema:1,signed:false},
  launcher:{file:'tachen.elf',bytes:launcher.length,sha256:createHash('sha256').update(launcher).digest('hex'),hardwareVerified:false},
  bundledLauncher:{file:'tachen-bundled.elf',bytes:bundledLauncher.length,sha256:createHash('sha256').update(bundledLauncher).digest('hex'),selection:'embedded-runtime-trial',hardwareVerified:false},
  sha256: createHash('sha256').update(elf).digest('hex'), bytes: elf.length,
  bundledJavaScriptBytes: bundle.length, sourceEntry: 'platform/console-entry.mjs',
  gameCallback: { ...gameCallback, nativeInjectorCompiled: true, coordinatorWired: true, injectionIntegrated: true },
  padBridge: { ...padBridge, nativeInjectorCompiled: true, independentPreparationWired: true,
    exchangeWorkerCompiled: true, coordinatorWired: true, captureMode: 'fresh-renderer-and-controller-lease' },
  nativeDeck: { file: 'tachen-deck.elf', bytes: deckElf.length, sha256: createHash('sha256').update(deckElf).digest('hex'),
    hardwareVerified: false, injectionIntegrated: true, inGameInputIntegrated: true },
  packageInstaller: { file: 'tachen-package-helper.elf', bytes: packageElf.length, sha256: createHash('sha256').update(packageElf).digest('hex'),
    firmware: [...FIRMWARES], hardwareVerified: false, isolatedProcess: true, progressAbi: 'historical-common-prefix', errorDetailsFirmware: ['13.60'],
    source: { transport: 'loopback-http', clients: 4, rangeRequests: true, verifiedDescriptor: true } },
  saveExporter: { file: 'tachen-save-helper.elf', bytes: saveElf.length, sha256: createHash('sha256').update(saveElf).digest('hex'),
    hardwareVerified: false, isolatedProcess: true, coordinatorWired: true },
  components: components.map(({ id, version, sha256, bytes, source }) => ({ id, version, sha256, bytes, source })) }, null, 2) + '\n');
console.log(`Built TacHen runtime ELF: ${elf.length} bytes. Build complete; automated compilation does not establish hardware validation.`);
// Opt-in local delivery preference, outside the source tree and CI config.
// Always deliver the embedded-runtime launcher so an older saved update cannot
// silently replace the build the tester intended to run.
let localOutput;
try { localOutput = JSON.parse(await fs.readFile(path.join(root, '.local/build-output.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (localOutput?.desktopDirectory) {
  const directory = path.resolve(localOutput.desktopDirectory);
  if (!(await fs.stat(directory)).isDirectory()) throw Error('Configured desktop output is not a directory');
  const destination = path.join(directory, 'TacHen-compatibility.elf');
  await fs.writeFile(destination + '.tmp', bundledLauncher);
  await fs.rename(destination + '.tmp', destination);
  await fs.writeFile(path.join(directory, 'TacHen-compatibility-build.json'), JSON.stringify({
    source: buildIdentity.source, file: 'TacHen-compatibility.elf', selection: 'embedded-runtime-trial',
    sha256: createHash('sha256').update(bundledLauncher).digest('hex'), bytes: bundledLauncher.length,
    hardwareVerified: false
  }, null, 2) + '\n');
  console.log(`Copied newest bundled TacHen ELF to ${destination}`);
}
