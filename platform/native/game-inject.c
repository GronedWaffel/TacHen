// SPDX-License-Identifier: GPL-3.0-or-later
// Private RX callback code and separate RW control, published under a stopped
// process lease. Based on the credited port's arena/hook strategy, with TacHen
// identity guards and transactional publication. No arbitrary firmware offsets.
#include "game-inject.h"
#include "game-gate.h"
#include "game/gate.h"
#include "publication.h"
#include "pt.h"
#include "process-current.h"
#include <ps5/kernel.h>
#include <sys/mman.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
extern int pt_getlwps(pid_t,int*,size_t);
typedef struct {
  pid_t pid;int attached;int(*identity)(void*);void *context;intptr_t control;
  uint64_t pages[4];int protections[4];unsigned pageCount,count;TacDeckPatch patches[2];
} Target;
static int attach(void *arg){
  Target *t=arg;if(!t->attached){if(pt_attach(t->pid))return -1;t->attached=1;}
  if(!t->identity(t->context)||!tac_process_current(t->pid))return -1;return 0;
}
static int detach(void *arg){Target *t=arg;if(!t->attached)return 0;if(pt_detach(t->pid,0))return -1;t->attached=0;return 0;}
static int threads(void *arg,uint64_t *pcs,size_t capacity){
  Target *t=arg;int ids[2048],n=pt_getlwps(t->pid,ids,capacity);if(n<=0||n>2048)return -1;
  for(int i=0;i<n;i++){struct reg r;if(pt_getregs(ids[i],&r))return -1;pcs[i]=r.r_rip;}return n;
}
static int readbytes(void *arg,uint64_t at,void *bytes,size_t length){return pt_copyout(((Target*)arg)->pid,at,bytes,length);}
static int writebytes(void *arg,uint64_t at,const void *bytes,size_t length){
  Target *t=arg;if(length!=14||!t->attached||!t->identity(t->context)||!tac_process_current(t->pid))return -1;
  unsigned patch=0;while(patch<t->count&&t->patches[patch].address!=at)patch++;if(patch==t->count)return -1;
  int restoring=!memcmp(bytes,t->patches[patch].before,14);
  for(size_t offset=0;offset<length;){
    uint64_t address=at+offset,page=address&~UINT64_C(0x3fff);size_t n=0x4000-(address-page);if(n>length-offset)n=length-offset;
    unsigned index=0;while(index<t->pageCount&&t->pages[index]!=page)index++;
    if(index==t->pageCount){
      if(index==4)return -1;int original=kernel_get_vmem_protection(t->pid,address,n);
      if(original<0||!(original&PROT_EXEC))return -1;t->pages[index]=page;t->protections[index]=original;t->pageCount++;
    }
    int original=t->protections[index],final=restoring?original:(original|PROT_READ)&~PROT_WRITE;
    if(kernel_mprotect(t->pid,address,n,original|PROT_READ|PROT_WRITE))return -1;
    int copied=pt_copyin(t->pid,(const uint8_t*)bytes+offset,address,n);
    int protected=kernel_mprotect(t->pid,address,n,final);if(protected)protected=kernel_mprotect(t->pid,address,n,final);
    if(copied||protected||kernel_get_vmem_protection(t->pid,address,n)!=final)return -1;offset+=n;
  }
  uint8_t observed[14];return pt_copyout(t->pid,at,observed,14)||memcmp(bytes,observed,14)?-1:0;
}
static int set_enabled(void *arg,int enabled){Target *t=arg;uint32_t value=enabled;return pt_copyin(t->pid,&value,t->control+offsetof(TacGameGate,enabled),4);}
static int ack(void *arg){return set_enabled(arg,1);}
static int reject(void *arg){return set_enabled(arg,0);}
static void pause_target(void *arg){(void)arg;usleep(1000);}
static intptr_t resolve(pid_t pid,const char *module,const char *nid){
  uint32_t handle;if(kernel_dynlib_handle(pid,module,&handle))return 0;return kernel_dynlib_resolve(pid,handle,nid);
}
int tac_game_inject(pid_t pid,uint64_t cookie,int(*identity)(void*),void* context,TacGameInjection *out){
  if(!out)return -1;memset(out,0,sizeof *out);out->cookie=cookie;
  Target t={.pid=pid,.identity=identity,.context=context};intptr_t arena=0;int keep=0,result=1;
  const char *message="Game callback preflight failed";
  if(pid<=1||!cookie||!identity||!identity(context))goto done;
  if(attach(&t)){result=-1;message="Target could not be held in a verified stopped state";goto done;}
  uint64_t functions[2]={(uint64_t)resolve(pid,"libScePad.sprx","YndgXqQVV7c"),(uint64_t)resolve(pid,"libScePad.sprx","q1cHNfGycLI")};
  uint64_t loader=(uint64_t)resolve(pid,"libkernel.sprx","wzvqT4UqKX8");
  if(!loader)loader=(uint64_t)resolve(pid,"libkernel_sys.sprx","wzvqT4UqKX8");
  if((!functions[0]&&!functions[1])||!loader){message="Expected game pad or module loader exports are unavailable";goto done;}
  arena=pt_mmap(pid,0,0x8000,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
  if(arena<=0){arena=0;message="Game callback allocation failed";goto done;}
  t.control=arena+0x4000;
  TacGameGate gate={0};gate.magic=TAC_GAME_GATE_MAGIC;gate.cookie=cookie;gate.version=1;gate.bytes=sizeof gate;gate.loadStartModule=loader;
  if(pt_copyin(pid,tac_game_gate_bytes,arena,sizeof tac_game_gate_bytes)||pt_copyin(pid,&gate,t.control,sizeof gate)){message="Game callback staging failed";goto done;}
  for(unsigned lane=0;lane<2;lane++){
    uint64_t target=functions[lane];if(!target||(lane&&target==functions[0]))continue;
    uint8_t before[64];TacGameTrampoline code;uint64_t stub=arena+0x1000+lane*0x800;
    if(target<0x10000||target>UINT64_C(0x7fffffffffff)-64||pt_copyout(pid,target,before,sizeof before)){message="Game input entry is unreadable";goto done;}
    if((before[0]==0xff&&before[1]==0x25)||before[0]==0xe9||before[0]==0xeb){message="Game input entry already has a hook or forwarding jump";goto done;}
    if(tac_game_trampoline(before,sizeof before,target,stub,t.control,cookie,arena,lane,&code)||pt_copyin(pid,code.bytes,stub,code.size)){
      message="Game input instructions could not be relocated";goto done;
    }
    TacDeckPatch *patch=&t.patches[t.count++];patch->address=target;memcpy(patch->before,before,14);
    patch->after[0]=0xff;patch->after[1]=0x25;memcpy(patch->after+6,&stub,8);
  }
  // Real target mprotect splits VM entries and applies PTE permissions. An
  // SDK metadata-only permission edit cannot seal this shared RW allocation.
  if(pt_mprotect(pid,arena,0x4000,PROT_READ|PROT_EXEC)||kernel_get_vmem_protection(pid,arena,0x4000)!=(PROT_READ|PROT_EXEC)||
     kernel_get_vmem_protection(pid,t.control,0x4000)!=(PROT_READ|PROT_WRITE)){
    message="Private game arena could not be sealed as separate RX code and RW data";goto done;
  }
  TacPublicationOps ops={&t,attach,detach,threads,readbytes,writebytes,ack,reject,pause_target};
  result=tac_publish_hooks(t.patches,t.count,&ops);
  if(result==0){keep=1;out->installed=1;message="Game callback published; module slots remain disabled until staged";}
  else if(result<0){keep=1;message="Game hook publication or rollback is uncertain; callback allocation retained";}
  else message="Game hooks were not published; original entries restored";
done:
  if(arena&&!keep){
    if(attach(&t)||pt_munmap(pid,arena,0x8000)){keep=1;result=-1;message="Game callback cleanup is unconfirmed; allocation retained";}
  }
  if(detach(&t)){result=-1;message="Target resume was not confirmed";}
  out->arena=keep?arena:0;out->control=keep?t.control:0;out->uncertain=result<0;
  snprintf(out->message,sizeof out->message,"%s",message);return result;
}
