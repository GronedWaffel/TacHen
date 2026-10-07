// Only portable coordinator code runs here. Native hardware APIs are absent.
import '../platform/runtime/globals.mjs';
import { Buffer } from 'buffer';
import { createHash } from '../platform/runtime/crypto.mjs';
import { StateStore } from '../src/store.mjs';
import { mergeSettings } from '../src/settings.mjs';
import { inspectPayload } from '../src/payload-format.mjs';
import { encodeDeck } from '../src/deck.mjs';
import { pluginDeckRows } from '../src/deck-plugins.mjs';
import { inspectPackage } from '../src/package-format.mjs';
import { installPackageInstaller } from '../src/package-install.mjs';
import { packageDeckRows } from '../src/deck-packages.mjs';
import { GameLifecycle } from '../src/game-lifecycle.mjs';
import { installPlugins } from '../src/plugins.mjs';
import { installCheats } from '../src/cheat-service.mjs';
import { installMemory } from '../src/memory-service.mjs';
import { installMcp } from '../src/mcp.mjs';
import { CounterWindow } from '../src/telemetry.mjs';
import { installPs4Fps } from '../src/ps4-fps.mjs';
import { installGameInput } from '../src/game-input.mjs';
import { installGameInputRelay } from '../src/game-input-relay.mjs';
import { installLoadouts } from '../src/loadouts.mjs';
import { installSaves } from '../src/saves.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { SessionHistory } from '../src/history.mjs';
import { StartupRecovery } from '../src/startup-recovery.mjs';
import { makeUpdatePackage, inspectUpdate } from '../src/update-format.mjs';
import { importCheatSource } from '../src/cheat-xml.mjs';
import { compareCandidate } from '../src/scan-refinement.mjs';
import { JobArchive } from '../src/job-archive.mjs';
import { importCheatFile } from '../src/cheat-import.mjs';
import mc4Fixture from './fixtures/mc4.json';
globalThis.Buffer = Buffer;
globalThis.__native = { log: message => print(message) };
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
  const archiveFiles = new Map(), archiveStore = await new StateStore({ read: async name => archiveFiles.get(name) ?? null,
    replace: async (name, text) => archiveFiles.set(name, text) }, checksum).open();
  await archiveStore.transaction(state => { state.jobs = Array.from({ length: 768 }, (_, i) => ({
    id: (i + 1).toString(16).padStart(32, '0'), key: `quickjs-archive-${i}`, kind: 'memory.inspect', args: {},
    status: 'completed', signature: '{}', requestSignature: '{}', result: { completed: true }, resources: [] })); });
  const archive = new JobArchive(archiveStore);
  await archiveStore.transaction(state => archive.compact(state, new Set()));
  const archived = await archiveStore.inspect(state => archive.find(state, 'quickjs-archive-0'));
  assert(archived?.archived && archived.status === 'completed' && archiveStore.snapshot().jobs.length === 704, 'QuickJS operation archive failed');
  const binary = Buffer.alloc(160); Buffer.from([0x7f,69,76,70,2,1,1]).copy(binary);
  binary.writeUInt16LE(3,16);binary.writeUInt16LE(62,18);binary.writeBigUInt64LE(128n,24);binary.writeBigUInt64LE(64n,32);
  binary.writeUInt16LE(64,52);binary.writeUInt16LE(56,54);binary.writeUInt16LE(1,56);binary.writeUInt32LE(1,64);binary.writeUInt32LE(5,68);
  binary.writeBigUInt64LE(160n,96);binary.writeBigUInt64LE(160n,104);
  assert(inspectPayload(binary,'quickjs.elf').bytes===160,'QuickJS ELF parser failed');
  assert(checksum('TacHen').length === 64, 'QuickJS checksum failed');
  const xmlCheat = importCheatSource('<Trainer Game="Fixture &amp; data" Moder="Fixture author" Process="eboot.bin" Cusa="CUSA00001" Version="01.00"><Cheat Text="Patch"><Cheatline><Offset>10</Offset><ValueOn>90-90</ValueOn><ValueOff>01-02</ValueOff></Cheatline></Cheat></Trainer>', { titleId: 'CUSA00001', version: '01.00' });
  assert(xmlCheat.name === 'Fixture & data' && xmlCheat.cheats[0].memory[0].on === '9090', 'QuickJS SHN parser failed');
  const mc4Cheat = await importCheatFile(mc4Fixture.source, { titleId: 'CUSA00001', version: '01.20' });
  assert(mc4Cheat.name === 'TacHen MC4 fixture' && mc4Cheat.cheats[0].memory[0].on === '9090', 'QuickJS lazy AES/MC4 import failed');
  const frame = encodeDeck({ sequence: 7, page: 1, ready: true, title: 'TacHen', subtitle: 'Controller', footer: 'Back', ip: '127.0.0.1',
    rows: [{ token: 'a'.repeat(32), label: 'Payload 二', detail: 'Ready', enabled: true }] });
  assert(frame.length === 6424 && frame.readUInt16LE(4) === 5 && frame.readUInt32LE(8) === 7 && frame.readUInt32LE(752) === 1 && frame.readUInt32LE(2800) === 1, 'QuickJS deck wire failed');
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
  const packageRows = packageDeckRows({ packages: [{ id: packageUpload, name: 'example.pkg', status: 'verified', bytes: packageSize, offset: packageSize }],
    capabilities: [{ id: 'packages', available: true }] }, { id: packageUpload }, [{ kind: 'package.verify', status: 'completed',
    resources: ['package-file:' + packageUpload], result: { sha256: packageHash, package: pkg } }]);
  const installRow = packageRows.find(row => row.label === 'Install package');
  assert(installRow.enabled && installRow.confirm && installRow.args.input.sha256 === packageHash && installRow.args.input.bytes === packageSize,
    'QuickJS controller package review binding failed');
  const gameRuntime = { sequence: 0 }, gameMetadata = Buffer.from(JSON.stringify({ titleId: 'PPSA00001', contentVersion: '01.002.003' }));
  const lifecycle = new GameLifecycle(gameRuntime, { systemProbe: () => ({ appInfoAvailable: true,
    processes: [{ pid: 101, generation: 'boot/101/100:0', appId: 24, titleId: 'PPSA00001', name: 'eboot.bin' }] }),
    gameMetadata: () => ({ scope: 'running-sandbox', format: 'json', bytes: gameMetadata }) });
  await lifecycle.refresh(); assert(!gameRuntime.game, 'QuickJS lifecycle published one unconfirmed observation');
  await lifecycle.refresh(); assert(gameRuntime.game.version === '01.002.003', 'QuickJS lifecycle metadata failed');
  lifecycle.stop(); assert(lifecycle.lease.signal.aborted, 'QuickJS native-runtime abort implementation failed');
  let pluginHandler, moduleHandler, pluginReceipt, moduleReceipt;
  const pluginHash = 'a'.repeat(64), pluginUpload = 'b'.repeat(32), pluginRequest = 'c'.repeat(32);
  const pluginRuntime = { store, sequence: 0, graph: { safe: false }, capability() {},
    inbox: { verify: async () => ({ id: pluginUpload, name: 'test.plugin', format: 'plugin', sha256: pluginHash, pluginId: 'TACP00001', pluginVersion: '1.00' }) },
    jobs: { register(kind, handler) { if (kind === 'plugin.start') pluginHandler = handler; else if (kind === 'game.module.start') moduleHandler = handler; }, snapshot: () => [] } };
  let historyId = 1000;Object.assign(pluginRuntime, { id: () => (++historyId).toString(16).padStart(32, '0'), now: () => 100, session: '9'.repeat(32) });
  pluginRuntime.changes = new SessionHistory(pluginRuntime);
  const plugins = installPlugins(pluginRuntime, { systemProbe: () => ({ boot: '100:0', kstuff: { injectionReady: true }, processes: [] }),
    pluginStart(request, upload, sha256) { pluginReceipt = { request, sha256, stage: 3, plugin: true, pluginId: 'TACP00001',
      pluginVersion: '1.00', pid: 88, generation: '100:0/88/101:0' }; }, loaderPoll: () => pluginReceipt,
    gameModuleStart(request, upload, sha256, pid, generation) { moduleReceipt = { request, sha256, pid, generation, stage: 4, handle: 3, startResult: 0 }; },
    gameModulePoll: () => moduleReceipt });
  await plugins.register({ upload: pluginUpload, scope: 'system', revision: store.snapshot().revision });
  const pluginRows=pluginDeckRows({plugins:plugins.list(),inbox:[],revision:store.snapshot().revision},{kind:'detail',sha256:pluginHash});
  assert(pluginRows.some(row=>row.label==='Start now'&&row.enabled&&row.args.kind==='plugin.start'&&row.confirm), 'QuickJS controller plugin launch controls failed');
  const pluginInput = await pluginHandler.validate({ sha256: pluginHash, source: 'manual' });
  const loaded = await pluginHandler.run(pluginInput, { id: pluginRequest, signal: { aborted: false } });
  assert(await pluginHandler.verify(loaded, pluginInput) && loaded.initialized === false, 'QuickJS plugin dispatch contract failed');
  const moduleHash = '1'.repeat(64), moduleUpload = '2'.repeat(32);
  pluginRuntime.inbox.verify = async () => ({ id: moduleUpload, name: 'test.prx', format: 'prx', platform: 'ps5', sha256: moduleHash });
  pluginRuntime.game = { ...gameRuntime.game, pid: 101, generation: '100:0/101/110:0' };
  await plugins.register({ upload: moduleUpload, scope: 'game', target: { titleId: 'PPSA00001', version: '01.002.003' }, revision: store.snapshot().revision });
  const moduleInput = await moduleHandler.validate({ sha256: moduleHash, source: 'manual' });
  const moduleLoaded = await moduleHandler.run(moduleInput, { id: '3'.repeat(32), signal: { aborted: false } });
  assert(moduleLoaded.initialized && await moduleHandler.verify(moduleLoaded, moduleInput), 'QuickJS game module receipt contract failed');
  let cheatHandler, cheatReceipt;
  const cheatRuntime = { ...pluginRuntime, jobs: { register(_kind, handler) { cheatHandler = handler; }, snapshot: () => [] } };
  const cheats = installCheats(cheatRuntime, {
    systemProbe: () => ({ boot: '100:0', kstuff: { injectionReady: true }, processes: [] }),
    cheatStart(request, pid, generation, _title, _metadata, _module, packet) {
      const bytes = Buffer.from(packet);assert(bytes.readUInt32LE(0) === 0x54435031 && bytes.readBigUInt64LE(16) === 16n, 'QuickJS native cheat packet failed');
      cheatReceipt = { request, pid, generation, planHash: checksum(bytes), stage: 3, resumed: true, restored: false, writes: 1 };
    }, cheatPoll: () => cheatReceipt
  }, disk);
  const cheatPack = await cheats.packs.import({ titleId: 'PPSA00001', version: '01.002.003', source: JSON.stringify({ name: 'Fixture', process: 'eboot.bin',
    mods: [{ name: 'Test', memory: [{ offset: '10', on: '9090', off: '0102' }] }] }) });
  const cheatInput = await cheatHandler.validate({ sha256: cheatPack.sha256, cheatId: '0', enabled: true });
  const cheatLoaded = await cheatHandler.run(cheatInput, { id: '4'.repeat(32), signal: { aborted: false } });
  assert(cheatLoaded.phase === 'applied' && await cheatHandler.verify(cheatLoaded, cheatInput), 'QuickJS cheat receipt failed');
  let inspectionReceipt, inspectionHandler, counter = 100, inspectionBytes = [1, 2, 3, 4];
  await store.transaction(state => { state.settings.developer.enabled = true; });
  const inspectionRuntime = { ...cheatRuntime, now: Date.now, session: 'fixture-session', id: () => (++counter).toString(16).padStart(32, '0'),
    jobs: { handlers: new Map(), register(kind, handler) { inspectionHandler = handler;this.handlers.set(kind, handler); } } };
  const memory = installMemory(inspectionRuntime, {
    systemProbe: () => ({ boot: '100:0', kstuff: { injectionReady: true }, processes: [] }),
    inspectStart(request, pid, generation, _title, _metadata, _module, wire) {
      const bytes = Buffer.from(wire);assert(bytes.readUInt32LE(12) === 0x544d5231, 'QuickJS inspection packet failed');
      inspectionReceipt = { request, pid, generation, planHash: checksum(bytes), stage: 3, resumed: true, restored: true, writes: 0,
        base: '0x400000', size: '0x100000', bytes: new Uint8Array(inspectionBytes.slice(0, bytes.readUInt32LE(8))).buffer };
    }, inspectPoll: () => inspectionReceipt
  });
  const input = await inspectionHandler.validate({ mode: 'read', module: 'eboot.bin', offset: '0x10', length: 4 });
  const inspected = await inspectionHandler.run(input, { id: '5'.repeat(32), signal: { aborted: false }, checkpoint: async () => {}, progress: async () => {} });
  assert(await inspectionHandler.verify(inspected, input) && memory.result(inspected.result).bytes === '01020304', 'QuickJS inspection result failed');
  const scanInput = await inspectionHandler.validate({ mode: 'scan', module: 'eboot.bin', offset: '0x10', length: 4, pattern: '01??' });
  const scanResult = await inspectionHandler.run(scanInput, { id: '6'.repeat(32), signal: { aborted: false }, checkpoint: async () => {}, progress: async () => {} });
  inspectionBytes[1] = 9;
  const refinement = await inspectionHandler.validate({ mode: 'refine', source: scanResult.result, comparison: 'changed' });
  const refined = await inspectionHandler.run(refinement, { id: '7'.repeat(32), signal: { aborted: false }, checkpoint: async () => {}, progress: async () => {} });
  assert(memory.result(refined.result).matches.join() === '0x10', 'QuickJS differential refinement failed');
  const largeBefore = Buffer.alloc(8), largeAfter = Buffer.alloc(8);largeBefore.writeBigUInt64LE(0xfffffffffffffff0n);largeAfter.writeBigUInt64LE(0xfffffffffffffff1n);
  assert(compareCandidate(largeBefore, largeAfter, 'increased', null, 'u64'), 'QuickJS 64-bit refinement precision failed');
  const mcp = installMcp(inspectionRuntime), access = mcp.issue();mcp.authenticate('Bearer ' + access.token);
  const init = await mcp.message({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'QuickJS fixture' } } });
  await mcp.message({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.session);
  const listed = await mcp.message({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.session);
  assert(listed.body.result.tools.some(t => t.name === 'memory_inspect'), 'QuickJS MCP lifecycle failed');mcp.revoke();
  const fpsWindow = new CounterWindow();
  fpsWindow.consume({ time: 1000, ring: '18446744073709550000' });
  const measured = fpsWindow.consume({ time: 1500, ring: '18446744073709550030' });
  assert(measured.fps === 60 && measured.fpsSource === 'agc-ring', 'QuickJS 64-bit telemetry counter failed');
  let ps4Handler, ps4Receipt;
  await store.transaction(state => { state.settings.overlay.fps = true; });
  const ps4Runtime = { ...inspectionRuntime, game: { pid: 105, generation: '100:0/105/110:0', titleId: 'CUSA00001', version: '01.00', metadataHash: 'a'.repeat(64) },
    jobs: { register(kind, handler) { if (kind === 'fps.ps4.prepare') ps4Handler = handler; }, snapshot: () => [] } };
  installPs4Fps(ps4Runtime, { systemProbe: () => ({ boot: '100:0', kstuff: { injectionReady: true } }),
    bcFpsStart(request, pid, generation, title, metadataHash) { assert(title === 'CUSA00001', 'PS4 counter target failed');ps4Receipt = { request, pid, generation, metadataHash, stage: 2, resumed: true, uncertain: false }; },
    bcFpsPoll: () => ps4Receipt });
  const ps4Input = ps4Handler.validate({}), ps4Result = await ps4Handler.run(ps4Input, { id: '6'.repeat(32), signal: { aborted: false } });
  assert(ps4Handler.verify(ps4Result, ps4Input), 'QuickJS PS4 counter installation contract failed');
  let inputHandler, inputReceipt;
  const inputRuntime = { ...ps4Runtime, capabilities: new Map([['deck', { available: true }]]), nativeDeck: { inspect: () => ({ ready: true }) },
    jobs: { register(kind, handler) { if (kind === 'game.input.prepare') inputHandler = handler; } } };
  installGameInput(inputRuntime, { systemProbe: () => ({ boot: '100:0', kstuff: { injectionReady: true } }),
    gameInputStart(request, pid, generation, title, metadataHash) { assert(title === 'CUSA00001', 'Input game identity failed');inputReceipt = { request, pid, generation, metadataHash, stage: 2, phase: 2 }; },
    gameInputPoll: () => inputReceipt });
  const inputTarget = inputHandler.validate({}), inputResult = await inputHandler.run(inputTarget, { id: '7'.repeat(32), signal: { aborted: false } });
  assert(inputHandler.verify(inputResult, inputTarget) && inputResult.phase === 'prepared', 'QuickJS shared game input preparation failed');
  let relayNow=1000,relaySample;
  inputRuntime.jobs.running=new Set();inputRuntime.gameInput.observation={generation:inputTarget.generation,phase:'prepared'};
  const relay=installGameInputRelay(inputRuntime,{
    gameInputClock:()=>relayNow,
    gameInputExchange(pid,generation,metadataHash,epoch){relaySample={serial:1,pid,generation,metadataHash,epoch,result:0,time:relayNow,deadline:relayNow+400,events:[]};return 1;},
    gameInputExchangePoll:()=>relaySample
  });
  relay.receive({epoch:0,serial:0,open:false,owner:-1,connection:0,ready:true,renderedAt:relayNow});relay.tick();relayNow+=25;relay.tick();
  const inputFrame=encodeDeck({sequence:1,page:0,rows:[],title:'Input',ready:true,input:relay.frame()});
  assert(inputFrame.readUInt32LE(3008)===1&&inputFrame.readBigUInt64LE(3032)===1300n,'QuickJS input relay wire failed');
  let loadoutId = 0;
  const loadoutRuntime = await new TacRuntime(store, { identity: async () => ({ mode: 'development', ip: '127.0.0.1' }),
    install(runtime) { installLoadouts(runtime, { systemProbe: () => ({ boot: '100:0', kstuff: { injectionReady: true } }) }); } },
    { id: () => (++loadoutId).toString(16).padStart(32, '0') }).start();
  loadoutRuntime.game = { ...ps4Runtime.game };loadoutRuntime.capability('ip-overlay', true);
  await loadoutRuntime.execute('loadout.save', { revision: store.snapshot().revision, profile: {
    titleId: 'CUSA00001', version: '01.00', name: 'QuickJS setup', plugins: [], cheats: [], overlay: { ip: true }, autostart: false } });
  const loadoutJob = await loadoutRuntime.jobs.enqueue('loadout.apply', {}, 'quickjs-loadout');
  for (let i = 0; i < 500 && loadoutRuntime.jobs.snapshot().some(j => ['queued', 'running'].includes(j.status)); i++) await Promise.resolve();
  assert(loadoutRuntime.jobs.snapshot().find(j => j.id === loadoutJob.id)?.result?.fullyApplied && loadoutRuntime.overlaySettings().ip, 'QuickJS loadout application failed');
  assert(loadoutRuntime.snapshot().notices.current?.title === 'Game loadout completed', 'QuickJS adaptive completion notice failed');
  loadoutRuntime.game = null;assert(!loadoutRuntime.overlaySettings().ip, 'QuickJS loadout overlay leaked to dashboard');
  await loadoutRuntime.settings({ overlay: { fps: false }, developer: { enabled: false } }, store.snapshot().revision);
  await loadoutRuntime.settings({ appearance: { reducedMotion: true } }, store.snapshot().revision);
  const historyPlan = loadoutRuntime.changes.preview(store.snapshot().history.at(-1));
  assert(historyPlan.available && historyPlan.proof.length === 64, 'QuickJS change review failed');
  await loadoutRuntime.execute('history.undo', historyPlan);
  assert(!loadoutRuntime.snapshot().settings.appearance.reducedMotion && !loadoutRuntime.changes.preview({ id: historyPlan.id }).available,
    'QuickJS preference undo failed');await loadoutRuntime.close();
  let saveReceipt;
  const saveRuntime = await new TacRuntime(store, { identity: async () => ({ mode: 'development' }), install(runtime) {
    installSaves(runtime, { systemProbe: () => ({ kstuff: { state: 'installed', injectionReady: true } }),
      saveStart(request, mode, user, titleId, slot, stamp, destination, volume, platform) {
        saveReceipt = { request, mode, user, titleId, slot, stamp, destination, volume, platform, stage: 8, ageMs: 0, sameBoot: true,
          noSideEffects: true, mounted: false, totalBytes: 512, completedBytes: 512, archiveBytes: 512, files: 0, sha256: 'd'.repeat(64),
          output: `/data/tachen/save-export/${request}.catalog.json`, message: 'Local test catalog' };
      }, savePoll: () => saveReceipt, saveCatalog: () => JSON.stringify({ version: 1, saves: [], volumes: [], skipped: 0 })
    });
  } }, { id: () => (++loadoutId).toString(16).padStart(32, '0') }).start();
  const saveJob = await saveRuntime.jobs.enqueue('save.refresh', {}, 'quickjs-save-refresh');
  for (let i = 0; i < 500 && saveRuntime.jobs.snapshot().some(j => ['queued', 'running'].includes(j.status)); i++) await Promise.resolve();
  assert(saveRuntime.jobs.snapshot().find(j => j.id === saveJob.id)?.status === 'completed' && saveRuntime.saves.list().total === 0, 'QuickJS save queue/catalog failed');
  await saveRuntime.settings({ developer: { diagnostics: true } }, store.snapshot().revision);
  saveRuntime.diagnostics.record('quickjs', { evidence: { stage: 7, credential: 'must-not-export' } });
  await saveRuntime.settings({ developer: { diagnostics: false } }, store.snapshot().revision);
  const supportReport = await saveRuntime.execute('diagnostics.export', {});
  assert(supportReport.runs.at(-1).ended === 'disabled' && supportReport.runs.at(-1).events.some(e => e.evidence.stage === 7) &&
    !JSON.stringify(supportReport).includes('must-not-export'), 'QuickJS support capture, persistence/export or redaction failed');
  await saveRuntime.execute('diagnostics.clear', {});
  assert(saveRuntime.snapshot().diagnostics.captures === 0, 'QuickJS support clear failed');
  await saveRuntime.close();
  const recoveryFiles = new Map(), recoveryStore = await new StateStore({ read: async key => recoveryFiles.get(key) || null,
    replace: async (key, value) => { recoveryFiles.set(key, value); } }, value => createHash('sha256').update(value).digest('hex')).open();
  await recoveryStore.transaction(s => { s.startup.safe = true; });
  const recoveryRuntime = await new TacRuntime(recoveryStore, { identity: async () => ({ mode: 'development', firmware: '13.60' }),
    install(runtime) {
      for (const id of ['kstuff', 'shadowmount', 'payload-manager']) runtime.graph.register({ id, optional: true,
        start: async () => ({ ready: true }), inspect: async () => ({ ready: true }), verify: evidence => evidence.ready });
      runtime.recovery = new StartupRecovery(runtime, { systemProbe: () => ({ boot: 'quickjs-boot' }) });
    } }, { id: () => (++loadoutId).toString(16).padStart(32, '0') }).start();
  const recoveryPlan = await recoveryRuntime.execute('startup.preview', {});
  assert(recoveryPlan.available && recoveryRuntime.graph.safe, 'QuickJS safe recovery preview failed');
  await recoveryRuntime.execute('startup.resume', { proof: recoveryPlan.proof });await recoveryRuntime.recovery.pending;
  assert(!recoveryRuntime.graph.safe && recoveryStore.snapshot().knownGoodReceipt.services.length === 3, 'QuickJS reviewed recovery/known-good promotion failed');
  await recoveryRuntime.close();
  const updatePackage = makeUpdatePackage(binary, { source: 'a'.repeat(64), label: 'QuickJS update fixture' });
  assert(inspectUpdate(updatePackage, { firmware: '13.60' }).source === 'a'.repeat(64), 'QuickJS update format/hash failed');
  updatePackage[updatePackage.length - 1] ^= 1;
  let updateRejected=false;try{inspectUpdate(updatePackage);}catch(error){updateRejected=error.code==='UPDATE_CHECKSUM';}
  assert(updateRejected,'QuickJS update payload corruption was not rejected');
  print('QuickJS: persistent state, preferences, SHA-256, 64-bit ELF/PKG parsers, native adapter receipts, memory inspection/MCP, telemetry, game lifecycle, loadouts and controller wire passed. Native APIs not tested.');
  globalThis.testPassed = true;
})().catch(error => print(error.stack || error.message));
