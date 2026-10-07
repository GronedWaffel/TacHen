#include "kstuff-state.h"
#include "firmware-profiles.h"
#include "check.h"
#include <stdio.h>
int main(int argc,char** argv){
  (void)argv;if(argc>1)CHECK(0);
  uint64_t base=UINT64_C(0xffffffff80000000);
  for(unsigned i=0;i<sizeof(snipers_firmware_profiles)/sizeof(snipers_firmware_profiles[0]);i++){
    const SnipersFirmwareProfile *p=&snipers_firmware_profiles[i];
    TacKstuffSnapshot s={.native=base+p->sysents,.compat=base+p->sysentsPs4,
      .expected_native=base+p->sysents,.expected_compat=base+p->sysentsPs4,.xts=0xffff,.hmac=0xffff,.readable=1};
    CHECK(tac_kstuff_classify(base,&s)==TAC_KSTUFF_UNMODIFIED);
    CHECK(tac_kstuff_injection_ready(base,&s));
    s.native+=0x4000;CHECK(tac_kstuff_classify(base,&s)==TAC_KSTUFF_UNKNOWN);
    s.compat+=0x4000;s.xts=s.hmac=0xdeb7;
    CHECK(tac_kstuff_classify(base,&s)==TAC_KSTUFF_INSTALLED && tac_kstuff_injection_ready(base,&s));
    s.native=(s.native&UINT64_C(0xffffffffffff))|UINT64_C(0xdeb7000000000000);
    CHECK(tac_kstuff_classify(base,&s)==TAC_KSTUFF_INSTALLED && !tac_kstuff_injection_ready(base,&s));
    s.readable=0;CHECK(tac_kstuff_classify(base,&s)==TAC_KSTUFF_UNKNOWN);
    CHECK(snipers_firmware_profile(p->code)==p);
  }
  CHECK(!snipers_firmware_profile(0x11400000));CHECK(!snipers_firmware_profile(0x10010000));CHECK(!snipers_firmware_profile(0x13610000));
  puts("All supported profile classifiers passed; partial, poisoned and unreadable hooks withheld.");return 0;
}
