// SPDX-License-Identifier: GPL-3.0-or-later
#include "pad-bridge.h"
#include "check.h"
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
using Bridge=int(TAC_GAME_SYSV *)(TacPadBridge*,uint64_t,unsigned,uint64_t,int,TacPadSample*,int);
static Bridge bridge;static TacPadBridge state;static uint64_t now=UINT64_C(1000000000),tick=1;
static TacPadSample source[64];static int returned=1,expectedCapacity=1,expectedHandle=17,originalCalls,clockFails,moduleCalls,nest;
static int TAC_GAME_SYSV clock_stub(int clock,TacPadTime *out){CHECK(clock==4);out->sec=now/1000000000;out->nsec=now%1000000000;return clockFails;}
static void TAC_GAME_SYSV module(TacGameGate *control,uint64_t cookie,unsigned lane){CHECK((uintptr_t)control==0x10000&&cookie==state.cookie&&lane<=1);moduleCalls++;}
static int TAC_GAME_SYSV original(int handle,TacPadSample *out,int capacity){
 CHECK(handle==expectedHandle&&capacity==expectedCapacity);originalCalls++;
 if(returned>0&&returned<=64)memcpy(out,source,returned*sizeof *out);return returned;
}
static int invoke(TacPadSample *out,int handle=17,int capacity=1,unsigned lane=1){
 expectedHandle=handle;expectedCapacity=capacity;
 return bridge(&state,state.cookie,lane,(uintptr_t)original,handle,out,capacity);
}
static TacPadSample sample(uint32_t buttons=0x4000){
 TacPadSample s{};s.buttons=buttons;s.connected=1;s.connection=3;s.timestamp=tick++;
 for(auto &stick:s.sticks)stick=200;s.triggers[0]=31;s.triggers[1]=7;s.orientation[3]=0.5f;s.acceleration[0]=2;
 s.angular[1]=3;s.touches[0]=1;s.touches[8]=99;s.deviceLength=12;memset(s.device,0x59,12);return s;
}
static void grant(unsigned mode=2,int owner=17,unsigned epoch=1){
 state.lease.revision+=2;state.lease.epoch=epoch;state.lease.mode=mode;state.lease.owner=owner;state.lease.connection=3;state.lease.expires=now+200000000;
}
static void reset(){
 memset(&state,0,sizeof state);state.magic=TAC_PAD_MAGIC;state.version=1;state.bytes=sizeof state;state.cookie=0x9988776655443322;
 state.clock=(uintptr_t)clock_stub;state.moduleEntry=(uintptr_t)module;state.moduleControl=0x10000;state.enabled=1;
 now=1000000000;returned=expectedCapacity=1;expectedHandle=17;originalCalls=moduleCalls=clockFails=nest=0;source[0]=sample();grant();
}
static int is_neutral(const TacPadSample& s){return !s.buttons&&s.sticks[0]==128&&s.sticks[1]==128&&s.sticks[2]==128&&s.sticks[3]==128&&!s.triggers[0]&&!s.triggers[1]&&!s.touches[0]&&s.orientation[3]==1;}
static int TAC_GAME_SYSV state_original(int handle,TacPadSample *out){
 CHECK(handle==17);originalCalls++;*out=source[0];return 0;
}
static int TAC_GAME_SYSV nested_original(int handle,TacPadSample *out,int capacity){
 CHECK(!nest);nest=1;int result=bridge(&state,state.cookie,1,(uintptr_t)original,handle,out,capacity);nest=0;return result;
}
int main(int argc,char **argv){
 if(argc>1&&!strcmp(argv[1],"--fail-check"))CHECK(0);CHECK(argc==2);
 FILE *file=fopen(argv[1],"rb");CHECK(file);unsigned char blob[8192];size_t length=fread(blob,1,sizeof blob,file);fclose(file);CHECK(length>0&&length<sizeof blob);
 unsigned char *code=(unsigned char*)VirtualAlloc(NULL,0x6000,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);CHECK(code);memcpy(code,blob,length);
 DWORD old;CHECK(VirtualProtect(code,0x2000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),code,0x2000));bridge=(Bridge)code;
 TacPadSample out[64]{};reset();state.enabled=0;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));CHECK(originalCalls==1&&moduleCalls==1&&!state.written);
 reset();state.magic=0;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));CHECK(moduleCalls==0);
 reset();grant(TAC_PAD_OBSERVE);CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));CHECK(state.written==1&&state.events[0].buttons==source[0].buttons);
 reset();CHECK(invoke(out)==1&&is_neutral(out[0]));CHECK(out[0].timestamp==source[0].timestamp&&out[0].connected==1&&out[0].connection==3&&out[0].deviceLength==12&&!memcmp(out[0].device,source[0].device,12));
 CHECK(state.events[0].handle==17&&state.events[0].sequence==1&&state.events[0].sticks[0]==200&&state.events[0].time==now);
 CHECK(invoke(out,18)==1&&!memcmp(out,source,sizeof *out));CHECK(state.written==2); // Other player never captured.
 reset();source[0].connection=4;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));
 reset();source[0].connected=0;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out)&&!state.written);
 reset();source[0].buttons|=0x80000000;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out)&&!state.written);
 reset();returned=-123;memset(out,0x5a,sizeof out);CHECK(invoke(out)==-123&&((unsigned char*)out)[0]==0x5a&&!state.written);
 reset();returned=2;source[1]=sample(0x2000);CHECK(invoke(out,17,1)==2&&!memcmp(out,source,2*sizeof *out)&&!state.written);
 reset();returned=0;CHECK(bridge(&state,state.cookie,0,(uintptr_t)state_original,17,out,0)==0&&is_neutral(out[0]));
 reset();clockFails=1;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));
 reset();state.lease.revision|=1;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));
 reset();state.lease.expires=now+TAC_PAD_LEASE_NS+1;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));
 reset();CHECK(invoke(out)==1&&is_neutral(out[0]));now+=200000001;CHECK(invoke(out)==1&&is_neutral(out[0]));
 now+=TAC_PAD_DRAIN_NS+1;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out)); // Cached timestamp cannot extend capture.
 reset();CHECK(invoke(out)==1&&is_neutral(out[0]));now+=1000000000;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out)); // Sleeping game does not restart an expired drain.
 reset();CHECK(invoke(out)==1);grant(TAC_PAD_OBSERVE);source[0]=sample(0);for(auto &s:source[0].sticks)s=128;
 source[0].triggers[0]=source[0].triggers[1]=0;source[0].touches[0]=0;CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));
 source[0]=sample();CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out)); // Physical release cancels drain immediately.
 reset();state.lock=1;CHECK(invoke(out)==1&&is_neutral(out[0])&&state.faultEpoch==1&&!state.written);state.lock=0;
 CHECK(invoke(out)==1&&!memcmp(out,source,sizeof *out));grant(2,17,2);CHECK(invoke(out)==1&&is_neutral(out[0]));
 reset();returned=64;for(unsigned i=0;i<64;i++)source[i]=sample(i%2?0x2000:0x4000);
 struct Guarded {uint64_t before;TacPadSample samples[64];uint64_t after;} guarded{123,{},456};
 CHECK(invoke(guarded.samples,17,64)==64&&state.written==64);CHECK(guarded.before==123&&guarded.after==456);
 CHECK(invoke(out,17,64)==64&&state.written==128);CHECK(invoke(out,17,64)==64&&state.faultEpoch==1&&state.written==128);
 state.consumed=state.written;grant(2,17,2);CHECK(invoke(out,17,64)==64&&state.written==192);
 reset();CHECK(bridge(&state,state.cookie,1,(uintptr_t)nested_original,17,out,1)==1&&is_neutral(out[0])&&state.written==1);
 CHECK(state.events[0].buttons==0x4000); // Nested read cannot publish a fabricated release.
 reset();grant(TAC_PAD_OBSERVE);state.written=state.consumed=UINT32_MAX;CHECK(invoke(out)==1&&state.written==0&&state.events[127].sequence==0);
 reset();grant(TAC_PAD_OBSERVE);for(int i=0;i<8;i++)CHECK(invoke(out,100+i)==1);CHECK(!state.faults);
 now+=3000000000;grant(TAC_PAD_OBSERVE);CHECK(invoke(out,999)==1&&!state.faults&&state.written==9); // Reopened handles can reuse expired slots.
 // Execute the actual typed entry trampoline, including stack argument seven
 // and a relocated original prologue, with both native pad call signatures.
 reset();unsigned char *entry=code+0x2000,*stub=code+0x3000;memset(entry,0x90,64);
 entry[16]=0xff;entry[17]=0x25;memset(entry+18,0,4);uint64_t address=(uintptr_t)original;memcpy(entry+22,&address,8);
 TacGameTrampoline built{};CHECK(!tac_pad_trampoline(entry,64,(uintptr_t)entry,(uintptr_t)stub,(uintptr_t)&state,state.cookie,(uintptr_t)bridge,1,&built));
 CHECK(built.stolen>=14&&built.size<=512);memcpy(stub,built.bytes,built.size);
 CHECK(VirtualProtect(entry,0x2000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),entry,0x2000));
 expectedCapacity=64;returned=64;for(unsigned i=0;i<64;i++)source[i]=sample(i%2?0x2000:0x4000);
 CHECK(((TacPadRead)stub)(17,out,64)==64&&is_neutral(out[0])&&state.written==64&&moduleCalls==1&&originalCalls==1);
 CHECK(VirtualProtect(entry,0x2000,PAGE_READWRITE,&old));reset();address=(uintptr_t)state_original;memcpy(entry+22,&address,8);
 CHECK(!tac_pad_trampoline(entry,64,(uintptr_t)entry,(uintptr_t)stub,(uintptr_t)&state,state.cookie,(uintptr_t)bridge,0,&built));memcpy(stub,built.bytes,built.size);
 CHECK(VirtualProtect(entry,0x2000,PAGE_EXECUTE_READ,&old));CHECK(FlushInstructionCache(GetCurrentProcess(),entry,0x2000));
 using ReadState=int(TAC_GAME_SYSV *)(int,TacPadSample*);CHECK(((ReadState)stub)(17,out)==0&&is_neutral(out[0])&&originalCalls==1);
 CHECK(VirtualFree(code,0,MEM_RELEASE));puts("Actual post-read pad bridge: typed ABI, original results, ownership, expiry, nested reads, batches and overflow passed");return 0;
}
