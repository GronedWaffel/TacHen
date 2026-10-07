// SPDX-License-Identifier: GPL-3.0-or-later
#include "process-current.h"
#include "check.h"
#include <ps5/kernel.h>
#include <string.h>
const intptr_t KERNEL_ADDRESS_ALLPROC=(intptr_t)UINT64_C(0xffff800000001000);
const int64_t KERNEL_OFFSET_PROC_P_PID=0xbc;
static const uint64_t one=UINT64_C(0xffff800000002000),two=UINT64_C(0xffff800000003000);
static uint64_t head,next1,next2,cached;
static int pid1,pid2,reads,cacheCalls,fail;
int32_t kernel_copyout(intptr_t at,void *out,size_t length){
  reads++;if(fail)return -1;uint64_t a=(uint64_t)at;
  if(at==KERNEL_ADDRESS_ALLPROC&&length==8){memcpy(out,&head,8);return 0;}
  if(a==one&&length==8){memcpy(out,&next1,8);return 0;}
  if(a==two&&length==8){memcpy(out,&next2,8);return 0;}
  if(a==one+0xbc&&length==4){memcpy(out,&pid1,4);return 0;}
  if(a==two+0xbc&&length==4){memcpy(out,&pid2,4);return 0;}
  return -1;
}
intptr_t kernel_get_proc(int pid){CHECK(pid==88);cacheCalls++;return (intptr_t)cached;}
static void reset(void){head=one;next1=two;next2=0;cached=two;pid1=77;pid2=88;reads=cacheCalls=fail=0;}
int main(int argc,char **argv){
  (void)argv;if(argc>1)CHECK(0);
  reset();CHECK(tac_process_current(88));CHECK(cacheCalls==1);
  reset();cached=one;CHECK(!tac_process_current(88));CHECK(cacheCalls==1); // PID cache points to an old process.
  reset();CHECK(!tac_process_current(89));CHECK(cacheCalls==0);
  reset();head=0x1000;CHECK(!tac_process_current(88));CHECK(reads==1&&cacheCalls==0);
  reset();fail=1;CHECK(!tac_process_current(88));CHECK(reads==1&&cacheCalls==0);
  reset();next1=one;CHECK(!tac_process_current(88));CHECK(reads<5);
  reset();next2=one;pid2=99;CHECK(!tac_process_current(88));CHECK(reads<=8193&&cacheCalls==0);
  reset();CHECK(!tac_process_current(1));CHECK(reads==0);
  puts("Fresh process identity and stale SDK cache checks passed");return 0;
}
