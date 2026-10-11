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
static int calls,handle=7,startResult,createResult,detachResult,activationResult,activationCalls,symbolMode;
static unsigned created;
static DWORD inputThread,loaderThread;
static HANDLE finished,entered,releaseLoad;
static int blockLoad,padCalls;
static TacGameThreadEntry workerEntry;
static void *workerArg;
static DWORD WINAPI worker(void*){workerEntry(workerArg);SetEvent(finished);return 0;}
static int TAC_GAME_SYSV create(uintptr_t *out,const void *attr,TacGameThreadEntry entry,void *arg,const char *name){
  CHECK(!attr&&entry&&arg==control&&!strcmp(name,"TacHen module"));
  if(createResult)return createResult;
  workerEntry=entry;workerArg=arg;ResetEvent(finished);created++;
  HANDLE thread=CreateThread(NULL,0,worker,NULL,0,NULL);CHECK(thread);*out=(uintptr_t)thread;return 0;
}
static int TAC_GAME_SYSV detach(uintptr_t thread){CHECK(CloseHandle((HANDLE)thread));return detachResult;}
static int TAC_GAME_SYSV activate(int argc,const char **argv){CHECK(!argc&&!argv);activationCalls++;return activationResult;}
static int TAC_GAME_SYSV symbol(int h,const char *name,void **out){
  CHECK(h==handle);*out=NULL;
  if(symbolMode==1||(symbolMode==2&&!strcmp(name,"plugin_load"))){*out=(void*)activate;return 0;}
  return -1;
}
static int TAC_GAME_SYSV pad_chain(int a,int b,int c){CHECK(created==0);padCalls++;return a+b+c;}
static void drain(){CHECK(WaitForSingleObject(finished,3000)==WAIT_OBJECT_0);}
static void run(TacGameGate *c,uint64_t cookie,unsigned lane){unsigned before=created;gate(c,cookie,lane);if(created!=before)drain();}
static int TAC_GAME_SYSV load(const char* path,uint64_t bytes,const void* args,unsigned flags,const void* options,int* result){
  CHECK(!strncmp(path,TAC_GAME_MODULE_PREFIX,strlen(TAC_GAME_MODULE_PREFIX)));CHECK(bytes==0&&args==NULL&&flags==0&&options==NULL&&result);
  calls++;loaderThread=GetCurrentThreadId();CHECK(loaderThread!=inputThread);
  if(blockLoad){SetEvent(entered);CHECK(WaitForSingleObject(releaseLoad,3000)==WAIT_OBJECT_0);}
  // Module initializers may themselves call pad functions. This reentrant
  // callback must not recursively initialize a second module.
  gate(control,control->cookie,1);*result=startResult;return handle;
}
static void slot(unsigned index,const char* suffix="prx"){
  TacGameModule *s=&control->modules[index];memset(s,0,sizeof *s);s->enabled=1;s->handle=-1;
  const size_t prefix=strlen(TAC_GAME_MODULE_PREFIX);strcpy(s->path,TAC_GAME_MODULE_PREFIX);memset(s->path+prefix,'a'+index,64);snprintf(s->path+prefix+64,sizeof s->path-prefix-64,".%s",suffix);
}
static void reset(void){
  memset(control,0,sizeof *control);control->magic=TAC_GAME_GATE_MAGIC;control->cookie=0x123456789abcdef;
  control->version=TAC_GAME_GATE_VERSION;control->bytes=sizeof *control;control->enabled=1;control->loadStartModule=(uintptr_t)load;
  control->threadCreate=(uintptr_t)create;control->threadDetach=(uintptr_t)detach;control->dlsym=(uintptr_t)symbol;
  calls=0;handle=7;startResult=0;createResult=detachResult=activationResult=activationCalls=symbolMode=blockLoad=0;
  ResetEvent(entered);ResetEvent(releaseLoad);
}
int main(int argc,char **argv){
  if(argc>1&&!strcmp(argv[1],"--fail-check"))CHECK(0);
  CHECK(argc==2);FILE *f=fopen(argv[1],"rb");CHECK(f);unsigned char blob[4096];size_t length=fread(blob,1,sizeof blob,f);CHECK(length>0&&length<sizeof blob);fclose(f);
  unsigned char *code=(unsigned char*)VirtualAlloc(NULL,0x8000,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);CHECK(code);
  memcpy(code,blob,length);DWORD old;CHECK(VirtualProtect(code,0x1000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),code,0x1000));
  finished=CreateEvent(NULL,TRUE,TRUE,NULL);entered=CreateEvent(NULL,TRUE,FALSE,NULL);releaseLoad=CreateEvent(NULL,TRUE,FALSE,NULL);CHECK(finished&&entered&&releaseLoad);
  inputThread=GetCurrentThreadId();
  gate=(Gate)code;TacGameGate state{};control=&state;reset();slot(0);slot(1,"sprx");
  run(control,control->cookie,0);CHECK(calls==1&&control->modules[0].state==TAC_MODULE_STARTED&&control->modules[1].state==TAC_MODULE_PENDING);
  CHECK(control->callbacks[0]==1&&control->callbacks[1]==1&&control->busy==0&&control->modules[0].handle==7);
  run(control,control->cookie,1);CHECK(calls==2&&control->modules[1].state==TAC_MODULE_STARTED);
  run(control,control->cookie,0);CHECK(calls==2);
  reset();slot(0);control->enabled=0;run(control,control->cookie,0);CHECK(calls==0&&control->callbacks[0]==1);
  control->enabled=1;control->modules[0].enabled=0;run(control,control->cookie,0);CHECK(calls==0);
  control->modules[0].enabled=1;run(control,0,0);run(control,control->cookie+1,0);run(control,control->cookie,2);CHECK(calls==0);
  control->version=TAC_GAME_GATE_VERSION+1;run(control,control->cookie,0);CHECK(calls==0);
  reset();slot(0);startResult=-1;run(control,control->cookie,0);CHECK(calls==1&&control->modules[0].state==TAC_MODULE_FAILED&&control->modules[0].handle==7);
  startResult=0;run(control,control->cookie,0);CHECK(calls==1); // A resident-but-failed initializer is never replayed.
  reset();slot(0);handle=-1;run(control,control->cookie,0);CHECK(control->modules[0].state==TAC_MODULE_FAILED);
  reset();slot(0);control->modules[0].path[strlen(TAC_GAME_MODULE_PREFIX)]='Z';run(control,control->cookie,0);CHECK(calls==0&&control->modules[0].state==TAC_MODULE_REJECTED);
  reset();slot(0);control->modules[0].path[strlen(control->modules[0].path)]='x';run(control,control->cookie,0);CHECK(calls==0&&control->modules[0].state==TAC_MODULE_REJECTED);
  reset();slot(0);control->modules[0].path[0]='X';run(control,control->cookie,0);CHECK(calls==0&&control->modules[0].state==TAC_MODULE_REJECTED);
  // A blocked initializer must not hold the input callback or start another
  // initializer; real host threads execute the actual injected machine code.
  reset();slot(0);slot(1);blockLoad=1;
  gate(control,control->cookie,0);CHECK(WaitForSingleObject(entered,3000)==WAIT_OBJECT_0);
  CHECK(control->busy==1&&control->modules[0].phase==TAC_MODULE_PHASE_LOAD&&control->modules[1].state==TAC_MODULE_PENDING);
  unsigned before=created;gate(control,control->cookie,1);CHECK(created==before);
  CHECK(SetEvent(releaseLoad));drain();CHECK(control->busy==0&&control->modules[0].state==TAC_MODULE_STARTED);
  blockLoad=0;run(control,control->cookie,0);CHECK(calls==2);
  reset();slot(0);createResult=11;run(control,control->cookie,0);
  CHECK(!calls&&control->modules[0].state==TAC_MODULE_REJECTED&&control->modules[0].threadResult==11&&!control->busy);
  run(control,control->cookie,0);CHECK(!calls); // No implicit replay, even on thread failure.
  reset();slot(0);symbolMode=1;run(control,control->cookie,0);
  CHECK(calls==1&&activationCalls==1&&control->modules[0].activation==1&&control->modules[0].state==TAC_MODULE_STARTED);
  run(control,control->cookie,0);CHECK(activationCalls==1);
  reset();slot(0);symbolMode=1;activationResult=7;run(control,control->cookie,0);
  CHECK(control->modules[0].state==TAC_MODULE_FAILED&&control->modules[0].startResult==0&&control->modules[0].activationResult==7);
  reset();slot(0);symbolMode=2;run(control,control->cookie,0);
  CHECK(!activationCalls&&control->modules[0].state==TAC_MODULE_STARTED); // An unpaired export is not the activation contract.
  reset();slot(0);symbolMode=1;startResult=-1;run(control,control->cookie,0);CHECK(!activationCalls);
  reset();slot(0);detachResult=22;run(control,control->cookie,0);
  CHECK(calls==1&&control->modules[0].detachResult==22&&control->modules[0].state==TAC_MODULE_STARTED);
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
  CHECK(((Pad)stub)(17,29,41)==87);drain();CHECK(calls==1&&control->modules[0].state==TAC_MODULE_STARTED);
  CHECK(((Pad)stub)(-10,6,7)==3);CHECK(calls==1);
  CHECK(tac_game_trampoline(original,64,(uintptr_t)original,(uintptr_t)stub,(uintptr_t)control,0,(uintptr_t)gate,0,&trampoline));
  // Import thunk calls the existing chain before scheduling, preserves the
  // controller result and never needs to decode or overwrite that target.
  reset();slot(0);created=0;padCalls=0;
  unsigned char *importStub=code+0x4000;
  CHECK(!tac_game_import_trampoline((uintptr_t)pad_chain,(uintptr_t)control,control->cookie,(uintptr_t)gate,0,&trampoline));
  memcpy(importStub,trampoline.bytes,trampoline.size);CHECK(VirtualProtect(importStub,0x1000,PAGE_EXECUTE_READ,&old));
  CHECK(FlushInstructionCache(GetCurrentProcess(),importStub,0x1000));
  CHECK(((Pad)importStub)(11,22,33)==66);drain();CHECK(padCalls==1&&calls==1);
  CHECK(CloseHandle(finished)&&CloseHandle(entered)&&CloseHandle(releaseLoad));CHECK(VirtualFree(code,0,MEM_RELEASE));puts("Actual game callback binary and relocated SysV entry passed");return 0;
}
