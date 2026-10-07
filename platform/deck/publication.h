// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-bootstrap.h"
#include <stddef.h>
typedef struct {
 void* context;
 int (*attach)(void*);int (*detach)(void*);
 int (*threads)(void*,uint64_t*,size_t); // stopped thread instruction pointers
 int (*read)(void*,uint64_t,void*,size_t);
 int (*write)(void*,uint64_t,const void*,size_t); // restore protection + readback
 int (*ack)(void*);int (*reject)(void*);
 void (*pause)(void*);
} TacPublicationOps;
// 0 published, 1 rejected/restored, -1 uncertain (incl. detach/rollback failure).
int tac_publish_hooks(const TacDeckPatch* patches,size_t count,const TacPublicationOps* ops);
