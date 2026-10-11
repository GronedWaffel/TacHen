// SPDX-License-Identifier: GPL-3.0-or-later
#include <stdio.h>
#include <string.h>
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include "../platform/deck/resident-init.c"
static unsigned char storage[4096];static int outcome;
#ifdef TACHEN_BOOTSTRAP_SCAN
uintptr_t KERNEL_ADDRESS_DATA_BASE=0xffffffff80000000ULL,KERNEL_ADDRESS_ALLPROC=0xffffffff82885e00ULL,KERNEL_ADDRESS_DMAP_BASE=0xffff800000000000ULL,KERNEL_ADDRESS_PRISON0=0xffff800012345678ULL,KERNEL_ADDRESS_IOMMU_SOFTC=0;
unsigned int kernel_get_fw_version(void){return 0x12400009;}
#endif
static TacDeckBoot* record(void){return (TacDeckBoot*)(storage+TAC_DECK_BOOT_OFFSET);}
int __real___crt_syscall_init(payload_args_t* args){assert((void*)args==storage);assert(!trace||record()->phase==201);return outcome;}
int __real___kernel_init(payload_args_t* args){assert((void*)args==storage);assert(!trace||record()->phase==203);return outcome;}
int __real_kernel_copyout(uintptr_t a,void* b,size_t n){assert(a==0xffff800012345678ULL&&n==8&&b);assert(!trace||record()->reservedTrace==1);
#ifdef TACHEN_BOOTSTRAP_SCAN
 if(trace){TacDeckKernelRead* r=&record()->kernelReads[(record()->kernelReadCount-1)%TAC_DECK_READ_HISTORY];assert(r->sequence==record()->kernelReadCount&&!r->complete&&r->result==INT32_MIN&&r->address==a&&r->length==n);}
#endif
 return outcome;}
int __real___rtld_init(void){assert(!trace||record()->phase==206);return outcome;}
int main(void){
 for(int attempt=0;attempt<2;attempt++){
  memset(storage,0,sizeof storage);record()->magic=TAC_DECK_BOOT_MAGIC;record()->version=TAC_DECK_BOOT_VERSION;outcome=attempt?-7:0;
  assert(__wrap___crt_syscall_init((void*)storage)==outcome);assert(record()->phase==202);
  assert(__wrap___kernel_init((void*)storage)==outcome);assert(record()->phase==204);
  record()->phase=203;uint64_t data=0;
  assert(__wrap_kernel_copyout(0xffff800012345678ULL,&data,8)==outcome);
  assert(record()->kernelReadCount==1&&record()->reservedTrace==2&&record()->kernelReadAddress==0xffff800012345678ULL&&record()->kernelReadLength==8&&record()->kernelReadResult==outcome);
#ifdef TACHEN_BOOTSTRAP_SCAN
  assert(record()->bootstrapFirmware==0x12400009&&record()->kernelInitResult==outcome&&record()->kernelDmap==KERNEL_ADDRESS_DMAP_BASE);
  for(unsigned i=0;i<40;i++)assert(__wrap_kernel_copyout(0xffff800012345678ULL,&data,8)==outcome);
  assert(record()->kernelReadCount==41);
  for(unsigned seq=26;seq<=41;seq++){TacDeckKernelRead* r=&record()->kernelReads[(seq-1)%TAC_DECK_READ_HISTORY];assert(r->sequence==seq&&r->complete&&r->result==outcome);}
#else
  assert(record()->bootstrapFirmware==0&&record()->kernelReads[0].sequence==0);
#endif
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
