// SPDX-License-Identifier: GPL-3.0-or-later
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "goldhen-compat.h"
#define CHECK(x) do{if(!(x)){fprintf(stderr,"CHECK failed line %d: %s\n",__LINE__,#x);exit(90);}}while(0)
static unsigned char memory[0x20000];
static unsigned reads,writes,sleeps;
static int failRead,failWrite,serve=1,realPointers;
static TacGoldhenBridge *box;
static TacGoldhenInfo info;
static int readmem(void *unused,uint64_t at,void *p,size_t n){
  (void)unused;reads++;if(failRead)return -1;
  if(realPointers&&at>0x200000){memcpy(p,(void*)(uintptr_t)at,n);return 0;}
  if(at<0x100000||at-0x100000>sizeof memory||n>sizeof memory-(at-0x100000))return -1;
  memcpy(p,memory+(at-0x100000),n);return 0;
}
static int writemem(void *unused,uint64_t at,const void *p,size_t n){
  (void)unused;writes++;if(failWrite||at<0x100000||at-0x100000>sizeof memory||n>sizeof memory-(at-0x100000))return -1;
  memcpy(memory+(at-0x100000),p,n);return 0;
}
static TacGoldhenOps ops={NULL,readmem,writemem};
static int TAC_GAME_SYSV pause_mock(unsigned us){
  CHECK(us==10000);sleeps++;
  if(serve&&box->state==TAC_GH_PENDING){box->result=tac_goldhen_request(&ops,&info,box->command,box->argument);__atomic_store_n(&box->state,TAC_GH_DONE,__ATOMIC_RELEASE);}
  return 0;
}
static void reset(void){memset(memory,0,sizeof memory);reads=writes=sleeps=0;failRead=failWrite=0;serve=1;*box=(TacGoldhenBridge){.magic=TAC_GOLDHEN_MAGIC,.cookie=123,.sleep=(uintptr_t)pause_mock};}
typedef int (TAC_GAME_SYSV *Gate)(TacGoldhenBridge*,uint64_t,void*);
typedef int (TAC_GAME_SYSV *Adapted)(uint64_t,void*);
int main(int argc,char **argv){
  if(argc==2&&!strcmp(argv[1],"--fail-check")){CHECK(0);}
  CHECK(argc>=2);
  unsigned char code[4096];FILE *f=fopen(argv[1],"rb");CHECK(f);size_t n=fread(code,1,sizeof code,f);CHECK(n&&n<sizeof code);fclose(f);
  void *executable=VirtualAlloc(NULL,4096,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);CHECK(executable);memcpy(executable,code,n);DWORD old;CHECK(VirtualProtect(executable,4096,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),executable,n));
  Gate gate=(Gate)executable;TacGoldhenBridge mailbox;box=&mailbox;info=(TacGoldhenInfo){.pid=123,.base=0x400000};strcpy(info.title,"CUSA03041");strcpy(info.version,"01.32");
  CHECK(sizeof info==202&&offsetof(TacGoldhenInfo,base)==194);
  reset();CHECK(gate(box,4,(void*)0x100100)==0);CHECK(!memcmp(memory+0x100,&info,sizeof info));CHECK(box->state==TAC_GH_IDLE&&sleeps==1);
  reset();TacGoldhenRw rw={.address=0x101000,.data=0x102000,.length=14,.write=1};memcpy(memory,&rw,sizeof rw);memset(memory+0x2000,0xa5,14);
  CHECK(gate(box,5,(void*)0x100000)==0);CHECK(!memcmp(memory+0x1000,memory+0x2000,14));CHECK(writes==1);
  rw.write=0;rw.length=8;memcpy(memory,&rw,sizeof rw);memset(memory+0x1000,0x36,8);CHECK(gate(box,5,(void*)0x100000)==0);CHECK(!memcmp(memory+0x1000,memory+0x2000,8));
  reset();CHECK(gate(box,2,(void*)0x100000)==-1&&sleeps==0);CHECK(gate(box,0,(void*)0x100000)==-1);CHECK(gate(box,4,NULL)==-1);
  box->magic++;CHECK(gate(box,4,(void*)0x100000)==-1);box->magic--;
  failWrite=1;CHECK(gate(box,4,(void*)0x100100)==-1&&box->state==TAC_GH_IDLE);
  reset();rw=(TacGoldhenRw){.address=0xffff800000001000,.data=0x102000,.length=14,.write=1};memcpy(memory,&rw,sizeof rw);CHECK(gate(box,5,(void*)0x100000)==-1&&writes==0);
  rw.address=0x101000;rw.length=65537;memcpy(memory,&rw,sizeof rw);CHECK(gate(box,5,(void*)0x100000)==-1&&writes==0);
  rw.length=14;rw.write=2;memcpy(memory,&rw,sizeof rw);CHECK(gate(box,5,(void*)0x100000)==-1&&writes==0);
  rw.write=1;memcpy(memory,&rw,sizeof rw);failRead=1;CHECK(gate(box,5,(void*)0x100000)==-1&&writes==0);
  reset();serve=0;CHECK(gate(box,4,(void*)0x100100)==-1&&sleeps==1000&&box->state==TAC_GH_EXPIRED);serve=1;CHECK(gate(box,4,(void*)0x100100)==-1&&sleeps==1000); // Never replay timed-out operation.
  reset();box->state=TAC_GH_LOCKED;CHECK(gate(box,4,(void*)0x100100)==-1&&sleeps==1000&&box->state==TAC_GH_LOCKED);
  unsigned char sfo[50]={0};uint32_t header[]={0x46535000,0x101,36,44,1};memcpy(sfo,header,20);uint16_t format=0x204;memcpy(sfo+22,&format,2);uint32_t six=6;memcpy(sfo+24,&six,4);memcpy(sfo+28,&six,4);memcpy(sfo+36,"APP_VER",8);memcpy(sfo+44,"01.32",6);char version[6];CHECK(!tac_goldhen_sfo(sfo,sizeof sfo,"APP_VER",version,sizeof version));CHECK(!strcmp(version,"01.32"));CHECK(tac_goldhen_sfo(sfo,49,"APP_VER",version,6)==-1);sfo[49]='x';CHECK(tac_goldhen_sfo(sfo,50,"APP_VER",version,6)==-1);
  CHECK(tac_goldhen_supported(TAC_HAVANA132_SHA)&&!tac_goldhen_supported("other"));
  // Execute the actual patched SDK wrapper, including argument shuffling and
  // its tail jump into the production position-independent bridge blob.
  unsigned char *module=VirtualAlloc(NULL,0x34000,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);CHECK(module);
  const unsigned char original[]={0x55,0x48,0x89,0xe5,0x48,0x83,0xec,0x10,0x48,0x89,0x7d,0xf8,0x48,0x89,0x75,0xf0,0x48,0x8b,0x75,0xf8,0x48,0x8b,0x55,0xf0,0xbf,0xf4,0x01,0x00,0x00,0xb0,0x00,0xe8,0xec,0x01,0x00,0x00,0x48,0x83,0xc4,0x10,0x5d,0xc3};
  const unsigned char hookBefore[]={0x48,0x8b,0x7d,0xe0,0x48,0x8d,0x75,0xea,0xba,0x0e,0x00,0x00,0x00,0xe8,0xd7,0x59,0xff,0xff,0x48,0x8b,0x7d,0xe0,0x48,0x83,0xc7,0x06,0x48,0x8d,0x75,0xd8,0xba,0x08,0x00,0x00,0x00,0xe8,0xc1,0x59,0xff,0xff,0xe9,0x13,0x00,0x00,0x00};
  CHECK(tac_goldhen_patch(module,202688,(uintptr_t)executable,(uintptr_t)box)==-1);
  memcpy(module+0x850+0xe607,hookBefore,sizeof hookBefore);
  memcpy(module+0x17090,original,sizeof original);CHECK(tac_goldhen_patch(module,202687,(uintptr_t)executable,(uintptr_t)box)==-1);
  CHECK(tac_goldhen_patch(module,202688,(uintptr_t)executable,(uintptr_t)box)==0);
  // Preserve the actual Havana patch helper and SDK proc-RW wrapper. They
  // construct the real command-5 argument layout on a genuine SysV stack.
  const unsigned char helper[]={0x55,0x48,0x89,0xe5,0x48,0x83,0xec,0x40,0x48,0x89,0x7d,0xf8,0x48,0x89,0x75,0xf0,0x48,0x89,0x55,0xe8,0x48,0x8b,0x45,0xf8,0x48,0x89,0x45,0xc8,0x48,0x8b,0x45,0xf0,0x48,0x89,0x45,0xd0,0x48,0x8b,0x45,0xe8,0x48,0x89,0x45,0xd8,0x48,0xc7,0x45,0xe0,0x01,0x00,0x00,0x00,0x48,0x8d,0x7d,0xc8,0xe8,0xc3,0x28,0x01,0x00,0x48,0x83,0xc4,0x40,0x5d,0xc3};
  memcpy(module+0x850+0x3ff0,helper,sizeof helper);
  // SDK wrapper: cmd(5,arg), tail jump preserves caller's stack.
  unsigned char rwWrap[]={0x48,0x89,0xfe,0xbf,5,0,0,0,0xe9,0,0,0,0};int32_t rel=(int32_t)(0x16840-(0x168f0+sizeof rwWrap));memcpy(rwWrap+9,&rel,4);memcpy(module+0x850+0x168f0,rwWrap,sizeof rwWrap);
  module[0x850+0xe647]=0xc9;module[0x850+0xe648]=0xc3; // test-only exit restores the thread frame.
  unsigned char thunk[]={0x55,0x48,0x89,0xe5,0x48,0x83,0xec,0x30,
    0x48,0xc7,0x45,0xe0,0,0x10,0x10,0, // target 0x101000
    0x48,0xc7,0x45,0xd8,0x78,0x56,0x34,0x12, // destination 0x12345678
    0x48,0xc7,0x45,0xea,0xff,0x25,0,0, // initial FF25 template
    0x48,0xc7,0x45,0xf2,0,0,0,0,
    0x48,0xb8,0,0,0,0,0,0,0,0,0xff,0xe0};
  uint64_t snippet=(uintptr_t)(module+0x850+0xe607);memcpy(thunk+42,&snippet,8);memcpy(module,thunk,sizeof thunk);
  CHECK(VirtualProtect(module,0x34000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),module,0x34000));
  reset();Adapted adapted=(Adapted)(module+0x17090);CHECK(adapted(4,(void*)0x100100)==0);CHECK(!memcmp(memory+0x100,&info,sizeof info));
  reset();realPointers=1;typedef void (TAC_GAME_SYSV *HookTest)(void);((HookTest)module)();realPointers=0;
  CHECK(writes==1&&sleeps==1&&memory[0x1000]==0xff&&memory[0x1001]==0x25);uint64_t destination=0;memcpy(&destination,memory+0x1006,8);CHECK(destination==0x12345678);
  // Optional official sample is local only; never redistribute its binary.
  if(argc==3){f=fopen(argv[2],"rb");CHECK(f);unsigned char *sample=malloc(202688);CHECK(sample&&fread(sample,1,202688,f)==202688);fclose(f);CHECK(!tac_goldhen_patch(sample,202688,(uintptr_t)executable,(uintptr_t)box));free(sample);}
  puts("GoldHEN compatibility ABI, real machine code, failure, timeout and adapted-call tests passed");return 0;
}
