// SPDX-License-Identifier: GPL-3.0-or-later
import './runtime/globals.mjs';
import './runtime/url.mjs';
import { createHash, randomBytes } from './runtime/crypto.mjs';
import { StateStore } from '../src/store.mjs';
import { FileStorage } from '../src/storage.mjs';
import { TacRuntime } from '../src/runtime.mjs';
import { serve } from '../src/server.mjs';
import { PayloadInbox } from '../src/inbox.mjs';
import { startFtp } from '../src/ftp.mjs';
import { installPayloadLoader } from '../src/payload-loader.mjs';
import { ftpInboxReceiver } from '../src/ftp-inbox.mjs';
import { ComponentAssets } from '../src/components.mjs';
import { installNativeServices } from '../src/native-services.mjs';
import { installLibrary } from '../src/library.mjs';
import components from '../build/components.json';
import assets from '../build/ui-assets.json';

globalThis.__ready = (async () => {
  const id = () => randomBytes(16).toString('hex');
  const store = await new StateStore(await new FileStorage('/data/tachen/state').init(),
    value => createHash('sha256').update(value).digest('hex')).open();
  const platform = {
    identity: async () => ({ mode: 'console', ip: __native.ip(), firmware: __native.firmware(), hardwareVerified: false }),
    async install(runtime) {
      runtime.inbox = await new PayloadInbox('/data/tachen/inbox', { id }).init();
      runtime.inboxItems = await runtime.inbox.list();
      runtime.capability('inbox', true, 'Resumable file upload and verification.');
      installPayloadLoader(runtime, __native);
      runtime.graph.register({ id: 'coordinator', start: async () => ({ session: runtime.session }),
        verify: evidence => evidence.session === runtime.session });
      await runtime.graph.start('coordinator');
      runtime.nativeServices = installNativeServices(runtime, __native,
        new ComponentAssets(runtime.inbox, components, (offset, length) => __native.asset(offset, length)));
      installLibrary(runtime);
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
  __native.notify(`TacHen development runtime loaded\nPhone: http://${runtime.identity.ip}:8780`);
  // The phone stays responsive while durable native startup jobs execute.
  runtime.nativeServices.startConfigured().then(() => runtime.nativeServices.startMonitoring()).catch(error => {
    console.error(error.message); __native.notify('TacHen startup needs attention. Open Activity on your phone.');
  });
})().catch(error => { console.error(error.stack || error.message); __native.notify('TacHen could not start. Existing HEN services were not changed.'); __native.stop(); });
