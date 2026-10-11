// SPDX-License-Identifier: GPL-3.0-or-later
import './runtime/globals.mjs';
import './runtime/url.mjs';
import { createHash, randomBytes } from './runtime/crypto.mjs';
import { StateStore } from '../src/store.mjs';
import { FileStorage } from '../src/storage.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { serve } from '../src/server.mjs';
import { PayloadInbox } from '../src/inbox.mjs';
import { installPackageInbox } from '../src/package-inbox.mjs';
import { installFileManager } from '../src/file-manager.mjs';
import { installDownloadLibrary } from '../src/download-library.mjs';
import { fileManagerIO } from './runtime/fs.mjs';
import { installLocalFiles } from '../src/local-files.mjs';
import { installPackageInstaller } from '../src/package-install.mjs';
import { installPackageReceiving } from '../src/package-receive.mjs';
import { installPackageReceiver } from '../src/package-receiver.mjs';
import { startFtp } from '../src/ftp.mjs';
import { installPayloadLoader } from '../src/payload-loader.mjs';
import { installStartupPayloads } from '../src/startup-payloads.mjs';
import { ftpInboxReceiver } from '../src/ftp-inbox.mjs';
import { ComponentAssets } from '../src/components.mjs';
import { installNativeServices } from '../src/native-services.mjs';
import { installLibrary } from '../src/library.mjs';
import { installStorageJobs } from '../src/storage-jobs.mjs';
import { installConsoleDeck } from '../src/native-deck.mjs';
import { installGameLifecycle } from '../src/game-lifecycle.mjs';
import { installPlugins } from '../src/plugins.mjs';
import { installCheats } from '../src/cheat-service.mjs';
import { installMemory } from '../src/memory-service.mjs';
import { installMcp } from '../src/mcp.mjs';
import { installTelemetry } from '../src/telemetry.mjs';
import { installPs4Fps } from '../src/ps4-fps.mjs';
import { installGameInput } from '../src/game-input.mjs';
import { installGameInputRelay } from '../src/game-input-relay.mjs';
import { installLoadouts } from '../src/loadouts.mjs';
import { installSaves } from '../src/saves.mjs';
import { installCheatSources } from '../src/cheat-sources.mjs';
import { installDownloads } from '../src/downloads.mjs';
import { installUpdates } from '../src/updates.mjs';
import { startupNotification } from '../src/startup-notification.mjs';
import components from '../build/components.json';
import assets from '../build/ui-assets.json';

globalThis.__ready = (async () => {
  const id = () => randomBytes(16).toString('hex');
  const store = await new StateStore(await new FileStorage('/data/tachen/state').init(),
    value => createHash('sha256').update(value).digest('hex')).open();
  const platform = {
    operationLog: event => console.log('TacHen operation: ' + JSON.stringify(event)),
    identity: async () => ({ mode: 'console', ip: __native.ip(), firmware: __native.firmware(), hardwareVerified: false }),
    async install(runtime) {
      runtime.inbox = await new PayloadInbox('/data/tachen/inbox', { id }).init();
      runtime.inboxItems = await runtime.inbox.list();
      await installPackageInbox(runtime, '/data/tachen/packages');
      installLocalFiles(runtime);
      installFileManager(runtime,{io:fileManagerIO});
      installDownloadLibrary(runtime);
      installDownloads(runtime, __native);
      await installUpdates(runtime, __native);
      installPackageInstaller(runtime, __native);
      installPackageReceiving(runtime);
      installPackageReceiver(runtime);
      installSaves(runtime, __native);
      runtime.capability('inbox', true, 'Resumable file upload and verification.');
      installPayloadLoader(runtime, __native);
      installStartupPayloads(runtime, __native);
      runtime.graph.register({ id: 'coordinator', start: async () => ({ session: runtime.session }),
        verify: evidence => evidence.session === runtime.session });
      await runtime.graph.start('coordinator');
      runtime.nativeServices = installNativeServices(runtime, __native,
        new ComponentAssets(runtime.inbox, components, (offset, length) => __native.asset(offset, length)));
      installLibrary(runtime, { catalog: () => __native.installedGames(), native: __native, log: message => console.log(message) });
      installStorageJobs(runtime);
      installConsoleDeck(runtime, __native);
      installGameLifecycle(runtime, __native);
      installPlugins(runtime, __native, { log: message => console.log(message) });
      installCheats(runtime, __native, await new FileStorage('/data/tachen/cheat-packs').init());
      installCheatSources(runtime);
      installMemory(runtime, __native);installMcp(runtime);
      installPs4Fps(runtime, __native);installTelemetry(runtime, __native);
      // Isolate PRX loading from the unverified in-game menu path. The home
      // menu remains available; do not inject menu controls on each game start.
      installGameInput(runtime, __native, { automatic: false });
      installGameInputRelay(runtime, __native);
      installLoadouts(runtime, __native);
      runtime.graph.register({ id: 'ftp', start: async () => {
        runtime.ftp = await startFtp({ root: '/data/tachen/share', host: '0.0.0.0', address: __native.ip(), id,
          onUpload: ftpInboxReceiver(runtime) });
        return { session: runtime.session, port: runtime.ftp.port };
      }, verify: evidence => evidence.session === runtime.session && evidence.port === 2122 });
      if (runtime.store.snapshot().settings.services.ftp) {
        await runtime.graph.start('ftp'); runtime.capability('ftp', true, 'TacHen share on port 2122. Console and USB filesystem adapters remain separate.');
      }
    }
  };
  const runtime = await new TacRuntime(store, platform, { id }).start();
  await serve(runtime, { assets, host: '0.0.0.0', port: 8780, id });
  __native.notify('TacHen is starting');
  // Reserve ordered startup before automatic game consumers can enqueue work.
  console.log("TacHen startup: before configured services");
  const startup = runtime.nativeServices.startConfigured();
  console.log("TacHen startup: configured services scheduled");
  console.log("TacHen startup: before gameLifecycle");
  runtime.gameLifecycle.start();
  console.log("TacHen startup: after gameLifecycle");
  console.log("TacHen startup: before plugins");
  runtime.plugins.start();
  console.log("TacHen startup: after plugins");
  console.log("TacHen startup: before loadouts");
  runtime.loadouts?.start();
  console.log("TacHen startup: after loadouts");
  console.log("TacHen startup: before telemetry");
  runtime.telemetry?.start();
  console.log("TacHen startup: after telemetry");
  console.log("TacHen startup: before ps4Fps");
  runtime.ps4Fps?.start();
  console.log("TacHen startup: after ps4Fps");
  console.log("TacHen startup: before gameInput");
  runtime.gameInput?.start();
  console.log("TacHen startup: after gameInput");
  console.log("TacHen startup: before gameInputRelay");
  runtime.gameInputRelay?.start();
  console.log("TacHen startup: after gameInputRelay");
  // The phone stays responsive while durable native startup jobs execute.
  startup.then(result => {
    runtime.nativeServices.startMonitoring(); runtime.nativeDeck.startMonitoring();
    __native.notify(startupNotification(result, runtime.capabilities.get('deck')?.available, runtime.identity.ip));
  }).catch(error => {
    console.error(error.message); __native.notify(startupNotification({ error }, false, runtime.identity.ip));
  });
})().catch(error => { console.error(error.stack || error.message); __native.notify('TacHen could not start. Existing HEN services were not changed.'); __native.stop(); });
