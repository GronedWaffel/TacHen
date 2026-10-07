// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateStore } from './store.mjs';
import { FileStorage } from './storage.mjs';
import { TacRuntime } from './runtime.mjs';
import { serve } from './server.mjs';
import { PayloadInbox } from './inbox.mjs';
import { startFtp } from './ftp.mjs';
import { ftpInboxReceiver } from './ftp-inbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = await new FileStorage(path.join(root, '.local/state')).init();
const store = await new StateStore(storage, value => createHash('sha256').update(value).digest('hex')).open();
const id = () => randomBytes(16).toString('hex');
const platform = {
  async identity() { return { mode: 'development', firmware: null, ip: '127.0.0.1', hardwareVerified: false }; },
  async install(runtime) {
    runtime.inbox = await new PayloadInbox(path.join(root, '.local/inbox'), { id }).init();
    runtime.inboxItems = await runtime.inbox.list();
    runtime.capability('inbox', true, 'File upload and structural verification. Execution requires the native loader.');
    runtime.graph.register({ id: 'ftp', start: async () => {
      runtime.ftp = await startFtp({ root: path.join(root, '.local/share'), host: '127.0.0.1', address: '127.0.0.1', id,
        onUpload: ftpInboxReceiver(runtime) });
      return { session: runtime.session, port: runtime.ftp.port };
    }, verify: evidence => evidence.session === runtime.session && evidence.port === 2122 });
    if (runtime.store.snapshot().settings.services.ftp) {
      await runtime.graph.start('ftp'); runtime.capability('ftp', true, 'Loopback development share on port 2122. No console filesystem access.');
    }
  }
};
const runtime = await new TacRuntime(store, platform, { id }).start();
const server = await serve(runtime, { uiRoot: path.join(root, 'ui'), host: '127.0.0.1', port: 8780, id });
console.log('TacHen development deck: http://127.0.0.1:8780 (no console connection)');
async function close() { server.closeAllConnections?.(); server.close(); await runtime.ftp?.stop(); await runtime.close(); }
process.once('SIGINT', close); process.once('SIGTERM', close);
