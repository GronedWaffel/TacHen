// SPDX-License-Identifier: GPL-3.0-or-later
#include "update-core.h"
#include "check.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void roundtrip(TacUpdateState *s){TacUpdateState restored;s->revision++;tac_update_seal(s);CHECK(!tac_update_decode(s,sizeof *s,&restored));CHECK(!memcmp(s,&restored,sizeof *s));}
static TacUpdateHeader different(TacUpdateHeader h,unsigned n){h.payload_hash[0]^=(uint8_t)n;h.source_hash[0]^=(uint8_t)n;tac_update_digest(&h,offsetof(TacUpdateHeader,checksum),h.checksum);return h;}
int main(int argc,char **argv){
  if(argc!=2)return 2;FILE *f=fopen(argv[1],"rb");CHECK(f);CHECK(!fseek(f,0,SEEK_END));long n=ftell(f);CHECK(n>256&&(uint64_t)n<TAC_UPDATE_LIMIT+256);rewind(f);
  uint8_t *bytes=malloc((size_t)n);CHECK(bytes);CHECK(fread(bytes,1,n,f)==(size_t)n);fclose(f);TacUpdateHeader h;
  if(tac_update_image(bytes,(size_t)n,0x13600000,&h)){puts("rejected");free(bytes);return 0;}
  CHECK(!tac_update_supported(&h,0x11400000));CHECK(!tac_update_supported(&h,0x10000000));
  TacUpdateState s;tac_update_init(&s);roundtrip(&s);
  TacUpdateState virgin=s;TacUpdateHeader first_trial=different(h,7);CHECK(!tac_update_stage(&virgin,&first_trial,virgin.revision));CHECK(tac_update_arm(&virgin,virgin.revision));
  CHECK(!tac_update_discard(&virgin,virgin.revision));roundtrip(&virgin);CHECK(virgin.phase==TAC_UPDATE_IDLE);
  CHECK(!tac_update_plan(&s,100,20,&h));CHECK(s.attempt_kind==TAC_BOOT_BASELINE);CHECK(s.good.bytes==0);roundtrip(&s);
  // A persisted intent with no PID must never be interpreted as a good build.
  CHECK(tac_update_plan(&s,100,20,&h));CHECK(tac_update_ack(&s,100,20,12,h.source_hash));
  s.pid=12;roundtrip(&s);CHECK(tac_update_ack(&s,101,20,12,h.source_hash));CHECK(tac_update_ack(&s,100,20,13,h.source_hash));
  uint8_t wrong[32]={1};CHECK(tac_update_ack(&s,100,20,12,wrong));CHECK(!tac_update_ack(&s,100,20,12,h.source_hash));roundtrip(&s);
  CHECK(!memcmp(&s.good,&h,sizeof h));CHECK(s.previous.bytes==0);
  TacUpdateHeader candidate=different(h,3);CHECK(tac_update_stage(&s,&candidate,s.revision-1));CHECK(!tac_update_stage(&s,&candidate,s.revision));roundtrip(&s);
  CHECK(tac_update_stage(&s,&h,s.revision));CHECK(s.phase==TAC_UPDATE_STAGED);
  CHECK(!tac_update_plan(&s,200,0,&h));CHECK(!memcmp(&s.attempt,&h,sizeof h));CHECK(s.phase==TAC_UPDATE_STAGED);roundtrip(&s);
  CHECK(!tac_update_arm(&s,s.revision));roundtrip(&s);CHECK(tac_update_plan(&s,200,0,&h));
  CHECK(!tac_update_plan(&s,300,0,&h));CHECK(s.phase==TAC_UPDATE_TRIAL);CHECK(!memcmp(&s.attempt,&candidate,sizeof h));roundtrip(&s);
  CHECK(tac_update_discard(&s,s.revision));
  // Simulated lost power / missing startup acknowledgement: fallback next boot.
  CHECK(!tac_update_plan(&s,400,0,&h));CHECK(s.phase==TAC_UPDATE_IDLE);CHECK(s.attempt_kind==TAC_BOOT_ROLLBACK);CHECK(!memcmp(&s.attempt,&h,sizeof h));roundtrip(&s);
  CHECK(!tac_update_stage(&s,&candidate,s.revision));roundtrip(&s);CHECK(!tac_update_arm(&s,s.revision));roundtrip(&s);
  CHECK(!tac_update_plan(&s,500,0,&h));s.pid=25;roundtrip(&s);CHECK(!tac_update_ack(&s,500,0,25,candidate.source_hash));roundtrip(&s);
  CHECK(!memcmp(&s.good,&candidate,sizeof h));CHECK(!memcmp(&s.previous,&h,sizeof h));CHECK(s.phase==TAC_UPDATE_IDLE);
  CHECK(!tac_update_revert(&s,s.revision));roundtrip(&s);CHECK(!tac_update_plan(&s,600,0,&h));CHECK(!memcmp(&s.attempt,&h,sizeof h));
  // Corrupt or missing selection can only fall back before dispatch.
  CHECK(!tac_update_fallback(&s,&candidate));s.pid=28;CHECK(tac_update_fallback(&s,&h));roundtrip(&s);
  TacUpdateState bad=s;bad.good.payload_hash[0]^=1;CHECK(tac_update_decode(&bad,sizeof bad,&bad));
  bad=s;bad.phase=TAC_UPDATE_TRIAL;tac_update_seal(&bad);CHECK(tac_update_decode(&bad,sizeof bad,&bad));
  bad=s;bad.attempt_kind=TAC_BOOT_NONE;tac_update_seal(&bad);CHECK(tac_update_decode(&bad,sizeof bad,&bad));
  CHECK(tac_update_decode(&s,sizeof s-1,&bad));free(bytes);puts("accepted; update selection transitions passed");return 0;
}
