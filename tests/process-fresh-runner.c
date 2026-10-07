// SPDX-License-Identifier: GPL-3.0-or-later
#include "check.h"
#include <ps5/kernel.h>
#include <string.h>
intptr_t __wrap_kernel_get_proc(int pid);
const intptr_t KERNEL_ADDRESS_ALLPROC=(intptr_t)UINT64_C(0xffff800000001000);
const int64_t KERNEL_OFFSET_PROC_P_PID=0xbc;
static const uint64_t one=UINT64_C(0xffff800000002000),two=UINT64_C(0xffff800000003000);
static uint64_t head,next1,next2;
static int pid1,pid2,reads,failAt,currentPid,syscalls;
long __crt_syscall(long number,...){CHECK(number==20);syscalls++;return currentPid;}
int32_t kernel_copyout(intptr_t at,void *out,size_t length){
  if(++reads==failAt)return -1;uint64_t a=(uint64_t)at;
  if(at==KERNEL_ADDRESS_ALLPROC&&length==8){memcpy(out,&head,8);return 0;}
  if(a==one&&length==8){memcpy(out,&next1,8);return 0;}
  if(a==two&&length==8){memcpy(out,&next2,8);return 0;}
  if(a==one+0xbc&&length==4){memcpy(out,&pid1,4);return 0;}
  if(a==two+0xbc&&length==4){memcpy(out,&pid2,4);return 0;}
  return -1;
}
static void reset(void){head=one;next1=two;next2=0;pid1=77;pid2=88;reads=failAt=syscalls=0;currentPid=77;}
int main(int argc,char **argv){
  (void)argv;if(argc>1)CHECK(0);
  reset();CHECK((uint64_t)__wrap_kernel_get_proc(88)==two);CHECK(syscalls==0);
  // Same PID, different kernel object. Repeated calls must not retain the first.
  pid1=88;pid2=99;CHECK((uint64_t)__wrap_kernel_get_proc(88)==one);
  pid1=77;CHECK(__wrap_kernel_get_proc(88)==0);
  reset();CHECK((uint64_t)__wrap_kernel_get_proc(0)==one);CHECK(syscalls==1);
  reset();currentPid=88;CHECK((uint64_t)__wrap_kernel_get_proc(-1)==two);CHECK(syscalls==1);
  reset();currentPid=-1;CHECK(!__wrap_kernel_get_proc(0));CHECK(reads==0);
  reset();pid1=1;CHECK((uint64_t)__wrap_kernel_get_proc(1)==one); // CRT callers may need init.
  reset();head=0;CHECK(!__wrap_kernel_get_proc(88));CHECK(reads==1);
  reset();head=0x1000;CHECK(!__wrap_kernel_get_proc(88));CHECK(reads==1);
  reset();head=one+1;CHECK(!__wrap_kernel_get_proc(88));CHECK(reads==1);
  for(int at=1;at<=4;at++){reset();failAt=at;CHECK(!__wrap_kernel_get_proc(88));CHECK(reads==at);}
  reset();next1=one;CHECK(!__wrap_kernel_get_proc(88));CHECK(reads==3);
  reset();next2=one;pid2=99;CHECK(!__wrap_kernel_get_proc(88));CHECK(reads==8193);
  puts("Fresh SDK lookup: PID reuse, CRT fallback, read failures and bounded cycles passed");return 0;
}
