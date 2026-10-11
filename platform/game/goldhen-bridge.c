// SPDX-License-Identifier: GPL-3.0-or-later
// Only the adapted module calls this private gate. No global syscall hook.
#include "goldhen-bridge.h"
_Static_assert(sizeof(TacGoldhenInfo)==202,"GoldHEN process-info ABI");
_Static_assert(sizeof(TacGoldhenBridge)==48,"GoldHEN mailbox ABI");
__attribute__((section(".text.entry"),noinline))
int TAC_GAME_SYSV tac_goldhen_bridge(TacGoldhenBridge *box,uint64_t command,void *argument){
  if(!box||box->magic!=TAC_GOLDHEN_MAGIC||!box->cookie||!box->sleep||!argument||(command!=4&&command!=5))return -1;
  TacGoldhenSleep pause=(TacGoldhenSleep)(uintptr_t)box->sleep;
  unsigned attempts=0;
  for(;attempts<1000;attempts++){
    unsigned expected=TAC_GH_IDLE;
    if(__atomic_compare_exchange_n(&box->state,&expected,TAC_GH_LOCKED,0,__ATOMIC_ACQUIRE,__ATOMIC_RELAXED))break;
    if(expected==TAC_GH_EXPIRED)return -1;
    pause(10000);
  }
  if(attempts==1000)return -1;
  box->command=command;box->argument=(uintptr_t)argument;box->result=-1;
  __atomic_store_n(&box->state,TAC_GH_PENDING,__ATOMIC_RELEASE);
  for(attempts=0;attempts<1000;attempts++){
    if(__atomic_load_n(&box->state,__ATOMIC_ACQUIRE)==TAC_GH_DONE){
      int result=box->result;__atomic_store_n(&box->state,TAC_GH_IDLE,__ATOMIC_RELEASE);return result;
    }
    pause(10000);
  }
  // Never recycle a timed-out request. A stopped target cannot time out while
  // the host services its request; the host rechecks state after stopping it.
  unsigned expected=TAC_GH_PENDING;
  if(!__atomic_compare_exchange_n(&box->state,&expected,TAC_GH_EXPIRED,0,__ATOMIC_ACQ_REL,__ATOMIC_ACQUIRE)&&expected==TAC_GH_DONE){
    int result=box->result;__atomic_store_n(&box->state,TAC_GH_IDLE,__ATOMIC_RELEASE);return result;
  }
  return -1;
}
