// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-bootstrap.h"
#include <stddef.h>
typedef struct {
 void* context;
 // Track accepted attach even when the subsequent stop wait fails. Detach
 // must be safe after a failed attach and a no-op if no ownership was acquired.
 int (*attach)(void*);int (*detach)(void*);
 int (*threads)(void*,uint64_t*,size_t); // stopped thread instruction pointers
 int (*read)(void*,uint64_t,void*,size_t);
 int (*write)(void*,uint64_t,const void*,size_t); // restore protection + readback
 int (*ack)(void*);int (*reject)(void*);
 void (*pause)(void*);
} TacPublicationOps;
// 0 published, 1 rejected/restored, -1 uncertain (incl. detach/rollback failure).
int tac_publish_hooks(const TacDeckPatch* patches,size_t count,const TacPublicationOps* ops);

// Same transaction for aligned 8-byte import slots; original code is untouched.
int tac_publish_imports(const TacDeckPatch* patches,size_t count,const TacPublicationOps* ops);
