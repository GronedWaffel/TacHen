// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "cheat-transaction.h"
#define TAC_INSPECT_MAX_BYTES 65536u
// The same stopped-game lease as cheats, without permission changes or writes.
// A successful result requires confirmed resume. Failed reads erase the buffer.
TacCheatResult tac_memory_inspect(const TacCheatOps *ops,uint64_t offset,
  size_t length,unsigned char *bytes,uint64_t *base,uint64_t *size);
