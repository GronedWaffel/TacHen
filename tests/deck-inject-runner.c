// SPDX-License-Identifier: GPL-3.0-or-later
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdio.h>
#include <string.h>
#define usleep fake_usleep
#include "../platform/native/deck-inject.c"
static TacDeckBoot record;
static int started,detached,polls,pauses,creates,failCreate,loseIdentity;
static void remote(void){assert(!started||detached);}
int pt_attach_owned(pid_t p,int* a){(void)p;*a=1;return 0;}
int pt_detach(pid_t p,int s){(void)p;(void)s;detached=1;return 0;}
int pt_getregs(int p,struct reg* r){(void)p;r->r_rip=0;return 0;}
int pt_getlwps(pid_t p,int* ids,size_t n){(void)p;(void)n;ids[0]=58;return 1;}
int pt_copyout(pid_t p,uint64_t a,void* b,size_t n){(void)p;(void)a;remote();memset(b,0,n);return 0;}
int pt_copyin(pid_t p,const void* b,uint64_t a,size_t n){(void)p;remote();if(a==0x1800){assert(n==sizeof record);memcpy(&record,b,n);}return 0;}
intptr_t pt_mmap(pid_t p,intptr_t a,size_t n,int prot,int f,int fd,off_t o){(void)p;(void)a;(void)n;(void)prot;(void)f;(void)fd;(void)o;remote();return 0x4000;}
int pt_munmap(pid_t p,intptr_t a,size_t n){(void)p;(void)a;(void)n;remote();return 0;}
long pt_call2(pid_t p,intptr_t a,uintptr_t b){(void)p;(void)a;(void)b;creates++;started=1;return failCreate?-1:0;}
intptr_t tac_elf_map(pid_t p,const uint8_t* d,size_t n){(void)p;(void)d;(void)n;return 0x8000;}
intptr_t tac_payload_args(pid_t p){(void)p;return 0x1000;}
intptr_t kernel_dynlib_dlsym(pid_t p,int h,const char* n){(void)p;(void)h;(void)n;remote();return 0x9000;}
int kernel_get_vmem_protection(pid_t p,uint64_t a,size_t n){(void)p;(void)a;(void)n;return 5;}
int kernel_mprotect(pid_t p,intptr_t a,size_t n,int prot){(void)p;(void)a;(void)n;(void)prot;remote();return 0;}
int kernel_proc_copyout(pid_t p,intptr_t a,void* b,size_t n){(void)p;assert(detached&&a==0x1800&&n==sizeof record);polls++;record.phase=203;if(polls==3)record.state=4;memcpy(b,&record,n);return 0;}
int kernel_proc_copyin(pid_t p,const void* b,intptr_t a,size_t n){(void)p;(void)b;(void)a;(void)n;return 0;}
int tac_publish_hooks(const TacDeckPatch* p,size_t n,const TacPublicationOps* o){(void)p;(void)n;(void)o;assert(0);return -1;}
int fake_usleep(unsigned int n){assert(n==100000);pauses++;return 0;}
static int identify(void* p){(void)p;return !(loseIdentity&&started);}
int main(void){
 for(int mode=0;mode<3;mode++){
  started=detached=polls=pauses=creates=0;failCreate=mode==1;loseIdentity=mode==2;
  intptr_t control=0;int resumed=0;char key[33];memset(key,'a',32);key[32]=0;uint8_t elf=0;
  int r=tac_deck_inject(58,&elf,1,key,&control,identify,NULL,&resumed);
  assert(creates==1&&resumed&&detached&&control==0x1800);
  if(mode==0)assert(r==0&&polls==3&&pauses==2);
  else assert(r==-1&&polls==0&&pauses==0);
 }
 puts("Resident launch detaches without post-spawn remote calls; bounded polling and failure ownership preserved");return 0;
}
