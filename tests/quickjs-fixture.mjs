// Only portable coordinator code runs here. Native hardware APIs are absent.
import { Buffer } from 'buffer';
import { createHash } from '../platform/runtime/crypto.mjs';
import { StateStore } from '../src/store.mjs';
import { mergeSettings } from '../src/settings.mjs';
import { inspectPayload } from '../src/payload-format.mjs';
import { encodeDeck } from '../src/deck.mjs';
import { inspectPackage } from '../src/package-format.mjs';
import { installPackageInstaller } from '../src/package-install.mjs';
globalThis.Buffer = Buffer;
globalThis.TextEncoder = class { encode(value) { return Buffer.from(value); } };
function assert(value, message) { if (!value) throw Error(message); }
globalThis.testPassed = false;
(async () => {
  const files = new Map(), checksum = text => createHash('sha256').update(text).digest('hex');
  const disk = { read: async name => files.get(name) ?? null, replace: async (name, text) => files.set(name, text) };
  const store = await new StateStore(disk, checksum).open();
  await store.transaction(s => { s.settings = mergeSettings(s.settings, { appearance: { accent: 'ice' } }); });
  const reopened = await new StateStore(disk, checksum).open();
  assert(reopened.snapshot().settings.appearance.accent === 'ice', 'QuickJS persistence failed');
  const binary = Buffer.alloc(160); Buffer.from([0x7f,69,76,70,2,1,1]).copy(binary);
  binary.writeUInt16LE(3,16);binary.writeUInt16LE(62,18);binary.writeBigUInt64LE(128n,24);binary.writeBigUInt64LE(64n,32);
  binary.writeUInt16LE(64,52);binary.writeUInt16LE(56,54);binary.writeUInt16LE(1,56);binary.writeUInt32LE(1,64);binary.writeUInt32LE(5,68);
  binary.writeBigUInt64LE(160n,96);binary.writeBigUInt64LE(160n,104);
  assert(inspectPayload(binary,'quickjs.elf').bytes===160,'QuickJS ELF parser failed');
  assert(checksum('TacHen').length === 64, 'QuickJS checksum failed');
  const frame = encodeDeck({ sequence: 7, page: 1, ready: true, title: 'TacHen', subtitle: 'Controller', footer: 'Back', ip: '127.0.0.1',
    rows: [{ token: 'a'.repeat(32), label: 'Payload 二', detail: 'Ready', enabled: true }] });
  assert(frame.length === 2800 && frame.readUInt32LE(8) === 7 && frame.readUInt32LE(752) === 1, 'QuickJS deck wire failed');
  const packageHeader = Buffer.alloc(0x438), packageSize = 180 * 1024 ** 3;
  packageHeader.writeUInt32BE(0x7f434e54); packageHeader.write('UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP', 0x40);
  packageHeader.writeUInt32BE(0x1a, 0x74); packageHeader.writeBigUInt64BE(BigInt(packageSize), 0x430);
  const pkg = await inspectPackage(async () => packageHeader, packageSize);
  assert(pkg.bytes === packageSize && pkg.platform === 'ps4', 'QuickJS large package parser failed');
  let packageHandler, accepted = 0;
  const packageRequest = 'd'.repeat(32), packageUpload = 'e'.repeat(32), packageHash = 'f'.repeat(64);
  const localRuntime = { identity: { firmware: '13.60' }, capability() {},
    jobs: { register(kind, handler) { packageHandler = handler; }, snapshot: () => [{ kind: 'package.verify', args: { id: packageUpload }, status: 'completed', result: { sha256: packageHash } }] },
    packageInbox: { describe: async () => ({ id: packageUpload, status: 'verified', bytes: packageSize, package: pkg }) } };
  installPackageInstaller(localRuntime, { systemProbe: () => ({ kstuff: { state: 'installed', injectionReady: true } }),
    packageStart() { accepted++; }, packagePoll: () => ({ request: packageRequest, upload: packageUpload, sha256: packageHash,
      contentId: pkg.contentId, bytes: packageSize, stage: 6, ageMs: 0, sameBoot: true, accepted: true, observed: true, error: 0 }) });
  const packageInput = await packageHandler.validate({ id: packageUpload });
  const install = await packageHandler.run(packageInput, { id: packageRequest, signal: { aborted: false }, checkpoint: async () => {} });
  assert(accepted === 1 && await packageHandler.verify(install, packageInput), 'QuickJS installer receipt adapter failed');
  print('QuickJS: persistent state, preferences, SHA-256, 64-bit ELF/PKG parsers, installer receipt adapter and controller wire passed. Native APIs not tested.');
  globalThis.testPassed = true;
})().catch(error => print(error.stack || error.message));
