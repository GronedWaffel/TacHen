// SPDX-License-Identifier: GPL-3.0-or-later
#include "update-core.h"
#include "firmware-profiles.h"
#include "check.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void roundtrip(TacUpdateState *s){TacUpdateState restored;s->revision++;tac_update_seal(s);CHECK(!tac_update_decode(s,sizeof *s,&restored));CHECK(!memcmp(s,&restored,sizeof *s));}
static TacUpdateHeader different(TacUpdateHeader h,unsigned n){h.payload_hash[0]^=(uint8_t)n;h.source_hash[0]^=(uint8_t)n;tac_update_digest(&h,offsetof(TacUpdateHeader,checksum),h.checksum);return h;}
static void bundled_tests(TacUpdateHeader old){
  TacUpdateHeader fresh=different(old,11),other=different(old,12);
  TacUpdateState s;tac_update_init(&s);s.good=old;roundtrip(&s);
  // Reproduce the delivery issue: the normal launcher chooses saved good.
  TacUpdateState normal=s;CHECK(!tac_update_plan(&normal,100,0,&fresh));CHECK(!memcmp(&normal.attempt,&old,sizeof old));
  CHECK(!tac_update_plan_bundled(&s,100,0,&fresh));roundtrip(&s);
  CHECK(s.phase==TAC_UPDATE_TRIAL);CHECK(s.attempt_kind==TAC_BOOT_TRIAL);CHECK(s.pid==0);
  CHECK(!memcmp(&s.attempt,&fresh,sizeof fresh));CHECK(!memcmp(&s.candidate,&fresh,sizeof fresh));CHECK(!memcmp(&s.good,&old,sizeof old));
  TacUpdateState saved=s;CHECK(tac_update_plan_bundled(&s,100,0,&other));CHECK(!memcmp(&s,&saved,sizeof s));
  CHECK(tac_update_plan_bundled(&s,0,0,&fresh));CHECK(tac_update_plan_bundled(&s,101,1000000,&fresh));CHECK(!memcmp(&s,&saved,sizeof s));
  TacUpdateHeader invalid=fresh;invalid.payload_hash[0]^=1;CHECK(tac_update_plan_bundled(&s,101,0,&invalid));CHECK(!memcmp(&s,&saved,sizeof s));
  // A failed embedded trial still rolls back with the regular launcher.
  normal=s;CHECK(!tac_update_plan(&normal,101,0,&fresh));CHECK(normal.attempt_kind==TAC_BOOT_ROLLBACK);CHECK(!memcmp(&normal.attempt,&old,sizeof old));roundtrip(&normal);
  // Explicit new-boot retest uses the embedded image without losing good.
  CHECK(!tac_update_plan_bundled(&s,101,0,&fresh));roundtrip(&s);CHECK(!memcmp(&s.good,&old,sizeof old));
  s.pid=42;CHECK(tac_update_ack(&s,101,0,42,old.source_hash));CHECK(!tac_update_ack(&s,101,0,42,fresh.source_hash));roundtrip(&s);
  CHECK(!memcmp(&s.good,&fresh,sizeof fresh));CHECK(!memcmp(&s.previous,&old,sizeof old));CHECK(s.phase==TAC_UPDATE_IDLE);
  CHECK(!tac_update_plan_bundled(&s,102,0,&fresh));CHECK(s.attempt_kind==TAC_BOOT_BASELINE);roundtrip(&s);
  CHECK(!tac_update_stage(&s,&other,s.revision));saved=s;
  CHECK(tac_update_plan_bundled(&s,103,0,&fresh)==-2);CHECK(!memcmp(&s,&saved,sizeof s));
  CHECK(!tac_update_arm(&s,s.revision));saved=s;
  CHECK(tac_update_plan_bundled(&s,103,0,&fresh)==-2);CHECK(!memcmp(&s,&saved,sizeof s));
  CHECK(!tac_update_plan_bundled(&s,103,0,&other));CHECK(!memcmp(&s.attempt,&other,sizeof other));roundtrip(&s);
  tac_update_init(&s);CHECK(!tac_update_plan_bundled(&s,200,0,&fresh));roundtrip(&s);CHECK(!s.good.bytes);
  s.pid=43;CHECK(!tac_update_ack(&s,200,0,43,fresh.source_hash));roundtrip(&s);CHECK(!memcmp(&s.good,&fresh,sizeof fresh));CHECK(!s.previous.bytes);
}
int main(int argc,char **argv){
  if(argc==3&&!strcmp(argv[1],"--headers")){
    FILE *f=fopen(argv[2],"rb");CHECK(f);uint32_t expected;unsigned count=0;
    while(fread(&expected,sizeof expected,1,f)==1){
      TacUpdateHeader raw,h;CHECK(fread(&raw,sizeof raw,1,f)==1);CHECK(!tac_update_header(&raw,sizeof raw,&h));
      for(unsigned i=0;i<sizeof snipers_firmware_profiles/sizeof snipers_firmware_profiles[0];i++){
        uint32_t fw=snipers_firmware_profiles[i].code;
        CHECK(tac_update_supported(&h,fw)==(fw==expected));
        CHECK(tac_update_supported(&h,fw|7)==(fw==expected));
      }
      CHECK(!tac_update_supported(&h,0x14000000));CHECK(!tac_update_supported(&h,0x1030000));count++;
    }
    CHECK(feof(f));fclose(f);CHECK(count==67);puts("All 67 one-bit profiles passed without aliases");return 0;
  }
  if(argc!=2)return 2;FILE *f=fopen(argv[1],"rb");CHECK(f);CHECK(!fseek(f,0,SEEK_END));long n=ftell(f);CHECK(n>256&&(uint64_t)n<TAC_UPDATE_LIMIT+256);rewind(f);
  uint8_t *bytes=malloc((size_t)n);CHECK(bytes);CHECK(fread(bytes,1,n,f)==(size_t)n);fclose(f);TacUpdateHeader h;
  if(tac_update_image(bytes,(size_t)n,0x13600000,&h)){puts("rejected");free(bytes);return 0;}
  CHECK(!tac_update_supported(&h,0x14000000));CHECK(!tac_update_supported(&h,0x13610000));
  bundled_tests(h);
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
