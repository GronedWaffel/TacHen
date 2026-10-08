// SPDX-License-Identifier: GPL-3.0-or-later
// Thread stager adapted from libNineS / John Törnblom and the supported etaHEN
// port. Original publication/checking is isolated from ShellUI's UI thread.
#include "deck-inject.h"
#include "deck-bootstrap.h"
#include "publication.h"
#include "pt.h"
#include <ps5/kernel.h>
#include <sys/mman.h>
#include <stddef.h>
#include <string.h>
#include <unistd.h>
#include <stdio.h>
#include <errno.h>
extern intptr_t tac_elf_map(pid_t,const uint8_t*,size_t);
extern intptr_t tac_payload_args(pid_t);
extern int pt_getlwps(pid_t,int*,size_t);
typedef struct { pid_t pid;intptr_t address;int(*identity)(void*);void* cookie;uint64_t pages[4];int protections[4];unsigned pageCount;int attached; } Publication;
static int attach(void* p){Publication* c=p;
 if(!c->identity(c->cookie)||(!c->attached&&pt_attach_owned(c->pid,&c->attached)))return -1;
 return c->identity(c->cookie)?0:-1;}
static int detach(void* p){Publication* c=p;if(!c->attached)return 0;
 if(pt_detach(c->pid,0))return -1;c->attached=0;return 0;}
static int threads(void* p,uint64_t* pcs,size_t capacity){
 Publication* c=p;int ids[2048];int n=pt_getlwps(c->pid,ids,capacity);if(n<=0)return -1;
 for(int i=0;i<n;i++){struct reg r;if(pt_getregs(ids[i],&r))return -1;pcs[i]=r.r_rip;}return n;
}
static int readbytes(void* p,uint64_t a,void* b,size_t n){return pt_copyout(((Publication*)p)->pid,a,b,n);}
static int writebytes(void* p,uint64_t a,const void* b,size_t n){
 Publication* c=p;unsigned char check[14];if(n!=14)return -1;
 for(size_t offset=0;offset<n;){
  uint64_t at=a+offset,page=at&~UINT64_C(0x3fff);size_t length=0x4000-(at-page);if(length>n-offset)length=n-offset;
  unsigned slot=0;while(slot<c->pageCount&&c->pages[slot]!=page)slot++;
  if(slot==c->pageCount){if(slot==4)return -1;int original=kernel_get_vmem_protection(c->pid,at,length);
   if(original<0||!(original&PROT_EXEC))return -1;c->pages[slot]=page;c->protections[slot]=original;c->pageCount++;}
  int protection=c->protections[slot];
  if(kernel_mprotect(c->pid,at,length,protection|PROT_READ|PROT_WRITE))return -1;
  // Only PT_IO writes, never the SDK's physical fallback on shared code pages.
  int written=pt_copyin(c->pid,(const unsigned char*)b+offset,at,length),restored=kernel_mprotect(c->pid,at,length,protection);
  if(restored)restored=kernel_mprotect(c->pid,at,length,protection);
  if(written||restored)return -1;offset+=length;
 }
 if(pt_copyout(c->pid,a,check,n)||memcmp(check,b,n))return -1;return 0;
}
static int ack(void* p){Publication* c=p;uint32_t state=2;return pt_copyin(c->pid,&state,c->address+offsetof(TacDeckBoot,state),4);}
static int reject(void* p){Publication* c=p;uint32_t state=3;return pt_copyin(c->pid,&state,c->address+offsetof(TacDeckBoot,state),4);}
static void pause_thread(void* p){(void)p;usleep(1000);}
int tac_deck_inject(pid_t pid,const uint8_t* image,size_t bytes,const char credential[33],intptr_t* control,int(*identity)(void*),void* cookie,int* resumed){
 *control=0;*resumed=1;int attached=0,ok=0;intptr_t code=0,params=0;
 Publication context={.pid=pid,.identity=identity,.cookie=cookie};
 if(pt_attach_owned(pid,&attached))goto done;
 if(!identity||!identity(cookie))goto done;
 intptr_t entry=tac_elf_map(pid,image,bytes);if(!entry)goto done;
 intptr_t args=tac_payload_args(pid);if(!args)goto done;
 *control=args+TAC_DECK_BOOT_OFFSET;
 TacDeckBoot initial={0};initial.magic=TAC_DECK_BOOT_MAGIC;initial.version=1;memcpy(initial.credential,credential,33);
 if(pt_copyin(pid,&initial,*control,sizeof initial))goto done;
 intptr_t create=kernel_dynlib_dlsym(pid,0x1,"pthread_create");if(!create)create=kernel_dynlib_dlsym(pid,0x2001,"pthread_create");
 if(!create)goto done;
 // SysV pthread_create(&thread,NULL,entry,args), followed by an observed int3.
 const unsigned char stager[]={0x55,0x48,0x89,0xe5,0x48,0x83,0xec,0x10,0x49,0x89,0xf8,
  0x48,0x8d,0x7d,0xf8,0x31,0xf6,0x49,0x8b,0x10,0x49,0x8b,0x48,0x08,0x41,0xff,0x50,0x10,0xcc,0xc9,0xc3};
 uint64_t pointers[3]={(uintptr_t)entry,(uintptr_t)args,(uintptr_t)create};
 code=pt_mmap(pid,0,0x4000,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 params=pt_mmap(pid,0,0x4000,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 if(code<=0||params<=0||pt_copyin(pid,stager,code,sizeof stager)||pt_copyin(pid,pointers,params,sizeof pointers)||
   kernel_mprotect(pid,code,0x4000,PROT_READ|PROT_EXEC))goto done;
 if(pt_call2(pid,code,(uintptr_t)params)!=0)goto done;
 // The stager returned and the new thread only retains args. Its entry, args
 // and eventual trampolines must stay mapped for the resident deck's lifetime.
 pt_munmap(pid,code,0x4000);pt_munmap(pid,params,0x4000);
 if(pt_detach(pid,0))goto done;attached=0;
 for(unsigned tick=0;tick<180;tick++){
  if(!identity(cookie))goto done;
  TacDeckBoot status;if(kernel_proc_copyout(pid,*control,&status,sizeof status))goto done;
  if(status.magic!=TAC_DECK_BOOT_MAGIC||status.version!=1)goto done;
  if(status.state==3){fprintf(stderr,"TacHen deck bootstrap rejected: check=%s error=%u count=%u\n",tac_deck_prepare_error(status.error),status.error,status.count);goto done;}
  if(status.state==1){
   if(status.count!=2)goto done;
   context.address=*control;TacPublicationOps ops={&context,attach,detach,threads,readbytes,writebytes,ack,reject,pause_thread};
   if(tac_publish_hooks(status.patches,status.count,&ops)){
    uint32_t failed=3;kernel_proc_copyin(pid,&failed,*control+offsetof(TacDeckBoot,state),4);goto done;
   }
  }
  if(status.state==4){ok=1;break;}usleep(100000);
 }
done:
 if(attached){if(pt_detach(pid,0))ok=0;else attached=0;}
 if(detach(&context))ok=0;
 *resumed=!attached&&!context.attached;
 return ok?0:-1;
}
