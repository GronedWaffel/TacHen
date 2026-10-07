// SPDX-License-Identifier: GPL-3.0-or-later
#include "update-core.h"
#include "sha256.h"
#include "elf-image.h"
#include <string.h>
#define STATE_MAGIC UINT32_C(0x55544354)
static int zero(const void *p,size_t n){const uint8_t *b=p;for(size_t i=0;i<n;i++)if(b[i])return 0;return 1;}
void tac_update_digest(const void *p,size_t n,uint8_t out[32]){SHA256_CTX h;sha256_init(&h);sha256_update(&h,p,n);sha256_final(&h,out);}
void tac_update_hex(const uint8_t hash[32],char out[65]){const char *digits="0123456789abcdef";for(unsigned i=0;i<32;i++){out[i*2]=digits[hash[i]>>4];out[i*2+1]=digits[hash[i]&15];}out[64]=0;}
int tac_update_unhex(const char *s,uint8_t out[32]){if(!s||strlen(s)!=64)return -1;for(unsigned i=0;i<32;i++){unsigned v=0;for(unsigned j=0;j<2;j++){char c=s[i*2+j];if(c>='0'&&c<='9')v=v*16+c-'0';else if(c>='a'&&c<='f')v=v*16+c-'a'+10;else return -1;}out[i]=(uint8_t)v;}return 0;}
int tac_update_header(const void *raw,size_t size,TacUpdateHeader *out){
  if(!raw||size<sizeof *out)return -1;TacUpdateHeader h;memcpy(&h,raw,sizeof h);uint8_t digest[32];tac_update_digest(&h,offsetof(TacUpdateHeader,checksum),digest);
  if(memcmp(h.magic,"TACUPD01",8)||h.version!=1||h.header_size!=256||h.state_schema!=1||h.bytes<64||h.bytes>TAC_UPDATE_LIMIT||
     !h.firmware_mask||(h.firmware_mask&~TAC_UPDATE_MASK)||zero(h.payload_hash,32)||zero(h.source_hash,32)||
     !zero(h.reserved,sizeof h.reserved)||memcmp(h.checksum,digest,32))return -1;
  size_t n=0;for(;n<sizeof h.label&&h.label[n];n++)if(h.label[n]<32||h.label[n]>126)return -1;
  if(!n||n==sizeof h.label||!zero(h.label+n,sizeof h.label-n))return -1;
  *out=h;return 0;
}
int tac_update_supported(const TacUpdateHeader *h,uint32_t fw){
  static const uint32_t profiles[]={0x11000000,0x11200000,0x11600000,0x12000000,0x12020000,0x12200000,0x12400000,0x12600000,0x12700000,0x13000000,0x13200000,0x13400000,0x13420000,0x13600000};
  fw&=0xffff0000;for(unsigned i=0;i<sizeof profiles/sizeof profiles[0];i++)if(profiles[i]==fw)return !!(h->firmware_mask&(1u<<i));return 0;
}
int tac_update_image(const void *raw,size_t size,uint32_t fw,TacUpdateHeader *out){
  TacUpdateHeader h;if(tac_update_header(raw,size,&h)||size!=sizeof h+h.bytes||!tac_update_supported(&h,fw))return -1;
  const uint8_t *elf=(const uint8_t*)raw+sizeof h;uint8_t digest[32];tac_update_digest(elf,(size_t)h.bytes,digest);
  TacElfImage image;char error[192];if(memcmp(h.payload_hash,digest,32)||tac_elf_inspect(elf,(size_t)h.bytes,&image,error,sizeof error))return -1;
  *out=h;return 0;
}
void tac_update_init(TacUpdateState *s){memset(s,0,sizeof *s);s->magic=STATE_MAGIC;s->version=1;}
void tac_update_seal(TacUpdateState *s){tac_update_digest(s,offsetof(TacUpdateState,checksum),s->checksum);}
static int optional_header(const TacUpdateHeader *h){TacUpdateHeader out;return zero(h,sizeof *h)||!tac_update_header(h,sizeof *h,&out);}
int tac_update_decode(const void *raw,size_t size,TacUpdateState *out){
  if(size!=sizeof *out)return -1;TacUpdateState s;memcpy(&s,raw,sizeof s);uint8_t sum[32];tac_update_digest(&s,offsetof(TacUpdateState,checksum),sum);
  if(s.magic!=STATE_MAGIC||s.version!=1||s.phase>TAC_UPDATE_TRIAL||s.reserved||s.revision>INT64_MAX||memcmp(sum,s.checksum,32)||
     !optional_header(&s.good)||!optional_header(&s.previous)||!optional_header(&s.candidate)||!optional_header(&s.attempt)||
     s.boot_sec<0||s.boot_usec<0||s.boot_usec>=1000000||s.pid<0||s.attempt_kind>TAC_BOOT_ROLLBACK)return -1;
  if((s.phase==TAC_UPDATE_IDLE)!=zero(&s.candidate,sizeof s.candidate))return -1;
  if(s.attempt_kind==TAC_BOOT_NONE){if(s.boot_sec||s.boot_usec||s.pid||!zero(&s.attempt,sizeof s.attempt))return -1;}
  else if(!s.boot_sec||zero(&s.attempt,sizeof s.attempt))return -1;
  if(s.phase==TAC_UPDATE_TRIAL&&(s.attempt_kind!=TAC_BOOT_TRIAL||memcmp(&s.attempt,&s.candidate,sizeof s.attempt)))return -1;
  *out=s;return 0;
}
int tac_update_stage(TacUpdateState *s,const TacUpdateHeader *header,uint64_t revision){
  TacUpdateHeader h;if(s->revision!=revision||s->phase!=TAC_UPDATE_IDLE||tac_update_header(header,sizeof *header,&h)||!memcmp(h.payload_hash,s->good.payload_hash,32))return -1;
  s->candidate=h;s->phase=TAC_UPDATE_STAGED;return 0;
}
int tac_update_arm(TacUpdateState *s,uint64_t revision){if(s->revision!=revision||s->phase!=TAC_UPDATE_STAGED||!s->good.bytes)return -1;s->phase=TAC_UPDATE_ARMED;return 0;}
int tac_update_discard(TacUpdateState *s,uint64_t revision){if(s->revision!=revision||s->phase==TAC_UPDATE_TRIAL)return -1;s->phase=TAC_UPDATE_IDLE;memset(&s->candidate,0,sizeof s->candidate);return 0;}
int tac_update_retirable(const TacUpdateState *s,const uint8_t hash[32],uint64_t revision){
  if(s->revision!=revision||zero(hash,32))return -1;
  const TacUpdateHeader *keep[]={&s->good,&s->previous,&s->candidate,&s->attempt};
  for(unsigned i=0;i<sizeof keep/sizeof keep[0];i++)if(keep[i]->bytes&&!memcmp(hash,keep[i]->payload_hash,32))return -1;
  return 0;
}
int tac_update_revert(TacUpdateState *s,uint64_t revision){
  if(s->revision!=revision)return -1;
  // A failed trial returns to the last confirmed build; a confirmed update can
  // request its previous build. Both changes are deferred to another boot.
  const TacUpdateHeader *target=s->phase==TAC_UPDATE_TRIAL?&s->good:&s->previous;
  if(zero(target,sizeof *target))return -1;s->candidate=*target;s->phase=TAC_UPDATE_ARMED;return 0;
}
int tac_update_plan(TacUpdateState *s,int64_t sec,int64_t usec,const TacUpdateHeader *fallback){
  TacUpdateHeader h;if(sec<=0||usec<0||usec>=1000000||tac_update_header(fallback,sizeof *fallback,&h)||
     (s->attempt_kind&&s->boot_sec==sec&&s->boot_usec==usec))return -1;
  unsigned kind=TAC_BOOT_BASELINE;
  if(s->phase==TAC_UPDATE_TRIAL){s->phase=TAC_UPDATE_IDLE;memset(&s->candidate,0,sizeof s->candidate);kind=TAC_BOOT_ROLLBACK;}
  if(s->phase==TAC_UPDATE_ARMED){s->attempt=s->candidate;s->phase=TAC_UPDATE_TRIAL;kind=TAC_BOOT_TRIAL;}
  else s->attempt=zero(&s->good,sizeof s->good)?h:s->good;
  s->boot_sec=sec;s->boot_usec=usec;s->pid=0;s->attempt_kind=kind;return 0;
}
int tac_update_fallback(TacUpdateState *s,const TacUpdateHeader *fallback){
  TacUpdateHeader h;if(tac_update_header(fallback,sizeof *fallback,&h)||s->pid)return -1;
  s->attempt=h;s->attempt_kind=TAC_BOOT_ROLLBACK;s->phase=TAC_UPDATE_IDLE;memset(&s->candidate,0,sizeof s->candidate);return 0;
}
int tac_update_ack(TacUpdateState *s,int64_t sec,int64_t usec,int32_t pid,const uint8_t source[32]){
  if(!s->attempt_kind||s->boot_sec!=sec||s->boot_usec!=usec||pid<=0||s->pid!=pid||memcmp(source,s->attempt.source_hash,32))return -1;
  if(memcmp(s->good.payload_hash,s->attempt.payload_hash,32)){s->previous=s->good;s->good=s->attempt;}
  if(s->phase==TAC_UPDATE_TRIAL){s->phase=TAC_UPDATE_IDLE;memset(&s->candidate,0,sizeof s->candidate);}return 0;
}
