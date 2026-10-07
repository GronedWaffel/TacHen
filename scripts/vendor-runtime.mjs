// SPDX-License-Identifier: GPL-3.0-or-later
// Reproducible import of audited platform plumbing, not a renamed HEN/runtime UI.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../compatibility-worktrees/ps-neighborhood/local-ps5');
const files = ['host.c', 'globals.mjs', 'net.mjs', 'http.mjs', 'fs.mjs', 'crypto.mjs', 'url.mjs'];
const manifest = { source: 'GronedWaffel/ps-neighborhood local-ps5', license: 'GPL-3.0-or-later', files: [] };
await fs.mkdir(path.join(root, 'platform/runtime'), { recursive: true });
await fs.mkdir(path.join(root, 'vendor/quickjs'), { recursive: true });
for (const name of files) {
  const original = await fs.readFile(path.join(source, 'runtime', name), 'utf8');
  let text = original.replaceAll('\r\n', '\n');
  if (name === 'host.c') {
    text = text.replace('#include "sqlite3.h"', '')
      .replace(/ case N_SQLITE:[\s\S]*?(?= case N_NATIVE:)/, ' case N_SQLITE:result=JS_ThrowInternalError(c,"Catalog adapter is not installed");break;\n')
      .replace(/ case N_NATIVE:[\s\S]*?(?= case N_NOTIFY:)/, ' case N_NATIVE:result=JS_ThrowInternalError(c,"Receiver adapter is not installed");break;\n')
      .replace('#ifdef __PS5__\n extern void psn_native_stop(void);psn_native_stop();\n#endif', '')
      .replaceAll('PS Neighborhood', 'TacHen').replaceAll('ps-neighborhood-local', 'tachen')
      .replaceAll('8088', '8780').replaceAll('PSN_', 'TACHEN_').replaceAll('psn_', 'tachen_')
      .replace('192*1048576', '48*1048576').replace('usleep(1000)', 'usleep(10000)')
      .replace('"local-workbench.js"', '"tachen-runtime.js"')
      .replace('N_ASSET,N_STOP}', 'N_ASSET,N_STOP,N_FIRMWARE}')
      .replace('"asset","stop"}', '"asset","stop","firmware"}')
      .replace(' case N_STOP:stopping=1;break;', ` case N_STOP:stopping=1;break;\n case N_FIRMWARE:\n#ifdef __PS5__\n {uint32_t fw=kernel_get_fw_version();char name[16];snprintf(name,sizeof name,"%x.%02x",fw>>24,(fw>>16)&255);result=JS_NewString(c,name);break;}\n#else\n result=JS_NULL;break;\n#endif`);
    // root itself cannot be a symlink, including before creating the process lock.
    text = text.replace('int lock=open(ROOT "/server.lock",O_CREAT|O_RDWR,0600);',
      'struct stat root_stat;if(lstat(ROOT,&root_stat)||!S_ISDIR(root_stat.st_mode)||S_ISLNK(root_stat.st_mode))return 1;int lock=open(ROOT "/server.lock",O_CREAT|O_RDWR|O_NOFOLLOW,0600);');
    text = text.replace('JSRuntime *rt=JS_NewRuntime();', 'JSRuntime *rt=JS_NewRuntime();if(!rt)return 4;')
      .replace('context=JS_NewContext(rt);', 'context=JS_NewContext(rt);if(!context){JS_FreeRuntime(rt);return 4;}');
    text = text.replace('if(n!=0&&n!=8780)', 'if(n!=0&&n!=8780&&n!=2122)');
    text = text.replace('#include "quickjs.h"', '#include "quickjs.h"\n#include "loader-worker.h"\nextern void tac_loader_bind(JSContext*,JSValue);\nextern void tac_system_bind(JSContext*,JSValue);\nextern void tac_manager_bind(JSContext*,JSValue);\nextern void tac_deck_bind(JSContext*,JSValue);');
    text = text.replace('JS_SetPropertyStr(context,global,"__native",api);', 'tac_loader_bind(context,api);tac_system_bind(context,api);tac_manager_bind(context,api);tac_deck_bind(context,api);JS_SetPropertyStr(context,global,"__native",api);');
    text = text.replace('case N_STOP:stopping=1;break;', 'case N_STOP:if(tac_loader_busy()){result=JS_ThrowInternalError(c,"A native dispatch is still active");break;}stopping=1;break;');
  } else {
    text = text.replaceAll('/data/ps-neighborhood-local', '/data/tachen');
    if (name === 'net.mjs') text = text.replace('},1);', '},10);');
  }
  text = '// SPDX-License-Identifier: GPL-3.0-or-later\n// Adapted from PS Neighborhood platform plumbing; see vendor/runtime-provenance.json.\n' + text.replace(/[ \t]+$/gm, '');
  await fs.writeFile(path.join(root, 'platform/runtime', name), text);
  manifest.files.push({ name, upstreamSha256: createHash('sha256').update(original).digest('hex') });
}
const qfiles = ['quickjs.c', 'quickjs.h', 'quickjs-atom.h', 'quickjs-opcode.h', 'dtoa.c', 'dtoa.h',
  'libregexp.c', 'libregexp.h', 'libregexp-opcode.h', 'libunicode.c', 'libunicode.h', 'libunicode-table.h',
  'cutils.c', 'cutils.h', 'list.h', 'LICENSE', 'VERSION'];
for (const file of qfiles) await fs.copyFile(path.join(source, 'vendor/quickjs-2026-06-04', file), path.join(root, 'vendor/quickjs', file));
await fs.copyFile(path.resolve(source, '../LICENSE'), path.join(root, 'LICENSE'));
await fs.writeFile(path.join(root, 'vendor/runtime-provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Imported platform plumbing and QuickJS sources with provenance; existing projects unchanged.');
