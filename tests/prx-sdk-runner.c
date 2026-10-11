// SPDX-License-Identifier: GPL-3.0-or-later
#include "prx-image.h"
#include "elf-image.h"
#include "check.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void put32(unsigned char *p,uint32_t v){memcpy(p,&v,4);}
static void put64(unsigned char *p,uint64_t v){memcpy(p,&v,8);}
static void fixture(unsigned char *p){
  memset(p,0,1024);put32(p,0x1d3d154f);put64(p+16,1024);p[24]=1;
  put64(p+32,0x2804);put64(p+40,512);put64(p+48,256);put64(p+56,256);
  TacElfHeader h={0};memcpy(h.ident,"\177ELF\2\1\1",7);h.ident[7]=9;h.ident[8]=2;
  h.type=0xfe18;h.machine=62;h.version=1;h.phoff=64;h.ehsize=64;h.phentsize=56;h.phnum=3;memcpy(p+64,&h,64);
  TacElfProgram load={.type=1,.flags=5,.offset=0x1000,.vaddr=0x1000,.filesz=256,.memsz=256,.align=0x1000};
  TacElfProgram dyn={.type=2,.offset=0x1080,.filesz=32};
  TacElfProgram param={.type=0x61000002,.offset=0x1040,.filesz=32,.memsz=32};
  memcpy(p+128,&load,56);memcpy(p+184,&dyn,56);memcpy(p+240,&param,56);
  put64(p+304+8,1);put64(p+576,32);put32(p+584,0x3c13f4bf);put32(p+588,3);put32(p+592,0x09040001);put32(p+596,0x04000031);
}
int main(int argc,char **argv){
  if(argc==2)CHECK(0);
  // Optional private fixture validation; copyrighted plugin bytes are not
  // included in this repository or required by its regression suite.
  if(argc==4){FILE*f=fopen(argv[1],"rb");CHECK(f);fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);unsigned char*p=malloc(n);CHECK(p&&fread(p,1,n,f)==(size_t)n);fclose(f);uint32_t before;
    CHECK(tac_prx_match_host_sdk(p,n,0x03000027,0x13600007,&before)==1&&before==0x04000031);f=fopen(argv[2],"wb");CHECK(f&&fwrite(p,1,n,f)==(size_t)n);fclose(f);free(p);return 0;}
  unsigned char p[1024],original[1024],param[32]={0};uint32_t old;
  fixture(p);memcpy(original,p,sizeof p);CHECK(tac_prx_match_host_sdk(p,sizeof p,0x03000027,0x13600007,&old)==1&&old==0x04000031);
  put32(original+596,0x03000027);CHECK(!memcmp(p,original,sizeof p));
  CHECK(tac_prx_match_host_sdk(p,sizeof p,0x03000027,0x13600007,&old)==0);
  fixture(p);memcpy(original,p,sizeof p);CHECK(!tac_prx_match_host_sdk(p,sizeof p,0,0x13600007,&old)&&!memcmp(p,original,sizeof p));
  CHECK(!tac_prx_match_host_sdk(p,sizeof p,0x05000000,0x13600007,&old)&&!memcmp(p,original,sizeof p));
  CHECK(!tac_prx_match_host_sdk(p,sizeof p,0x03000027,0x03000000,&old)&&!memcmp(p,original,sizeof p));
  p[72]=1;memcpy(original,p,sizeof p);CHECK(!tac_prx_match_host_sdk(p,sizeof p,0x03000027,0x13600007,&old)&&!memcmp(p,original,sizeof p)); // PS4 ABI.
  fixture(p);put64(p+312,2);memcpy(original,p,sizeof p);CHECK(!tac_prx_match_host_sdk(p,sizeof p,0x03000027,0x13600007,&old)&&!memcmp(p,original,sizeof p)); // Retail SELF.
  fixture(p);put64(p+56,512);memcpy(original,p,sizeof p);CHECK(!tac_prx_match_host_sdk(p,sizeof p,0x03000027,0x13600007,&old)&&!memcmp(p,original,sizeof p)); // Compressed layout.
  fixture(p);put32(p+584,0);CHECK(tac_prx_match_host_sdk(p,sizeof p,0x03000027,0x13600007,&old)<0);
  fixture(p);put64(p+48,70);put64(p+56,70);CHECK(tac_prx_match_host_sdk(p,sizeof p,0x03000027,0x13600007,&old)<0);
  CHECK(tac_prx_match_host_sdk(NULL,0,0x03000027,0x13600007,&old)<0);
  put64(param,96);put32(param+8,0x4942524f);put32(param+12,5);put32(param+20,0x03000027);
  CHECK(tac_ps5_process_sdk(param,sizeof param)==0x03000027);CHECK(!tac_ps5_process_sdk(param,20));
  put32(param+12,1);CHECK(!tac_ps5_process_sdk(param,sizeof param));
  puts("PS5 SDK staging checks passed");return 0;
}
