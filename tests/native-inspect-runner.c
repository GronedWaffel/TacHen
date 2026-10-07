// SPDX-License-Identifier: GPL-3.0-or-later
#include "check.h"
#include "memory-inspect.h"
#include <string.h>
typedef struct {int attached,attachFail,detachFail,identityFail,rangeFail,readFail,unhealthy,expireAt;unsigned reads,detaches;} Fixture;
static int attach(void *p){Fixture *f=p;f->attached=1;return f->attachFail?-1:0;}
static int detach(void *p){Fixture *f=p;f->detaches++;if(f->detachFail)return -1;f->attached=0;return 0;}
static int identity(void *p){return !((Fixture*)p)->identityFail;}
static int deadline(void *p){Fixture *f=p;return !f->expireAt||f->reads<(unsigned)f->expireAt;}
static int module(void *p,uint64_t *base,uint64_t *size){(void)p;*base=0x400000;*size=0x20000;return 0;}
static int range(void *p,uint64_t at,size_t size){Fixture *f=p;CHECK(f->attached&&at>=0x400000&&at+size<=0x420000);return f->rangeFail?-1:0;}
static int readbytes(void *p,uint64_t at,void *bytes,size_t size){Fixture *f=p;CHECK(f->attached&&at>=0x400000&&at+size<=0x420000&&size<=16384);
  f->reads++;memset(bytes,0xaa,size);return f->readFail&&f->reads==(unsigned)f->readFail?-1:0;}
static int healthy(void *p){return !((Fixture*)p)->unhealthy;}
static TacCheatResult run(Fixture *f,uint64_t off,size_t size,unsigned char *bytes,uint64_t *base,uint64_t *span){
  TacCheatOps o={f,attach,detach,identity,deadline,module,range,readbytes,NULL,NULL,healthy};return tac_memory_inspect(&o,off,size,bytes,base,span);}
int main(int argc,char **argv){
  (void)argv;if(argc>1)CHECK(0);Fixture f={0};unsigned char bytes[65536];uint64_t base,size;TacCheatResult r;
  r=run(&f,0,sizeof bytes,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_APPLIED&&r.resumed&&r.restored&&!r.writes&&f.reads==4&&f.detaches==1&&!f.attached&&base==0x400000&&size==0x20000);
  for(size_t i=0;i<sizeof bytes;i++)CHECK(bytes[i]==0xaa);
  f=(Fixture){0};r=run(&f,0,0,NULL,&base,&size);CHECK(r.status==TAC_CHEAT_APPLIED&&base==0x400000&&f.reads==0&&f.detaches==1);
  f=(Fixture){.readFail=2};r=run(&f,0,sizeof bytes,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_REJECTED&&r.resumed&&base==0&&size==0&&f.detaches==1);
  for(size_t i=0;i<sizeof bytes;i++)CHECK(!bytes[i]);
  f=(Fixture){.detachFail=1};r=run(&f,0,1,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_UNCERTAIN&&!r.resumed&&!bytes[0]&&!base);
  f=(Fixture){.attachFail=1};r=run(&f,0,1,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_REJECTED&&r.resumed&&f.detaches==1&&!f.reads);
  f=(Fixture){.unhealthy=1};r=run(&f,0,1,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_UNCERTAIN&&r.resumed&&!bytes[0]);
  f=(Fixture){.rangeFail=1};r=run(&f,0,1,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_REJECTED&&r.resumed&&!f.reads);
  f=(Fixture){.expireAt=1};r=run(&f,0,sizeof bytes,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_REJECTED&&r.resumed&&f.reads==1);
  f=(Fixture){0};r=run(&f,0x1ffff,2,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_REJECTED&&r.resumed&&!f.reads);
  f=(Fixture){0};r=run(&f,0,65537,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_REJECTED&&!f.detaches&&!f.attached);
  f=(Fixture){.identityFail=1};r=run(&f,0,1,bytes,&base,&size);CHECK(r.status==TAC_CHEAT_REJECTED&&!f.detaches);
  puts("Native bounded inspection and confirmed-resume checks passed");return 0;
}
