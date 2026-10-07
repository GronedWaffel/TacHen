// SPDX-License-Identifier: GPL-3.0-or-later
// Import the tested port's loader; never modify the released source tree.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = path.resolve(root, '../snipers-youtube-experimental/etahen-13.60');
const files = {
  'elfldr.c': 'Source Code/libelfldr/src/elfldr.c',
  'elfldr.h': 'Source Code/libelfldr/include/elfldr.h',
  'pt.c': 'Source Code/libNineS/src/pt.c',
  'pt.h': 'Source Code/libNineS/include/pt.h',
  'log.h': 'Source Code/libelfldr/include/log.h',
  'port_timing.h': 'Source Code/include/port_timing.h',
  'port_diagnostic.h': 'Source Code/include/port_diagnostic.h',
  'syscall-shim.S': 'port/syscall-shim.S',
  'sha256.c': '../experimental/diagnostics/sha256.c',
  'sha256.h': '../experimental/diagnostics/sha256.h'
};
const provenance = { source: 'GronedWaffel etaHEN port; libelfldr/libNineS by John Törnblom', license: 'GPL-3.0-or-later', files: [] };
await fs.mkdir(path.join(root, 'platform/loader'), { recursive: true });
for (const [name, from] of Object.entries(files)) {
  const original = await fs.readFile(path.join(upstream, from));
  let text = original.toString().replaceAll('\r\n', '\n');
  if (name === 'elfldr.c') {
    // All mapping now passes the full-image validator; remove the old unchecked
    // mirror arithmetic, shallow sanity check and section-only relocation walker.
    const begin = text.indexOf('/**\n* Parse a R_X86_64_RELATIVE');
    const end = text.indexOf('/**\n * Create payload args');
    if (begin < 0 || end < begin) throw Error('Loader source changed; review import');
    text = text.slice(0, begin) + 'extern intptr_t tac_elf_map(pid_t, const uint8_t*, size_t);\n\n' + text.slice(end);
    text = text.replace('elfldr_prepare_exec(pid_t pid, uint8_t *elf)', 'elfldr_prepare_exec(pid_t pid, uint8_t *elf, size_t size)')
      .replace('elfldr_load(pid, elf)', 'tac_elf_map(pid, elf, size)')
      .replace('elfldr_exec(pid_t pid, int stdio, uint8_t* elf)', 'elfldr_exec(pid_t pid, int stdio, uint8_t* elf, size_t size)')
      .replace('elfldr_prepare_exec(pid, elf)', 'elfldr_prepare_exec(pid, elf, size)')
      .replace('const char* name) {\n  const uint64_t spawn_started', 'const char* name, size_t size) {\n  const uint64_t spawn_started')
      .replace('elfldr_exec(pid, stdio, elf)', 'elfldr_exec(pid, stdio, elf, size)');
    // Remove unused network readers/process-table parsing rather than retaining
    // alternate unvalidated entry points in the console binary.
    const unused = text.indexOf('/**\n * Fint the pid');
    const spawn = text.indexOf('pid_t\nelfldr_spawn');
    if (unused < 0 || spawn < unused) throw Error('Loader source changed');
    text = text.slice(0, unused) + text.slice(spawn);
    // PT_TRACE_ME's exec stop is waitable without a racing NOTE_EXEC registration.
    // Only free the shared rfork stack after exec stopped or the child was reaped.
    text = text.replace('  struct kevent evt;\n', '').replace('  int kq;\n', '');
    const initial = text.indexOf('  if((kq=kqueue())');
    const prepared = text.indexOf('  port_timing_end("spawn-process"');
    if (initial < 0 || prepared < initial) throw Error('Review changed child creation');
    text = text.slice(0, initial) + `  if(!(stack=malloc(PAGE_SIZE)))return -1;
  if((pid=rfork_thread(RFPROC|RFCFDG|RFMEM,stack+PAGE_SIZE-8,elfldr_rfork_entry,(void*)name))<0){free(stack);return -1;}
  int initial_status=0;pid_t waited=0;
  for(unsigned attempt=0;attempt<1000;attempt++){
    waited=waitpid(pid,&initial_status,WNOHANG|WUNTRACED);
    if(waited==pid || (waited<0&&errno!=EINTR))break;
    usleep(10000);
  }
  if(waited!=pid || !WIFSTOPPED(initial_status) || WSTOPSIG(initial_status)!=SIGTRAP){
    if(waited==pid&&(WIFEXITED(initial_status)||WIFSIGNALED(initial_status)))free(stack);
    else if(waited==0 || (waited==pid&&WIFSTOPPED(initial_status)) || (waited<0&&errno!=ECHILD)){
      kill(pid,SIGKILL);
      if(waitpid(pid,0,0)==pid)free(stack);
    }
    // Unknown child ownership keeps its shared stack allocated.
    return -1;
  }
  free(stack);

` + text.slice(prepared);
    // An error must not detach a newly created process onto a partially patched
    // payload. The caller owns this child and may terminate it on failure.
    text = text.replace('if(pt_detach(pid, 0)) {\n    LOG_PERROR("pt_detach");',
      'if(pt_detach(pid, error ? SIGKILL : 0)) {\n    LOG_PERROR("pt_detach");');
  }
  if (name === 'elfldr.h') {
    text = text.replace('uint8_t* elf, const char* name);', 'uint8_t* elf, const char* name, size_t size);')
      .replace('uint8_t* elf);', 'uint8_t* elf, size_t size);')
      .replace('#include <unistd.h>', '#include <unistd.h>\n#include <stdint.h>')
      .replace(/^.*elfldr_(?:read|find_pid|sanity_check)\(.*\n/gm, '');
  }
  if (name === 'pt.c') text = text.replace('#include "../include/pt.h"', '#include "pt.h"');
  // Varargs read as uint64_t were previously called with missing/int arguments.
  // A compound-literal wrapper supplies six explicitly widened, zero-filled args.
  if (name === 'pt.h') {
    text = text.replace('long pt_syscall(pid_t pid, int sysno, ...);',
      'long tac_pt_syscall(pid_t pid, int sysno, const uint64_t args[6]);\n#define pt_syscall(pid,num,...) tac_pt_syscall((pid),(num),(const uint64_t[6]){__VA_ARGS__})');
    text = text.replace('long pt_call(pid_t pid, intptr_t addr, ...);',
      'long tac_pt_call(pid_t pid, intptr_t addr, const uint64_t args[6]);\n#define pt_call(pid,addr,...) tac_pt_call((pid),(addr),(const uint64_t[6]){__VA_ARGS__})');
    text = text.replace('long pt_call2(pid_t pid, intptr_t addr, ...);',
      'long tac_pt_call2(pid_t pid, intptr_t addr, const uint64_t args[6]);\n#define pt_call2(pid,addr,...) tac_pt_call2((pid),(addr),(const uint64_t[6]){__VA_ARGS__})');
  }
  if (name === 'pt.c') {
    text = text.replace('pt_syscall(pid_t pid, int sysno, ...)', 'tac_pt_syscall(pid_t pid, int sysno, const uint64_t args[6])')
      .replace('pt_call(pid_t pid, intptr_t addr, ...)', 'tac_pt_call(pid_t pid, intptr_t addr, const uint64_t args[6])')
      .replace('pt_call2(pid_t pid, intptr_t addr, ...)', 'tac_pt_call2(pid_t pid, intptr_t addr, const uint64_t args[6])')
      .replaceAll('  va_list ap;\n', '').replaceAll(/  va_start\(ap, (sysno|addr)\);\n/g, '')
      .replaceAll('  va_end(ap);\n', '');
    let arg = 0;
    text = text.replaceAll('va_arg(ap, uint64_t)', () => `args[${arg++ % 6}]`);
    if (text.includes('va_arg') || arg !== 18) throw Error('Review changed remote-call arguments');
    // Developer trace points remain opt-in; no per-write/syscall spam by default.
    text = text.replace(/^(\s*)(printf\("(?:ptrace memory write|Remote syscall|Syscall gate read|Remote syscall step)[^\n]*|puts\("Remote syscall instruction verified"\);)$/gm,
      '$1#ifdef TACHEN_NATIVE_TRACE\n$1$2\n$1#endif');
  }
  text = text.replace(/[ \t]+$/gm, '').trimEnd() + '\n';
  await fs.writeFile(path.join(root, 'platform/loader', name), text);
  provenance.files.push({ name, from, upstreamSha256: createHash('sha256').update(original).digest('hex') });
}
await fs.writeFile(path.join(root, 'vendor/loader-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log('Imported loader with bounded image mapping and explicit argument adapters.');
