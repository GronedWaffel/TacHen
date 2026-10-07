// SPDX-License-Identifier: GPL-3.0-or-later
// Container fields follow the credited etaHEN port_prx.h; complete-buffer
// validation also bounds mappings, alignment, overlap and dynamic metadata.
#include "prx-image.h"
#include "elf-image.h"
#include <stdio.h>
#include <string.h>
#define LIMIT (UINT64_C(512)*1024*1024)
static uint16_t u16(const unsigned char *p){uint16_t v;memcpy(&v,p,2);return v;}
static uint32_t u32(const unsigned char *p){uint32_t v;memcpy(&v,p,4);return v;}
static uint64_t u64(const unsigned char *p){uint64_t v;memcpy(&v,p,8);return v;}
int tac_prx_inspect(const void *data,size_t size,int *platform,char *reason,size_t capacity){
  const unsigned char *p=data;size_t off=0;const char *error="Invalid native module container";
  if(!p||!platform||size<64||size>128*1024*1024)goto bad;*platform=0;
  uint32_t magic=u32(p);
  if(magic==0x1d3d154f||magic==0xeef51454){
    *platform=magic==0x1d3d154f?4:5;unsigned count=u16(p+24);off=32+(size_t)count*32;
    if(!count||count>128||off>size-64||u64(p+16)!=size)goto bad;
    for(unsigned i=0;i<count;i++){
      uint64_t at=u64(p+32+i*32+8),length=u64(p+32+i*32+16);
      if(at>size||length>size-at)goto bad;
    }
  }
  TacElfHeader h;memcpy(&h,p+off,sizeof h);size_t available=size-off;
  if(memcmp(h.ident,"\177ELF\2\1\1",7)||h.machine!=62||h.version!=1||h.type!=0xfe18||h.ehsize!=64||h.phentsize!=56||
    !h.phnum||h.phnum>128||h.phoff<64||h.phoff>available||(uint64_t)h.phnum*56>available-h.phoff)goto bad;
  uint64_t starts[128],ends[128],total=0;unsigned ranges=0;int executable=0,dynamic=0;
  for(unsigned i=0;i<h.phnum;i++){
    TacElfProgram ph;memcpy(&ph,p+off+h.phoff+(size_t)i*56,sizeof ph);
    if(ph.type==2||ph.type==0x61000000){
      if(!ph.filesz||(!off&&(ph.offset>available||ph.filesz>available-ph.offset)))goto bad;
      dynamic=1;
    }
    if(ph.type!=1)continue;
    if(ph.filesz>ph.memsz||ph.memsz>LIMIT||total>LIMIT-ph.memsz||ph.memsz>UINT64_MAX-ph.vaddr||
      (!off&&(ph.offset>available||ph.filesz>available-ph.offset))||
      (ph.align>1&&((ph.align&(ph.align-1))||ph.vaddr%ph.align!=ph.offset%ph.align)))goto bad;
    total+=ph.memsz;
    if(ph.memsz){
      for(unsigned j=0;j<ranges;j++)if(ph.vaddr<ends[j]&&starts[j]<ph.vaddr+ph.memsz)goto bad;
      starts[ranges]=ph.vaddr;ends[ranges++]=ph.vaddr+ph.memsz;
    }
    if((ph.flags&1)&&ph.filesz)executable=1;
  }
  if(!executable||!dynamic)goto bad;
  if(reason&&capacity)reason[0]=0;return 0;
bad:
  if(reason&&capacity)snprintf(reason,capacity,"%s",error);return -1;
}
