// SPDX-License-Identifier: GPL-3.0-or-later
// Thread stager adapted from libNineS / John Törnblom and the supported etaHEN
// port. Original publication/checking is isolated from ShellUI's UI thread.
#include "deck-inject.h"
#include "deck-bootstrap.h"
#include "publication.h"
#include "deck-protection.h"
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
typedef struct { pid_t pid;intptr_t address;int(*identity)(void*);void* cookie;uint64_t pages[4];int protections[4];unsigned pageCount;int attached;TacDeckPatch patches[2]; } Publication;
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
 const TacDeckPatch* patch=NULL;
 for(unsigned i=0;i<2;i++)if(c->patches[i].address==a)patch=&c->patches[i];
 if(!patch)return -1;
 for(size_t offset=0;offset<n;){
  uint64_t at=a+offset,page=at&~UINT64_C(0x3fff);size_t length=0x4000-(at-page);if(length>n-offset)length=n-offset;
  unsigned slot=0;while(slot<c->pageCount&&c->pages[slot]!=page)slot++;
  if(slot==c->pageCount){if(slot==4)return -1;int original=kernel_get_vmem_protection(c->pid,at,length);
   if(original<0||!(original&PROT_EXEC))return -1;c->pages[slot]=page;c->protections[slot]=original;c->pageCount++;}
  int protection=c->protections[slot];
  int final=tac_deck_final_protection(protection,patch,a,b,n);if(final<0)return -1;
  if(kernel_mprotect(c->pid,at,length,protection|PROT_READ|PROT_WRITE))return -1;
  // Only PT_IO writes, never the SDK's physical fallback on shared code pages.
  int written=pt_copyin(c->pid,(const unsigned char*)b+offset,at,length),restored=kernel_mprotect(c->pid,at,length,final);
  if(restored)restored=kernel_mprotect(c->pid,at,length,final);
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
 const char* check="attach";TacDeckBoot last={0};int haveStatus=0;
 if(pt_attach_owned(pid,&attached))goto done;
 check="attached process identity";if(!identity||!identity(cookie))goto done;
 check="map deck image";intptr_t entry=tac_elf_map(pid,image,bytes);if(!entry)goto done;
 check="create payload arguments";intptr_t args=tac_payload_args(pid);if(!args)goto done;
 *control=args+TAC_DECK_BOOT_OFFSET;
 TacDeckBoot initial={0};initial.magic=TAC_DECK_BOOT_MAGIC;initial.version=TAC_DECK_BOOT_VERSION;memcpy(initial.credential,credential,33);
 check="initialize bootstrap record";if(pt_copyin(pid,&initial,*control,sizeof initial))goto done;
 check="resolve pthread_create";intptr_t create=kernel_dynlib_dlsym(pid,0x1,"pthread_create");if(!create)create=kernel_dynlib_dlsym(pid,0x2001,"pthread_create");
 if(!create)goto done;
 // SysV pthread_create(&thread,NULL,entry,args), followed by an observed int3.
 const unsigned char stager[]={0x55,0x48,0x89,0xe5,0x48,0x83,0xec,0x10,0x49,0x89,0xf8,
  0x48,0x8d,0x7d,0xf8,0x31,0xf6,0x49,0x8b,0x10,0x49,0x8b,0x48,0x08,0x41,0xff,0x50,0x10,0xcc,0xc9,0xc3};
 uint64_t pointers[3]={(uintptr_t)entry,(uintptr_t)args,(uintptr_t)create};
 check="stage bootstrap thread";code=pt_mmap(pid,0,0x4000,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 params=pt_mmap(pid,0,0x4000,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 if(code<=0||params<=0||pt_copyin(pid,stager,code,sizeof stager)||pt_copyin(pid,pointers,params,sizeof pointers)||
   kernel_mprotect(pid,code,0x4000,PROT_READ|PROT_EXEC))goto done;
 check="create bootstrap thread";if(pt_call2(pid,code,(uintptr_t)params)!=0)goto done;
 // The new thread can already be inside CRT initialization. Detach directly,
 // matching the working libNineS resident path: do not commandeer the host
 // thread for cleanup syscalls while its new sibling is starting. These two
 // small mappings remain owned by this ShellUI generation until process exit.
 // The durable receipt prevents repeated allocations/reinjection this boot.
 check="resume ShellUI";if(pt_detach(pid,0))goto done;attached=0;
 for(unsigned tick=0;tick<180;tick++){
  check="bootstrap process identity";
  if(!identity(cookie))goto done;
  check="read bootstrap record";TacDeckBoot status;if(kernel_proc_copyout(pid,*control,&status,sizeof status))goto done;
  check="bootstrap record identity";if(status.magic!=TAC_DECK_BOOT_MAGIC||status.version!=TAC_DECK_BOOT_VERSION)goto done;
  if(!haveStatus||status.state!=last.state||status.phase!=last.phase||status.error!=last.error||
     (status.renderPhase&&!last.renderPhase)||(status.inputPhase&&!last.inputPhase)){
   fprintf(stderr,"TacHen deck bootstrap: state=%u phase=%u error=%u render=%u input=%u\n",status.state,status.phase,status.error,status.renderPhase,status.inputPhase);fflush(stderr);
  }
  last=status;haveStatus=1;
  if(status.state==3){fprintf(stderr,"TacHen deck bootstrap rejected: check=%s error=%u count=%u\n",tac_deck_prepare_error(status.error),status.error,status.count);goto done;}
  if(status.state==1){
   if(status.count!=2)goto done;
   memcpy(context.patches,status.patches,sizeof context.patches);
   context.address=*control;TacPublicationOps ops={&context,attach,detach,threads,readbytes,writebytes,ack,reject,pause_thread};
   check="publish hook batch";if(tac_publish_hooks(status.patches,status.count,&ops)){
    uint32_t failed=3;kernel_proc_copyin(pid,&failed,*control+offsetof(TacDeckBoot,state),4);goto done;
   }
  }
  if(status.state==4){ok=1;break;}check="bootstrap wait";usleep(100000);
 }
done:
 if(attached){if(pt_detach(pid,0))ok=0;else attached=0;}
 if(detach(&context))ok=0;
 *resumed=!attached&&!context.attached;
 // Filesystem logging only after both trace owners confirmed detach.
 if(*resumed){fprintf(stderr,"TacHen deck injection: check=%s ok=%d observed=%d state=%u phase=%u error=%u render=%u input=%u\n",check,ok,haveStatus,last.state,last.phase,last.error,last.renderPhase,last.inputPhase);fflush(stderr);}
 return ok?0:-1;
}
