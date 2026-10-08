// SPDX-License-Identifier: GPL-3.0-or-later
#include <ps5/payload.h>
#include "deck-bootstrap.h"
// This code runs before libc imports resolve: no logging, allocation, errno,
// or imported calls. Only annotate the injector-owned shared record.
static volatile TacDeckBoot* trace;
static void phase(unsigned value){if(trace)trace->phase=value;}
extern int __real___crt_syscall_init(payload_args_t*);
extern int __real___kernel_init(payload_args_t*);
extern int __real___rtld_init(void);
int __wrap___crt_syscall_init(payload_args_t* args){
 trace=(volatile TacDeckBoot*)((unsigned char*)args+TAC_DECK_BOOT_OFFSET);
 if(trace->magic!=TAC_DECK_BOOT_MAGIC||trace->version!=TAC_DECK_BOOT_VERSION)trace=0;
 phase(201);int result=__real___crt_syscall_init(args);phase(202);return result;
}
int __wrap___kernel_init(payload_args_t* args){
 phase(203);int result=__real___kernel_init(args);phase(204);return result;
}
// A resident thread shares ShellUI credentials and syscall policy. Preserve
// them, matching the supported etaHEN resident initialization path.
int __wrap___patch_init(void){phase(205);return 0;}
int __wrap___rtld_init(void){
 phase(206);int result=__real___rtld_init();phase(207);return result;
}
