// SPDX-License-Identifier: GPL-3.0-or-later
#include <stdio.h>
#include <string.h>
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include "../platform/deck/resident-init.c"
static unsigned char storage[4096];static int outcome;
static TacDeckBoot* record(void){return (TacDeckBoot*)(storage+TAC_DECK_BOOT_OFFSET);}
int __real___crt_syscall_init(payload_args_t* args){assert((void*)args==storage);assert(!trace||record()->phase==201);return outcome;}
int __real___kernel_init(payload_args_t* args){assert((void*)args==storage);assert(!trace||record()->phase==203);return outcome;}
int __real___rtld_init(void){assert(!trace||record()->phase==206);return outcome;}
int main(void){
 for(int attempt=0;attempt<2;attempt++){
  memset(storage,0,sizeof storage);record()->magic=TAC_DECK_BOOT_MAGIC;record()->version=TAC_DECK_BOOT_VERSION;outcome=attempt?-7:0;
  assert(__wrap___crt_syscall_init((void*)storage)==outcome);assert(record()->phase==202);
  assert(__wrap___kernel_init((void*)storage)==outcome);assert(record()->phase==204);
  assert(__wrap___patch_init()==0);assert(record()->phase==205);
  assert(__wrap___rtld_init()==outcome);assert(record()->phase==207);
  assert(record()->state==0&&record()->error==0);
 }
 memset(storage,0,sizeof storage);outcome=0;
 assert(__wrap___crt_syscall_init((void*)storage)==0);
 assert(__wrap___kernel_init((void*)storage)==0);assert(__wrap___patch_init()==0);assert(__wrap___rtld_init()==0);
 for(unsigned i=0;i<sizeof storage;i++)assert(storage[i]==0);
 puts("CRT markers preserve initialization results and reject unrelated records");return 0;
}
