#include "fps-counters.h"
#include "user-read.h"
#include <stdio.h>
#include <string.h>
#define CHECK(x) do { if(!(x)){fprintf(stderr,"CHECK failed at %d: %s\n",__LINE__,#x);return 90;} }while(0)
static unsigned char memory[12+4096*32];static int calls,failAt,changeAt;static size_t maxRead;
static int read_at(void *ctx,uint64_t at,void *out,size_t n){
 (void)ctx;calls++;if(n>maxRead)maxRead=n;if(calls==failAt)return -1;
 if(calls==changeAt){uint32_t size=13;memcpy(memory,&size,4);}
 if(at<UINT64_C(0xfe03b72ec))return -1;uint64_t offset=at-UINT64_C(0xfe03b72ec);
 if(offset>sizeof memory||n>sizeof memory-offset)return -1;memcpy(out,memory+offset,n);return 0;
}
static void setup(uint32_t size,uint32_t index){memset(memory,0,sizeof memory);memcpy(memory,&size,4);memcpy(memory+4,&index,4);calls=failAt=changeAt=0;maxRead=0;}
static void count(unsigned slot,uint64_t n){memcpy(memory+12+slot*32+8,&n,8);}
static int reads,translated,broken,checks;
static int identity(void *ctx){(void)ctx;checks++;return broken!=3||checks<4;}
static int translate_page(void *ctx,uint64_t at,uint64_t *physical,uint64_t *available){
 (void)ctx;translated++;*physical=at;*available=broken==1?0:8192;return 0;
}
static int read_physical(void *ctx,uint64_t at,void *out,size_t n){
 (void)ctx;reads++;if(broken==2&&reads==2)return -1;
 if(n>4096-(at&4095))return -1;memset(out,0x42,n);return 0;
}
int main(int argc,char **argv){
 if(argc>1&&!strcmp(argv[1],"--fail-check")){CHECK(0);}
 TacCounterReader reader={NULL,read_at};uint64_t value=999;
 setup(10,2);count(3,UINT64_MAX-10);count(4,100);CHECK(!tac_fps_ring(&reader,&value));CHECK(value==UINT64_MAX-10&&calls==3&&maxRead<=3200);
 setup(4096,0);count(4094,123);CHECK(!tac_fps_ring(&reader,&value));CHECK(value==123&&calls==4&&maxRead==8);
 setup(4096,0);count(4000,50);CHECK(tac_fps_ring(&reader,&value)&&value==0&&calls==5);
 setup(4097,0);CHECK(tac_fps_ring(&reader,&value)&&calls==1);
 setup(0,0);CHECK(tac_fps_ring(&reader,&value)&&calls==1);
 setup(10,10);CHECK(tac_fps_ring(&reader,&value)&&calls==1);
 setup(10,0);count(1,20);changeAt=3;CHECK(tac_fps_ring(&reader,&value)&&value==0);
 for(int i=1;i<=3;i++){setup(10,0);count(1,20);failAt=i;CHECK(tac_fps_ring(&reader,&value)&&value==0);}
 TacUserReader user={NULL,identity,translate_page,read_physical};unsigned char buffer[102];
 for(broken=0;broken<=3;broken++){
  memset(buffer,0xaa,sizeof buffer);reads=translated=checks=0;
  int result=tac_user_read(&user,4080,buffer+1,100);CHECK(result==(broken?-1:0));
  CHECK(buffer[0]==0xaa&&buffer[101]==0xaa);
  for(unsigned i=1;i<=100;i++)CHECK(buffer[i]==(broken?0:0x42));
  if(!broken)CHECK(reads==2&&translated==2&&checks==4);
 }
 CHECK(tac_user_read(&user,UINT64_C(0x7fffffffffff),buffer,2)==-1);
 CHECK(tac_user_read(&user,1,buffer,65537)==-1);
 puts("Bounded FPS counter, ring wrap, malformed headers, concurrent resize and read failures passed");return 0;
}
