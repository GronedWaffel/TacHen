// SPDX-License-Identifier: GPL-3.0-or-later
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdio.h>
#include <string.h>
#ifdef TACHEN_BOOTSTRAP_TRACE
#include <signal.h>
#ifndef SIGTRAP
#define SIGTRAP 5
#endif
#ifndef SIGSTOP
#define SIGSTOP 17
#endif
int fake_kill(int,int);
#define kill fake_kill
#endif
#define usleep fake_usleep
#include "../platform/native/deck-inject.c"
static TacDeckBoot record;
static int started,detached,polls,pauses,creates,failCreate,loseIdentity,isolated,failIsolation,badProtection,mappings;
static int publishMode,publishes;
#ifdef TACHEN_BOOTSTRAP_TRACE
static int mode,delivered,waits,stops;
int fake_kill(int pid,int sig){assert(pid==58&&sig==SIGSTOP);stops++;return 0;}
int pt_continue(pid_t pid,int sig){assert(pid==58&&!sig);return 0;}
int pt_wait_signal(pid_t pid,unsigned ms,int* sig){assert(pid==58);waits++;assert(ms==(waits==1?8000:1000));if(mode>=3&&waits==1){errno=ETIMEDOUT;return -1;}*sig=mode==3?SIGSTOP:mode==1||mode==4?SIGSEGV:SIGTRAP;return 0;}
int pt_stop_info(pid_t pid,int* tid,int* sig,int* code,uintptr_t* fault){assert(pid==58);*tid=81;*sig=mode==3?SIGSTOP:mode==1||mode==4?SIGSEGV:SIGTRAP;*code=1;*fault=0;return 0;}
#endif
static void remote(void){assert(!started||detached);}
int pt_attach_owned(pid_t p,int* a){(void)p;*a=1;return 0;}
int pt_detach(pid_t p,int s){(void)p;(void)s;detached=1;
#ifdef TACHEN_BOOTSTRAP_TRACE
delivered=s;
#endif
return 0;}
int pt_getregs(int p,struct reg* r){(void)p;r->r_rip=0;
#ifdef TACHEN_BOOTSTRAP_TRACE
r->r_rip=0x9000;
#endif
return 0;}
int pt_getlwps(pid_t p,int* ids,size_t n){(void)p;(void)n;ids[0]=58;return 1;}
int pt_copyout(pid_t p,uint64_t a,void* b,size_t n){(void)p;(void)a;remote();memset(b,0,n);
#ifdef TACHEN_BOOTSTRAP_TRACE
if(a==0x1800){assert(n==sizeof record);memcpy(b,&record,n);return 0;}
return -1; // Do not capture fake instructions or stack to the filesystem.
#else
return 0;
#endif
}
int pt_copyin(pid_t p,const void* b,uint64_t a,size_t n){(void)p;remote();if(a==0x1800){assert(n==sizeof record);memcpy(&record,b,n);}return 0;}
intptr_t pt_mmap(pid_t p,intptr_t a,size_t n,int prot,int f,int fd,off_t o){(void)p;(void)a;(void)n;(void)prot;(void)f;(void)fd;(void)o;remote();return ++mappings==1?0x4000:0x8000;}
int pt_munmap(pid_t p,intptr_t a,size_t n){(void)p;(void)a;(void)n;remote();return 0;}
int tac_deck_launch(pid_t p,intptr_t a,intptr_t end,uintptr_t b,TacDeckLaunch* report){(void)p;(void)b;(void)report;assert(end==a+29);creates++;started=1;return failCreate?-1:0;}
intptr_t tac_elf_map(pid_t p,const uint8_t* d,size_t n){(void)p;(void)d;(void)n;return 0x8000;}
intptr_t tac_payload_args(pid_t p){(void)p;return 0x1000;}
intptr_t kernel_dynlib_dlsym(pid_t p,int h,const char* n){(void)p;(void)h;(void)n;remote();return 0x9000;}
int pt_mprotect(pid_t p,intptr_t a,size_t n,int prot){(void)p;assert(a==0x4000&&n==0x4000&&prot==PROT_READ);remote();if(failIsolation)return -1;isolated=1;return 0;}
int kernel_get_vmem_protection(pid_t p,uint64_t a,size_t n){(void)p;(void)n;return a==0x4000?5:badProtection?5:3;}
int kernel_mprotect(pid_t p,intptr_t a,size_t n,int prot){(void)p;assert(isolated&&a==0x4000&&n==0x4000&&prot==(PROT_READ|PROT_EXEC));remote();return 0;}
int kernel_proc_copyout(pid_t p,intptr_t a,void* b,size_t n){(void)p;assert(detached&&a==0x1800&&n==sizeof record);polls++;record.phase=203;if(publishMode&&polls==1){record.state=1;record.count=TAC_DECK_MAX_PATCHES;}if(polls==3)record.state=4;memcpy(b,&record,n);return 0;}
int kernel_proc_copyin(pid_t p,const void* b,intptr_t a,size_t n){(void)p;(void)b;(void)a;(void)n;return 0;}
int tac_publish_hooks(const TacDeckPatch* p,size_t n,const TacPublicationOps* o){(void)p;assert(publishMode);publishes++;Publication*c=o->context;
 assert(n==(publishes==1?TAC_DECK_MAX_PATCHES:2)&&c->patchCount==n&&c->allowFallback==(publishes==1));
 if(publishMode==2&&publishes==1)return 1;if(publishMode==3)return -1;record.count=(uint32_t)n;record.state=2;return 0;}
int fake_usleep(unsigned int n){assert(n==100000);pauses++;return 0;}
static int identify(void* p){(void)p;return !(loseIdentity&&started);}
int main(void){
#ifdef TACHEN_BOOTSTRAP_TRACE
 for(mode=0;mode<5;mode++){
  detached=waits=stops=0;delivered=-1;memset(&record,0,sizeof record);
  record.magic=TAC_DECK_BOOT_MAGIC;record.version=TAC_DECK_BOOT_VERSION;
  record.phase=204;record.reservedTrace=3;record.kernelReadAddress=0x9000;
  if(mode==2)record.version=0;
  int attached=1;int result=trace_bootstrap(58,0x1800,&attached);
  assert(result==(mode==0?0:-1));assert(!attached&&detached);
  assert(delivered==(mode==0||mode==3?0:mode==2?SIGTRAP:SIGSEGV));
  assert(stops==(mode>=3));
 }
 puts("Diagnostic tracing accepts only its verified checkpoint and preserves real and timeout-racing signals");return 0;
#endif
 for(int mode=0;mode<5;mode++){
  started=detached=polls=pauses=creates=isolated=mappings=0;failCreate=mode==1;loseIdentity=mode==2;failIsolation=mode==3;badProtection=mode==4;
  intptr_t control=0;int resumed=0;char key[33];memset(key,'a',32);key[32]=0;uint8_t elf=0;
  int r=tac_deck_inject(58,&elf,1,key,&control,identify,NULL,&resumed);
  assert(creates==(mode<3)&&resumed&&detached&&control==0x1800);
  if(mode==0)assert(r==0&&polls==3&&pauses==2);
  else assert(r==-1&&polls==0&&pauses==0);
 }
 for(int mode=1;mode<=3;mode++){
  started=detached=polls=pauses=creates=isolated=mappings=publishes=0;failCreate=loseIdentity=failIsolation=badProtection=0;publishMode=mode;
  intptr_t control=0;int resumed=0;char key[33];memset(key,'a',32);key[32]=0;uint8_t elf=0;
  int r=tac_deck_inject(58,&elf,1,key,&control,identify,NULL,&resumed);
  assert(resumed&&publishes==(mode==2?2:1));assert(r==(mode==3?-1:0));
  if(mode<3)assert(record.count==(mode==2?2:TAC_DECK_MAX_PATCHES));
 }
 puts("Resident launch detaches without post-spawn remote calls; bounded polling and failure ownership preserved");return 0;
}
