#include "pad-exchange.h"
#include "user-write.h"
#include <stdio.h>
#include <string.h>
#define CHECK(x) do{if(!(x)){fprintf(stderr,"line %d: %s\n",__LINE__,#x);return 90;}}while(0)
static TacPadBridge bridge;static uint64_t timeNow;static int reads,writes,failRead,failWrite,partialWrite,mutate;
static const uint64_t arena=0x100000,cookie=123,now=1000000000;
static uint64_t clock_now(void *p){(void)p;return timeNow;}
static int read_block(void *p,size_t at,void *out,size_t n){
 (void)p;reads++;if(reads==failRead)return -1;
 if(mutate&&reads==mutate)bridge.faultEpoch=7;
 if(at>sizeof bridge||n>sizeof bridge-at)return -1;memcpy(out,(char*)&bridge+at,n);return 0;
}
static int write_block(void *p,size_t at,const void *bytes,size_t n){
 (void)p;writes++;if(at>sizeof bridge||n>sizeof bridge-at)return -1;
 if(writes==failWrite){if(partialWrite)memcpy((char*)&bridge+at,bytes,n);return -1;}
 memcpy((char*)&bridge+at,bytes,n);return 0;
}
static void setup(void){
 memset(&bridge,0,sizeof bridge);bridge.magic=TAC_PAD_MAGIC;bridge.cookie=cookie;bridge.version=1;bridge.bytes=sizeof bridge;
 bridge.moduleEntry=arena;bridge.moduleControl=arena+0x4000;bridge.clock=0x123400;timeNow=now;
 reads=writes=failRead=failWrite=partialWrite=mutate=0;
}
static void events(uint32_t start,unsigned count){
 bridge.consumed=start;bridge.written=start+count;
 for(unsigned i=0;i<count;i++){uint32_t seq=start+i+1;bridge.events[(seq-1)%TAC_PAD_EVENTS]=(TacPadEvent){.sequence=seq,.handle=4,.connection=2,.buttons=i+1,.time=now-1000};}
}
static int empty(const TacPadBatch *batch){TacPadBatch zero={0};return !memcmp(batch,&zero,sizeof zero);}
static unsigned char destination[9000];static int identityCalls,translations,physicalCalls,broken;
static int current(void *p){(void)p;return !(broken==3&&++identityCalls==4);}
static int translate(void *p,uint64_t at,uint64_t *physical,uint64_t *available){
 (void)p;translations++;*physical=at;*available=broken==1?0:8192;return 0;
}
static int physical(void *p,uint64_t at,const void *bytes,size_t n){
 (void)p;physicalCalls++;if(broken==2&&physicalCalls==2)return -1;
 if(at+n>sizeof destination||n>4096-(at&4095))return -1;memcpy(destination+at,bytes,n);return 0;
}
int main(int argc,char **argv){
 if(argc>1&&!strcmp(argv[1],"--fail-check"))CHECK(0);
 TacPadExchangeOps ops={NULL,read_block,write_block,clock_now};TacPadRequest request={7,TAC_PAD_OBSERVE,-1,0};TacPadBatch batch;
 setup();events(0,4);CHECK(!tac_pad_exchange(&ops,arena,cookie,&request,now,&batch));
 CHECK(batch.count==0&&batch.reset&&bridge.consumed==4&&bridge.enabled&&bridge.lease.mode==TAC_PAD_OBSERVE);
 CHECK(batch.deadline==now+400000000&&!(bridge.lease.revision&1));
 events(UINT32_MAX-3,8);request.mode=TAC_PAD_CAPTURE;request.owner=4;request.connection=2;
 CHECK(!tac_pad_exchange(&ops,arena,cookie,&request,now,&batch));CHECK(batch.count==8&&!batch.reset);
 for(unsigned i=0;i<8;i++)CHECK(batch.events[i].buttons==i+1&&batch.events[i].sequence==UINT32_MAX-2+i);
 CHECK(bridge.consumed==4&&bridge.lease.owner==4&&bridge.lease.connection==2);
 events(0,TAC_PAD_EVENTS);CHECK(!tac_pad_exchange(&ops,arena,cookie,&request,now,&batch));CHECK(batch.count==TAC_PAD_EVENTS);
 // New epochs flush prior events instead of replaying presses into a new menu.
 request.epoch=8;events(128,3);CHECK(!tac_pad_exchange(&ops,arena,cookie,&request,now,&batch));CHECK(!batch.count&&batch.reset);
 request.mode=TAC_PAD_OFF;CHECK(!tac_pad_exchange(&ops,arena,cookie,&request,now,&batch));CHECK(bridge.enabled&&!bridge.lease.expires);
 // Every write failure, including an accepted-but-reported-failed write, is
 // uncertain and yields no events to act on. No retry follows inside exchange.
 for(partialWrite=0;partialWrite<=1;partialWrite++){
  int partial=partialWrite;
  for(int failure=1;failure<=5;failure++){
   setup();partialWrite=partial;failWrite=failure;request=(TacPadRequest){7,TAC_PAD_CAPTURE,4,2};
   CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==-1);CHECK(empty(&batch)&&writes==failure);
   CHECK(!bridge.lease.expires||bridge.lease.expires<=now+400000000);
  }
  partialWrite=partial;
 }
 for(int failure=1;failure<=4;failure++){
  setup();failRead=failure;CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==(failure<=2?1:-1));CHECK(empty(&batch));
 }
 setup();bridge.cookie++;CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==1&&writes==0);
 setup();bridge.faultEpoch=7;CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==1&&writes==0);
 request.mode=TAC_PAD_OFF;CHECK(!tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)&&!bridge.enabled);request.mode=TAC_PAD_CAPTURE;
 setup();bridge.written=129;CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==1&&writes==0);
 setup();timeNow=now+100000001;CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==1&&writes==0);
 setup();timeNow=now-1;CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==1&&writes==0);
 setup();mutate=2;CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==1&&writes==0);
 setup();bridge.enabled=1;bridge.lease.epoch=7;events(0,1);bridge.events[0].sequence=999;
 CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==1&&empty(&batch)&&writes==0);
 setup();bridge.enabled=1;bridge.lease.epoch=7;events(0,1);bridge.events[0].time=now+1;
 CHECK(tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)==1&&empty(&batch)&&writes==0);
 setup();bridge.lease.revision=UINT32_MAX;bridge.lease.epoch=7;
 CHECK(!tac_pad_exchange(&ops,arena,cookie,&request,now,&batch)&&batch.reset&&bridge.lease.revision==2);
 unsigned char bytes[100];memset(bytes,0x42,sizeof bytes);TacUserWriter writer={NULL,current,translate,physical};
 for(broken=0;broken<=3;broken++){
  memset(destination,0xaa,sizeof destination);identityCalls=translations=physicalCalls=0;
  CHECK(tac_user_write(&writer,4000,200,4080,bytes,100)==(broken?-1:0));
  CHECK(destination[4079]==0xaa&&destination[4180]==0xaa);
  if(!broken){CHECK(translations==2&&physicalCalls==2);for(unsigned i=4080;i<4180;i++)CHECK(destination[i]==0x42);}
 }
 broken=0;physicalCalls=0;
 CHECK(tac_user_write(&writer,4000,100,4080,bytes,100)==-1&&!physicalCalls);
 CHECK(tac_user_write(&writer,4000,100,3999,bytes,1)==-1&&!physicalCalls);
 CHECK(tac_user_write(&writer,UINT64_MAX-5,100,UINT64_MAX-5,bytes,1)==-1&&!physicalCalls);
 puts("Private pad exchange, interrupted publication, cursor wrap and bounded writes passed");return 0;
}
