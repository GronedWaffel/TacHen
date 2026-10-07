// SPDX-License-Identifier: GPL-3.0-or-later
// Executes the actual freestanding SysV callback and relocated entry stub on
// the host. Native console APIs are replaced only at the module-load boundary.
#include "game-gate.h"
#include "check.h"
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
typedef void (TAC_GAME_SYSV *Gate)(TacGameGate*,uint64_t,unsigned);
static Gate gate;
static TacGameGate *control;
static int calls,handle=7,startResult;
static int TAC_GAME_SYSV load(const char* path,uint64_t bytes,const void* args,unsigned flags,const void* options,int* result){
  CHECK(!strncmp(path,"/data/tachen/modules/",21));CHECK(bytes==0&&args==NULL&&flags==0&&options==NULL&&result);
  calls++;
  // Module initializers may themselves call pad functions. This reentrant
  // callback must not recursively initialize a second module.
  gate(control,control->cookie,1);*result=startResult;return handle;
}
static void slot(unsigned index,const char* suffix="prx"){
  TacGameModule *s=&control->modules[index];memset(s,0,sizeof *s);s->enabled=1;s->handle=-1;
  strcpy(s->path,"/data/tachen/modules/");memset(s->path+21,'a'+index,64);snprintf(s->path+85,171,".%s",suffix);
}
static void reset(void){
  memset(control,0,sizeof *control);control->magic=TAC_GAME_GATE_MAGIC;control->cookie=0x123456789abcdef;
  control->version=1;control->bytes=sizeof *control;control->enabled=1;control->loadStartModule=(uintptr_t)load;
  calls=0;handle=7;startResult=0;
}
int main(int argc,char **argv){
  if(argc>1&&!strcmp(argv[1],"--fail-check"))CHECK(0);
  CHECK(argc==2);FILE *f=fopen(argv[1],"rb");CHECK(f);unsigned char blob[4096];size_t length=fread(blob,1,sizeof blob,f);CHECK(length>0&&length<sizeof blob);fclose(f);
  unsigned char *code=(unsigned char*)VirtualAlloc(NULL,0x8000,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);CHECK(code);
  memcpy(code,blob,length);DWORD old;CHECK(VirtualProtect(code,0x1000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),code,0x1000));
  gate=(Gate)code;TacGameGate state{};control=&state;reset();slot(0);slot(1,"sprx");
  gate(control,control->cookie,0);CHECK(calls==1&&control->modules[0].state==TAC_MODULE_STARTED&&control->modules[1].state==TAC_MODULE_PENDING);
  CHECK(control->callbacks[0]==1&&control->callbacks[1]==1&&control->busy==0&&control->modules[0].handle==7);
  gate(control,control->cookie,1);CHECK(calls==2&&control->modules[1].state==TAC_MODULE_STARTED);
  gate(control,control->cookie,0);CHECK(calls==2);
  reset();slot(0);control->enabled=0;gate(control,control->cookie,0);CHECK(calls==0&&control->callbacks[0]==1);
  control->enabled=1;control->modules[0].enabled=0;gate(control,control->cookie,0);CHECK(calls==0);
  control->modules[0].enabled=1;gate(control,0,0);gate(control,control->cookie+1,0);gate(control,control->cookie,2);CHECK(calls==0);
  control->version=2;gate(control,control->cookie,0);CHECK(calls==0);
  reset();slot(0);startResult=-1;gate(control,control->cookie,0);CHECK(calls==1&&control->modules[0].state==TAC_MODULE_FAILED&&control->modules[0].handle==7);
  startResult=0;gate(control,control->cookie,0);CHECK(calls==1); // A resident-but-failed initializer is never replayed.
  reset();slot(0);handle=-1;gate(control,control->cookie,0);CHECK(control->modules[0].state==TAC_MODULE_FAILED);
  reset();slot(0);control->modules[0].path[21]='Z';gate(control,control->cookie,0);CHECK(calls==0&&control->modules[0].state==TAC_MODULE_REJECTED);
  reset();slot(0);control->modules[0].path[89]='x';gate(control,control->cookie,0);CHECK(calls==0&&control->modules[0].state==TAC_MODULE_REJECTED);
  reset();slot(0);control->modules[0].path[0]='X';gate(control,control->cookie,0);CHECK(calls==0&&control->modules[0].state==TAC_MODULE_REJECTED);
  // Tail-call a relocated pad-like entry; original integer args must survive
  // the gate's different args and arbitrary initializer call-clobbered state.
  reset();slot(0);
  unsigned char *original=code+0x2000,*stub=code+0x3000;memset(original,0x90,64);
  const unsigned char sum[]={0x8d,0x04,0x37,0x01,0xd0,0xc3};memcpy(original+16,sum,sizeof sum);
  TacGameTrampoline trampoline{};CHECK(!tac_game_trampoline(original,64,(uintptr_t)original,(uintptr_t)stub,
    (uintptr_t)control,control->cookie,(uintptr_t)gate,0,&trampoline));
  CHECK(trampoline.stolen>=14&&trampoline.size<=512);memcpy(stub,trampoline.bytes,trampoline.size);
  CHECK(VirtualProtect(original,0x2000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),original,0x2000));
  typedef int (TAC_GAME_SYSV *Pad)(int,int,int);
  CHECK(((Pad)stub)(17,29,41)==87);CHECK(calls==1&&control->modules[0].state==TAC_MODULE_STARTED);
  CHECK(((Pad)stub)(-10,6,7)==3);CHECK(calls==1);
  CHECK(tac_game_trampoline(original,64,(uintptr_t)original,(uintptr_t)stub,(uintptr_t)control,0,(uintptr_t)gate,0,&trampoline));
  CHECK(VirtualFree(code,0,MEM_RELEASE));puts("Actual game callback binary and relocated SysV entry passed");return 0;
}
