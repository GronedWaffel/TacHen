// SPDX-License-Identifier: GPL-3.0-or-later
#include "check.h"
#include "cheat-transaction.h"
#include <string.h>
typedef struct {unsigned char memory[512];int attached,attachFail,resumeFail,identityFail,rangeFail,readFail,writeFail,rollbackFail,journalFail,unhealthy,expired;
  unsigned writes,reads,journals,detachCalls;} Fixture;
static int attach(void *p){Fixture *f=p;f->attached=1;return f->attachFail?-1:0;}
static int detach(void *p){Fixture *f=p;f->detachCalls++;if(f->resumeFail)return -1;f->attached=0;return 0;}
static int identity(void *p){return !((Fixture*)p)->identityFail;}
static int deadline(void *p){Fixture *f=p;return !f->expired||f->writes<(unsigned)f->expired;}
static int module(void *p,uint64_t *base,uint64_t *size){(void)p;*base=0x400000;*size=512;return 0;}
static int range(void *p,uint64_t at,size_t n){Fixture *f=p;(void)at;(void)n;return f->rangeFail?-1:0;}
static int readbytes(void *p,uint64_t at,void *bytes,size_t n){Fixture *f=p;CHECK(f->attached);CHECK(at>=0x400000&&at+n<=0x400200);
  if(++f->reads==(unsigned)f->readFail)return -1;memcpy(bytes,f->memory+at-0x400000,n);return 0;}
static int writebytes(void *p,uint64_t at,const void *bytes,size_t n){Fixture *f=p;CHECK(f->attached);CHECK(f->journals==1);CHECK(at>=0x400000&&at+n<=0x400200);
  ++f->writes;if(f->rollbackFail&&f->writes>2)return -1;
  if(f->writes==(unsigned)f->writeFail){memcpy(f->memory+at-0x400000,bytes,1);return -1;}
  memcpy(f->memory+at-0x400000,bytes,n);return 0;}
static int journal(void *p){Fixture *f=p;f->journals++;return f->journalFail?-1:0;}
static int healthy(void *p){return !((Fixture*)p)->unhealthy;}
static void u32(unsigned char *p,uint32_t n){memcpy(p,&n,4);}
static void u64(unsigned char *p,uint64_t n){memcpy(p,&n,8);}
static void packet(unsigned char out[56]){
  memset(out,0,56);u32(out,TAC_CHEAT_PLAN_MAGIC);u32(out+4,1);u32(out+8,2);u32(out+12,56);
  u64(out+16,16);u32(out+24,2);out[32]=1;out[33]=2;out[34]=0x90;out[35]=0x90;
  u64(out+36,32);u32(out+44,2);out[52]=3;out[53]=4;out[54]=0x91;out[55]=0x91;
}
static void reset(Fixture *f){memset(f,0,sizeof *f);f->memory[16]=1;f->memory[17]=2;f->memory[32]=3;f->memory[33]=4;}
static TacCheatResult run(Fixture *f,unsigned char wire[56]){TacCheatPlan plan;CHECK(!tac_cheat_plan(wire,56,&plan));
  TacCheatOps ops={f,attach,detach,identity,deadline,module,range,readbytes,writebytes,journal,healthy};return tac_cheat_apply(&plan,&ops);}
int main(int argc,char **argv){
  (void)argv;if(argc>1)CHECK(0);Fixture f;TacCheatResult r;unsigned char wire[56];TacCheatPlan plan;packet(wire);
  CHECK(!tac_cheat_plan(wire,56,&plan));CHECK(plan.count==2&&plan.bytes==4);
  for(unsigned i=0;i<56;i++)CHECK(tac_cheat_plan(wire,i,&plan));
  u32(wire+28,1);CHECK(tac_cheat_plan(wire,56,&plan));packet(wire);
  u64(wire+36,17);CHECK(tac_cheat_plan(wire,56,&plan));packet(wire);
  u64(wire+16,UINT64_MAX);CHECK(tac_cheat_plan(wire,56,&plan));packet(wire);
  u32(wire+24,4097);CHECK(tac_cheat_plan(wire,56,&plan));packet(wire);
  reset(&f);r=run(&f,wire);CHECK(r.status==TAC_CHEAT_APPLIED&&r.resumed&&!r.restored&&r.writes==2&&!f.attached&&f.memory[16]==0x90&&f.memory[32]==0x91);
  reset(&f);f.memory[32]=99;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&r.restored&&r.resumed&&f.writes==0&&f.journals==0);
  reset(&f);f.writeFail=2;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&r.restored&&r.resumed&&f.writes==4&&f.memory[16]==1&&f.memory[32]==3&&f.memory[33]==4);
  reset(&f);f.writeFail=2;f.rollbackFail=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_UNCERTAIN&&!r.restored&&r.resumed&&f.writes==4);
  reset(&f);f.writeFail=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&r.restored&&f.memory[16]==1&&f.memory[17]==2&&f.writes==2);
  reset(&f);f.resumeFail=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_UNCERTAIN&&!r.resumed&&f.detachCalls==1);
  reset(&f);f.journalFail=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&r.restored&&r.resumed&&!f.writes);
  reset(&f);f.identityFail=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&r.resumed&&!f.detachCalls&&!f.writes);
  reset(&f);f.attachFail=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&r.resumed&&f.detachCalls==1);
  reset(&f);f.rangeFail=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&!f.writes&&r.resumed);
  reset(&f);f.expired=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&r.restored&&r.resumed&&f.memory[16]==1&&f.writes==2);
  reset(&f);f.unhealthy=1;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_UNCERTAIN&&!r.restored&&r.resumed);
  reset(&f);f.readFail=3;r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&r.restored&&f.memory[16]==1&&f.writes==2);
  packet(wire);u64(wire+36,512);reset(&f);r=run(&f,wire);CHECK(r.status==TAC_CHEAT_REJECTED&&!f.writes);
  puts("Native cheat transaction preflight, partial rollback, deadlines and resume checks passed");return 0;
}
