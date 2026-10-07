// SPDX-License-Identifier: GPL-3.0-or-later
#include "check.h"
#include "memory-map.h"
#include <string.h>
typedef struct {uint64_t address;unsigned char bytes[0x500];} Region;
static Region regions[10];static int calls,failAt;
#define K(n) (UINT64_C(0xffff800000010000)+(n)*UINT64_C(0x1000))
static void number(unsigned region,unsigned offset,uint64_t n){memcpy(regions[region].bytes+offset,&n,8);}
static int readmem(void *context,uint64_t address,void *bytes,size_t length){
  (void)context;if(++calls==failAt)return -1;
  for(unsigned i=0;i<10;i++)if(address>=regions[i].address&&address-regions[i].address<=sizeof regions[i].bytes&&
    length<=sizeof regions[i].bytes-(address-regions[i].address)){
      memcpy(bytes,regions[i].bytes+(address-regions[i].address),length);return 0;
    }
  return -1;
}
static const TacMemoryReader reader={NULL,readmem};
static void reset(void){
  memset(regions,0,sizeof regions);for(unsigned i=0;i<10;i++)regions[i].address=K(i);calls=failAt=0;
  // proc=0, dynlib root=1, objects=2/3, paths=4/5, vmspace=6, entries=7/8/9.
  number(0,0x3e8,K(1));number(1,0,K(2));number(2,0,K(3));number(2,8,K(4));number(3,8,K(5));
  number(2,0x28,0);number(2,0x30,0x400000);number(2,0x38,0x8000);
  number(3,0x28,7);number(3,0x30,0x500000);number(3,0x38,0x4000);
  strcpy((char*)regions[4].bytes,"/app0/eboot.bin");strcpy((char*)regions[5].bytes,"/system/common/lib/libScePad.sprx");
  number(0,0x200,K(6));number(6,0x100,K(7));
  number(7,8,K(8));number(7,0x18,K(8));number(7,0x20,0x400000);number(7,0x28,0x404000);regions[7].bytes[0x64]=5;
  number(8,8,K(9));number(8,0x18,K(9));number(8,0x20,0x404000);number(8,0x28,0x408000);regions[8].bytes[0x64]=3;
  number(9,0x20,0x500000);number(9,0x28,0x504000);regions[9].bytes[0x64]=0x85;
}
int main(int argc,char **argv){
  (void)argv;if(argc>1)CHECK(0);TacMemoryModule module;TacMemoryMapping span[8];size_t count=42;
  reset();CHECK(!tac_memory_module(&reader,K(0),"eboot.bin",&module));CHECK(module.base==0x400000&&module.size==0x8000&&module.handle==0&&module.object==K(2));
  number(2,0x30,0x600000);CHECK(!tac_memory_module(&reader,K(0),"eboot.bin",&module));CHECK(module.base==0x600000);
  reset();CHECK(tac_memory_module(&reader,K(0),"not.bin",&module)==TAC_MEMORY_MISSING);CHECK(module.base==0);
  reset();strcpy((char*)regions[5].bytes,"/other/eboot.bin");CHECK(tac_memory_module(&reader,K(0),"eboot.bin",&module)==TAC_MEMORY_AMBIGUOUS);CHECK(module.object==0);
  reset();number(3,0,K(3));CHECK(tac_memory_module(&reader,K(0),"eboot.bin",&module)==TAC_MEMORY_LIMIT);
  reset();memset(regions[4].bytes,'a',1024);CHECK(tac_memory_module(&reader,K(0),"eboot.bin",&module)==TAC_MEMORY_LIMIT);
  reset();number(2,0x30,UINT64_MAX-10);CHECK(tac_memory_module(&reader,K(0),"eboot.bin",&module)==TAC_MEMORY_INVALID);
  reset();number(2,0x28,UINT64_C(1)<<32);CHECK(tac_memory_module(&reader,K(0),"eboot.bin",&module)==TAC_MEMORY_INVALID);
  reset();number(1,0,K(2)+1);CHECK(tac_memory_module(&reader,K(0),"eboot.bin",&module)==TAC_MEMORY_INVALID);
  reset();CHECK(tac_memory_module(&reader,K(0),"/eboot.bin",&module)==TAC_MEMORY_INVALID);CHECK(!calls);
  reset();failAt=3;CHECK(tac_memory_module(&reader,K(0),"eboot.bin",&module)==TAC_MEMORY_READ);
  reset();CHECK(!tac_memory_span(&reader,K(0),0x100,0x403ff0,32,span,8,&count));CHECK(count==2&&span[0].protection==5&&span[1].protection==3);
  reset();CHECK(!tac_memory_span(&reader,K(0),0x100,0x500000,1,span,8,&count));CHECK(count==1&&span[0].protection==0x85);
  reset();CHECK(tac_memory_span(&reader,K(0),0x100,0x403ff0,32,span,1,&count)==TAC_MEMORY_LIMIT);CHECK(count==0);
  reset();number(8,0x20,0x404010);CHECK(tac_memory_span(&reader,K(0),0x100,0x403ff0,32,span,8,&count)==TAC_MEMORY_GAP);CHECK(count==0);
  reset();number(8,0x20,0x403fff);CHECK(tac_memory_span(&reader,K(0),0x100,0x403ff0,32,span,8,&count)==TAC_MEMORY_GAP);
  reset();CHECK(tac_memory_span(&reader,K(0),0x100,0x407fff,2,span,8,&count)==TAC_MEMORY_GAP);
  reset();number(7,0x18,K(7));CHECK(tac_memory_span(&reader,K(0),0x100,0x500000,1,span,8,&count)==TAC_MEMORY_LIMIT);
  reset();number(9,0x18,K(7));CHECK(tac_memory_span(&reader,K(0),0x100,0x600000,1,span,8,&count)==TAC_MEMORY_LIMIT);CHECK(calls==4098);
  reset();number(7,0x20,0);number(7,0x28,0x10000);CHECK(!tac_memory_span(&reader,K(0),0x100,0x500000,1,span,8,&count)); // zero guard maps may exist in search tree
  reset();failAt=3;CHECK(tac_memory_span(&reader,K(0),0x100,0x400000,1,span,8,&count)==TAC_MEMORY_READ);
  reset();CHECK(tac_memory_span(&reader,K(0),0x100,0x600000,1,span,8,&count)==TAC_MEMORY_MISSING);
  reset();number(6,0x100,0x10000);CHECK(tac_memory_span(&reader,K(0),0x100,0x400000,1,span,8,&count)==TAC_MEMORY_INVALID);
  reset();number(7,0x28,0x400000);CHECK(tac_memory_span(&reader,K(0),0x100,0x400000,1,span,8,&count)==TAC_MEMORY_INVALID);
  reset();CHECK(tac_memory_span(&reader,K(0),0x100,UINT64_MAX,4,span,8,&count)==TAC_MEMORY_INVALID);CHECK(!calls);
  reset();CHECK(tac_memory_span(&reader,K(0),0x100,0x8000,4,span,8,&count)==TAC_MEMORY_INVALID);
  reset();CHECK(tac_memory_span(&reader,K(0),0x100,0x400000,0,span,8,&count)==TAC_MEMORY_INVALID);
  puts("Bounded module and complete memory mapping inspection passed");return 0;
}
