// SPDX-License-Identifier: GPL-3.0-or-later
#include <stdarg.h>
#include <stdio.h>
#include "../platform/deck/resident-memory.c"
#define CHECK(x) do{if(!(x)){fprintf(stderr,"line %d: %s\n",__LINE__,#x);return 1;}}while(0)
static intptr_t mapped=INT64_C(0x248008000),args[6],unmapped;
static int mapCalls,unmapCalls,protectCalls,failMap,failProtect,protPid,protFlags;
static intptr_t protAddress;static size_t protLength;
intptr_t __crt_syscall(intptr_t number,...){
 va_list ap;va_start(ap,number);intptr_t result=-1;
 if(number==SYS_mmap){mapCalls++;for(int i=0;i<6;i++)args[i]=va_arg(ap,intptr_t);result=failMap?-1:mapped;}
 if(number==SYS_getpid)result=58;
 if(number==SYS_munmap){unmapCalls++;unmapped=va_arg(ap,intptr_t);result=0;}
 va_end(ap);return result;
}
int kernel_mprotect(pid_t pid,intptr_t address,size_t length,int protection){
 protectCalls++;protPid=pid;protAddress=address;protLength=length;protFlags=protection;return failProtect?-1:0;
}
int main(void){
 void* p=__wrap_mmap(NULL,0x4000,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 CHECK((intptr_t)p==mapped&&mapCalls==1&&!protectCalls);
 CHECK(args[0]==0&&args[1]==0x4000&&args[2]==3&&args[3]==0x1002&&args[4]==-1&&args[5]==0);
 CHECK(__wrap_mprotect(p,0x4000,PROT_READ|PROT_EXEC)==0);
 CHECK(protPid==58&&protAddress==mapped&&protLength==0x4000&&protFlags==5);
 failMap=1;CHECK(__wrap_mmap(NULL,0x4000,7,0x1002,-1,0)==MAP_FAILED);CHECK(protectCalls==1&&!unmapCalls);failMap=0;
 p=__wrap_mmap(NULL,0x4000,7,0x1002,-1,0);CHECK((intptr_t)p==mapped&&args[2]==3&&protFlags==7);
 failProtect=1;CHECK(__wrap_mmap(NULL,0x4000,5,0x1002,-1,0)==MAP_FAILED);
 CHECK(unmapCalls==1&&unmapped==mapped&&errno==EPERM);
 CHECK(__wrap_munmap((void*)mapped,0x4000)==0&&unmapCalls==2&&unmapped==mapped);
 puts("Resident memory gateway preserves 64-bit pointers and unwinds failed executable mapping");return 0;
}
