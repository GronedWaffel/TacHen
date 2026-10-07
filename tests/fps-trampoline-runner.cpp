// SPDX-License-Identifier: GPL-3.0-or-later
#include "fps-inject.h"
#include "check.h"
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
using Submit=uint64_t(__attribute__((sysv_abi)) *)(uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t);
static Submit submit;
static DWORD WINAPI exercise(void*){for(unsigned i=0;i<20000;i++)CHECK(submit(1,2,3,4,5,6,7,8,9,10)==55);return 0;}
int main(int argc,char **argv){
 if(argc>1&&!strcmp(argv[1],"--fail-check"))CHECK(0);
 unsigned char *code=(unsigned char*)VirtualAlloc(NULL,0x8000,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);CHECK(code);
 unsigned char *original=code,*stub=code+0x1000;TacFpsGate *gate=(TacFpsGate*)(code+0x4000);gate->magic=TAC_FPS_MAGIC;gate->cookie=123;
 memset(original,0x90,64);
 const unsigned char sum[]={0x8d,0x04,0x37,0x01,0xd0,0x01,0xc8,0x44,0x01,0xc0,0x44,0x01,0xc8,
  0x03,0x44,0x24,8,0x03,0x44,0x24,16,0x03,0x44,0x24,24,0x03,0x44,0x24,32,0xc3};
 memcpy(original+16,sum,sizeof sum);TacFpsTrampoline built{};
 CHECK(!tac_fps_trampoline(original,64,(uintptr_t)original,(uintptr_t)stub,(uintptr_t)gate,&built));CHECK(built.stolen>=14&&built.size<=320);
 memcpy(stub,built.bytes,built.size);DWORD old;CHECK(VirtualProtect(code,0x4000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),code,0x4000));
 submit=(Submit)stub;CHECK(submit(1,2,3,4,5,6,7,8,9,10)==55&&gate->frames==0);
 gate->enabled=1;CHECK(submit(10,9,8,7,6,5,4,3,2,1)==55&&gate->frames==1);
 HANDLE threads[2]={CreateThread(NULL,0,exercise,NULL,0,NULL),CreateThread(NULL,0,exercise,NULL,0,NULL)};CHECK(threads[0]&&threads[1]);
 CHECK(WaitForMultipleObjects(2,threads,TRUE,10000)==WAIT_OBJECT_0);for(auto h:threads){DWORD rc;CHECK(GetExitCodeThread(h,&rc)&&rc==0);CloseHandle(h);}CHECK(gate->frames==40001);
 gate->enabled=2;CHECK(submit(1,2,3,4,5,6,7,8,9,10)==55&&gate->frames==40001);
 // The entry must preserve flags even though its enable check and counter
 // update set them. A SysV wrapper establishes CF and ZF before the call.
 CHECK(VirtualProtect(code,0x4000,PAGE_READWRITE,&old));memset(original,0x90,64);original[16]=0x9c;original[17]=0x58;original[18]=0xc3;
 CHECK(!tac_fps_trampoline(original,64,(uintptr_t)original,(uintptr_t)stub,(uintptr_t)gate,&built));memcpy(stub,built.bytes,built.size);
 unsigned char *wrapper=code+0x2000;const unsigned char call[]={0x48,0x83,0xec,8,0x31,0xc0,0xf9,0x48,0xb8,0,0,0,0,0,0,0,0,0xff,0xd0,0x48,0x83,0xc4,8,0xc3};
 memcpy(wrapper,call,sizeof call);uint64_t address=(uintptr_t)stub;memcpy(wrapper+9,&address,8);
 CHECK(VirtualProtect(code,0x4000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),code,0x4000));
 using Flags=uint64_t(__attribute__((sysv_abi)) *)();gate->enabled=1;CHECK((((Flags)wrapper)()&0x41)==0x41);gate->enabled=0;CHECK((((Flags)wrapper)()&0x41)==0x41);
 CHECK(tac_fps_trampoline(original,64,(uintptr_t)original,(uintptr_t)stub,(uintptr_t)gate+1,&built));
 CHECK(tac_fps_trampoline(original,64,(uintptr_t)original,0x10000,UINT64_C(0x10000000000),&built));
 CHECK(VirtualFree(code,0,MEM_RELEASE));puts("Actual GNM counter trampoline: ten SysV arguments, flags, enable control and atomic multi-thread counting passed");return 0;
}
