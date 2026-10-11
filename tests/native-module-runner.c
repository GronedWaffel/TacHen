// SPDX-License-Identifier: GPL-3.0-or-later
#include "prx-image.h"
#include "elf-image.h"
#include "module-session.h"
#include "check.h"
#include <string.h>
#include <stdio.h>
static TacGameGate gate;static unsigned writes,reads,failWrite,failRead,partial,alwaysFail;
static int read_gate(void *p,TacGameGate *out){(void)p;if(++reads==failRead)return -1;*out=gate;return 0;}
static int write_gate(void *p,size_t at,const void *bytes,size_t count){
  (void)p;writes++;if(alwaysFail||writes==failWrite){if(partial)memcpy((char*)&gate+at,bytes,count/2);return -1;}
  memcpy((char*)&gate+at,bytes,count);return 0;
}
static void reset(TacModuleSession *s){
  memset(&gate,0,sizeof gate);gate.magic=TAC_GAME_GATE_MAGIC;gate.version=TAC_GAME_GATE_VERSION;gate.bytes=sizeof gate;gate.cookie=s->cookie;gate.enabled=1;gate.loadStartModule=0x900000;gate.threadCreate=0x901000;gate.threadDetach=0x902000;gate.dlsym=0x903000;
  writes=reads=failWrite=failRead=partial=alwaysFail=0;
}
int main(int argc,char **argv){
  (void)argv;if(argc>1)CHECK(0);
  char message[192];tac_module_failure_message((int32_t)UINT32_C(0x8002000d),0,message,sizeof message);
  CHECK(strstr(message,"loader rejected")&&strstr(message,"0x8002000d")&&strstr(message,"access denied"));
  tac_module_failure_message((int32_t)UINT32_C(0x80020063),0,message,sizeof message);
  CHECK(strstr(message,"SDK version")&&strstr(message,"0x80020063")&&strstr(message,"other payloads remain available"));
  tac_module_failure_message(42,-1,message,sizeof message);
  CHECK(strstr(message,"initializer failed")&&strstr(message,"0xffffffff")&&strstr(message,"handle 42"));
  char shortMessage[8];memset(shortMessage,'x',sizeof shortMessage);tac_module_failure_message(-1,0,shortMessage,sizeof shortMessage);CHECK(shortMessage[7]==0);
  unsigned char bytes[512]={0};TacElfHeader h={0};memcpy(h.ident,"\177ELF\2\1\1",7);h.type=0xfe18;h.machine=62;h.version=1;h.phoff=64;h.ehsize=64;h.phentsize=56;h.phnum=2;
  TacElfProgram p={0};p.type=1;p.flags=5;p.filesz=p.memsz=512;p.align=1;memcpy(bytes,&h,sizeof h);memcpy(bytes+64,&p,sizeof p);
  TacElfProgram dyn={0};dyn.type=2;dyn.offset=256;dyn.filesz=32;memcpy(bytes+120,&dyn,sizeof dyn);
  int platform;char reason[192];CHECK(!tac_prx_inspect(bytes,sizeof bytes,&platform,reason,sizeof reason));CHECK(platform==0);
  h.type=3;memcpy(bytes,&h,sizeof h);CHECK(tac_prx_inspect(bytes,sizeof bytes,&platform,reason,sizeof reason));h.type=0xfe18;
  h.phoff=UINT64_MAX;memcpy(bytes,&h,sizeof h);CHECK(tac_prx_inspect(bytes,sizeof bytes,&platform,reason,sizeof reason));h.phoff=64;memcpy(bytes,&h,sizeof h);
  p.memsz=UINT64_MAX;memcpy(bytes+64,&p,sizeof p);CHECK(tac_prx_inspect(bytes,sizeof bytes,&platform,reason,sizeof reason));p.memsz=512;
  p.align=3;memcpy(bytes+64,&p,sizeof p);CHECK(tac_prx_inspect(bytes,sizeof bytes,&platform,reason,sizeof reason));p.align=1;memcpy(bytes+64,&p,sizeof p);
  dyn.offset=500;memcpy(bytes+120,&dyn,sizeof dyn);CHECK(tac_prx_inspect(bytes,sizeof bytes,&platform,reason,sizeof reason));dyn.offset=256;memcpy(bytes+120,&dyn,sizeof dyn);
  h.phnum=3;memcpy(bytes,&h,sizeof h);TacElfProgram overlap=p;overlap.vaddr=100;overlap.filesz=overlap.memsz=20;memcpy(bytes+176,&overlap,sizeof overlap);
  CHECK(tac_prx_inspect(bytes,sizeof bytes,&platform,reason,sizeof reason));h.phnum=2;memcpy(bytes,&h,sizeof h);
  unsigned char self[576]={0};uint32_t magic=0xeef51454;memcpy(self,&magic,4);uint64_t size=sizeof self;memcpy(self+16,&size,8);self[24]=1;
  uint64_t offset=64,length=512;memcpy(self+40,&offset,8);memcpy(self+48,&length,8);memcpy(self+64,bytes,512);
  CHECK(!tac_prx_inspect(self,sizeof self,&platform,reason,sizeof reason));CHECK(platform==5);
  self[0]=0x4f;self[1]=0x15;self[2]=0x3d;self[3]=0x1d;CHECK(!tac_prx_inspect(self,sizeof self,&platform,reason,sizeof reason));CHECK(platform==0);
  // Mirrors the supplied PS5 Beach Menu's shared wrapper and ELF identity.
  self[64+7]=9;self[64+8]=2;
  CHECK(!tac_prx_inspect(self,sizeof self,&platform,reason,sizeof reason));CHECK(platform==0);
  unsigned char trailing[640]={0};memcpy(trailing,self,sizeof self);
  CHECK(!tac_prx_inspect(trailing,sizeof trailing,&platform,reason,sizeof reason));
  length=513;memcpy(trailing+48,&length,8);CHECK(tac_prx_inspect(trailing,sizeof trailing,&platform,reason,sizeof reason));
  length=512;memcpy(trailing+48,&length,8);uint64_t phoff=480;memcpy(trailing+64+32,&phoff,8);
  CHECK(tac_prx_inspect(trailing,sizeof trailing,&platform,reason,sizeof reason));
  length=505;memcpy(self+48,&length,8);CHECK(!tac_prx_inspect(self,569,&platform,reason,sizeof reason));
  length=506;memcpy(self+48,&length,8);CHECK(tac_prx_inspect(self,569,&platform,reason,sizeof reason));
  length=505;memcpy(self+48,&length,8);size=592;memcpy(self+16,&size,8);
  CHECK(tac_prx_inspect(self,569,&platform,reason,sizeof reason));
  size=sizeof self;memcpy(self+16,&size,8);length=512;memcpy(self+48,&length,8);
  self[48]=0xff;CHECK(tac_prx_inspect(self,sizeof self,&platform,reason,sizeof reason));
  CHECK(tac_prx_inspect(NULL,512,&platform,reason,sizeof reason));CHECK(tac_prx_inspect(bytes,63,&platform,reason,sizeof reason));
  TacModuleSession s={0},decoded;s.magic=TAC_MODULE_SESSION_MAGIC;s.version=TAC_MODULE_SESSION_VERSION;s.pid=88;s.phase=TAC_ARENA_READY;s.arena=0x100000;s.control=0x104000;s.cookie=123;
  strcpy(s.generation,"100:0/88/102:1");strcpy(s.title,"PPSA00001");memset(s.metadataHash,'a',64);
  TacModuleReceipt *r=&s.slots[0];memset(r->request,'b',32);memset(r->upload,'c',32);memset(r->sha256,'d',64);strcpy(r->extension,"sprx");r->stage=TAC_PRX_ARMING;
  tac_module_seal(&s);CHECK(!tac_module_decode(&s,sizeof s,s.generation,&decoded));CHECK(tac_module_slot(&decoded,r->request)==0);
  CHECK(tac_module_decode(&s,sizeof s,"different-generation",&decoded));s.pid++;CHECK(tac_module_decode(&s,sizeof s,s.generation,&decoded));s.pid--;
  s.control++;tac_module_seal(&s);CHECK(tac_module_decode(&s,sizeof s,s.generation,&decoded));s.control--;
  s.slots[1]=s.slots[0];tac_module_seal(&s);CHECK(tac_module_decode(&s,sizeof s,s.generation,&decoded));memset(&s.slots[1],0,sizeof s.slots[1]);
  TacModuleOps ops={NULL,read_gate,write_gate};reset(&s);CHECK(tac_module_stage(&s,0,&ops)==0);CHECK(writes==2&&gate.modules[0].enabled==1&&gate.modules[0].state==TAC_MODULE_PENDING);
  CHECK(!strncmp(gate.modules[0].path,TAC_GAME_MODULE_PREFIX,strlen(TAC_GAME_MODULE_PREFIX)));CHECK(tac_module_stage(&s,0,&ops)==1);
  reset(&s);gate.busy=1;CHECK(tac_module_stage(&s,0,&ops)==2&&writes==0);
  // A resumed callback can finish; only then publish this still-empty slot.
  gate.busy=0;CHECK(tac_module_stage(&s,0,&ops)==0&&writes==2);
  reset(&s);gate.busy=1;gate.modules[0].enabled=1;
  CHECK(tac_module_stage(&s,0,&ops)==1&&writes==0); // Busy never masks a changed slot.
  reset(&s);gate.cookie++;CHECK(tac_module_stage(&s,0,&ops)==1&&writes==0);
  reset(&s);failWrite=1;partial=1;CHECK(tac_module_stage(&s,0,&ops)==1);TacGameModule empty={0};CHECK(!memcmp(&empty,&gate.modules[0],sizeof empty));
  reset(&s);failWrite=2;CHECK(tac_module_stage(&s,0,&ops)==1);CHECK(!memcmp(&empty,&gate.modules[0],sizeof empty));
  reset(&s);failRead=3;CHECK(tac_module_stage(&s,0,&ops)==1);CHECK(!memcmp(&empty,&gate.modules[0],sizeof empty));
  reset(&s);alwaysFail=1;CHECK(tac_module_stage(&s,0,&ops)==-1);
  // Menu preparation and PRX loading must share one durable arena owner.
  char request[33];memset(request,'e',32);request[32]=0;
  CHECK(tac_module_session_held(&s));CHECK(tac_module_arena_claim(&s,request)==-1);
  memset(s.slots,0,sizeof s.slots);CHECK(!tac_module_session_held(&s));
  CHECK(tac_module_arena_claim(&s,request)==0&&s.arenaStage==1&&tac_module_session_held(&s));
  CHECK(tac_module_arena_claim(&s,request)==1);request[0]='f';CHECK(tac_module_arena_claim(&s,request)==-1);request[0]='e';
  tac_module_seal(&s);CHECK(!tac_module_decode(&s,sizeof s,s.generation,&decoded));
  CHECK(!memcmp(s.slots,decoded.slots,sizeof s.slots));CHECK(decoded.arenaStage==1&&!strcmp(decoded.arenaRequest,request));
  s.arenaStage=2;tac_module_seal(&s);CHECK(!tac_module_decode(&s,sizeof s,s.generation,&decoded)&&!tac_module_session_held(&decoded));
  s.phase=TAC_ARENA_UNKNOWN;tac_module_seal(&s);CHECK(!tac_module_decode(&s,sizeof s,s.generation,&decoded)&&tac_module_session_held(&decoded));
  s.phase=TAC_ARENA_EMPTY;tac_module_seal(&s);CHECK(tac_module_decode(&s,sizeof s,s.generation,&decoded));
  s.arenaStage=3;tac_module_seal(&s);CHECK(!tac_module_decode(&s,sizeof s,s.generation,&decoded));
  CHECK(tac_module_arena_claim(&s,request)==1); // A rejected request is still never dispatched again.
  s.arenaStage=4;tac_module_seal(&s);CHECK(!tac_module_decode(&s,sizeof s,s.generation,&decoded)&&tac_module_session_held(&decoded));
  s.arenaRequest[1]='z';tac_module_seal(&s);CHECK(tac_module_decode(&s,sizeof s,s.generation,&decoded));
  s.arenaRequest[1]='e';s.version=1;tac_module_seal(&s);CHECK(tac_module_decode(&s,sizeof s,s.generation,&decoded));
  puts("Native module container, durable session and stopped-slot rollback checks passed");return 0;
}
