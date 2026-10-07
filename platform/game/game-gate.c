// SPDX-License-Identifier: GPL-3.0-or-later
// Runs inside the game on a real pad-call thread. No imports, allocation,
// logging, sleep, remote syscalls or background thread are needed by this gate.
// The coordinator fills disabled slots while the target is stopped; only an
// enabled slot can be consumed. A slot is never recycled in the same process.
#include "game-gate.h"
_Static_assert(sizeof(TacGameModule)==272,"Unexpected native module slot ABI");
_Static_assert(offsetof(TacGameGate,modules)==56,"Unexpected native game gate ABI");
__attribute__((section(".text.entry"),noinline))
void TAC_GAME_SYSV tac_game_gate(TacGameGate *control,uint64_t cookie,unsigned lane){
  if(!control||lane>1||control->magic!=TAC_GAME_GATE_MAGIC||control->version!=1||
     control->bytes!=sizeof *control||!cookie||control->cookie!=cookie)return;
  __atomic_fetch_add(&control->callbacks[lane],1,__ATOMIC_RELAXED);
  if(!__atomic_load_n(&control->enabled,__ATOMIC_ACQUIRE)||!control->loadStartModule)return;
  unsigned free=0;
  if(!__atomic_compare_exchange_n(&control->busy,&free,1,0,__ATOMIC_ACQUIRE,__ATOMIC_RELAXED))return;
  for(unsigned i=0;i<TAC_GAME_MODULE_SLOTS;i++){
    TacGameModule *slot=&control->modules[i];unsigned pending=TAC_MODULE_PENDING;
    if(!__atomic_load_n(&slot->enabled,__ATOMIC_ACQUIRE)||
       !__atomic_compare_exchange_n(&slot->state,&pending,TAC_MODULE_STARTING,0,__ATOMIC_ACQ_REL,__ATOMIC_RELAXED))continue;
    // Only content-addressed, private staged module paths are accepted. This
    // guards a partially written slot without doing filesystem I/O on input.
    const char prefix[]="/data/tachen/modules/";unsigned at=0;int valid=1;
    for(;at<sizeof prefix-1;at++)if(slot->path[at]!=prefix[at])valid=0;
    for(unsigned n=0;n<64;n++,at++){unsigned c=(unsigned char)slot->path[at];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))valid=0;}
    if(slot->path[at++]!='.')valid=0;
    if(slot->path[at]=='s')at++;
    if(slot->path[at]!='p'||slot->path[at+1]!='r'||slot->path[at+2]!='x'||slot->path[at+3])valid=0;
    if(!valid){slot->handle=-1;slot->startResult=-1;__atomic_store_n(&slot->state,TAC_MODULE_REJECTED,__ATOMIC_RELEASE);break;}
    int result=0;
    int handle=((TacGameLoadModule)(uintptr_t)control->loadStartModule)(slot->path,0,0,0,0,&result);
    slot->handle=handle;slot->startResult=result;
    // A nonnegative handle with a failing start result may still be resident.
    // Retain both results and never automatically retry or pretend to unload.
    __atomic_store_n(&slot->state,handle>=0&&result>=0?TAC_MODULE_STARTED:TAC_MODULE_FAILED,__ATOMIC_RELEASE);
    break;
  }
  __atomic_store_n(&control->busy,0,__ATOMIC_RELEASE);
}
