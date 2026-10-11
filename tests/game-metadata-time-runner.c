#include "game-metadata-time.h"
#include "check.h"
#include <stdio.h>
int main(int argc,char** argv){
 (void)argv;if(argc>1)CHECK(0);
 CHECK(tac_metadata_predates_process(999,999999999,999,999999999,1000,0));
 CHECK(tac_metadata_predates_process(1000,500000,1000,500000,1000,500));
 CHECK(!tac_metadata_predates_process(1000,500001,999,0,1000,500));
 CHECK(!tac_metadata_predates_process(999,0,1000,500001,1000,500));
 CHECK(!tac_metadata_predates_process(1001,0,999,0,1000,500));
 CHECK(!tac_metadata_predates_process(999,0,1001,0,1000,500));
 CHECK(!tac_metadata_predates_process(0,0,999,0,1000,500));
 CHECK(!tac_metadata_predates_process(999,0,0,0,1000,500));
 CHECK(!tac_metadata_predates_process(999,-1,999,0,1000,500));
 CHECK(!tac_metadata_predates_process(999,0,999,1000000000,1000,500));
 CHECK(!tac_metadata_predates_process(999,0,999,0,1000,1000000));
 CHECK(!tac_metadata_predates_process(999,0,999,0,-1,0));
 puts("Registered metadata timing checks passed");return 0;
}
