// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#define TAC_CHEAT_MAX_PATCHES 256
#define TAC_CHEAT_MAX_BYTES 1048576
#define TAC_CHEAT_PLAN_MAGIC UINT32_C(0x54435031)
typedef struct {uint64_t offset,address;uint32_t size;const unsigned char *before,*after;} TacCheatPatch;
typedef struct {unsigned count;size_t bytes;TacCheatPatch patches[TAC_CHEAT_MAX_PATCHES];} TacCheatPlan;
// Wire: LE magic, version=1, patch count, total packet bytes (four uint32s).
// Each record: uint64 module offset, uint32 byte count, uint32 section=0,
// followed by expected and desired bytes. No pointers supplied by callers.
int tac_cheat_plan(const void*,size_t,TacCheatPlan*);
typedef struct {
  void *context;
  int (*attach)(void*); // zero only after verified stop; detach runs even on failure
  int (*detach)(void*); // zero only if no outstanding trace ownership remains
  int (*identity)(void*); // true only for this exact game instance
  int (*deadline)(void*); // true while forward execution is within its time budget
  int (*module)(void*,uint64_t *base,uint64_t *size);
  int (*range)(void*,uint64_t,size_t); // bounds, mappings and stopped instruction PCs
  int (*read)(void*,uint64_t,void*,size_t);
  int (*write)(void*,uint64_t,const void*,size_t); // exact permission restoration
  int (*journal)(void*); // durable intent, before first write
  int (*healthy)(void*); // all temporary permission changes restored
} TacCheatOps;
enum {TAC_CHEAT_APPLIED=0,TAC_CHEAT_REJECTED=1,TAC_CHEAT_UNCERTAIN=2};
typedef struct {int status,resumed,restored;unsigned writes;char reason[192];} TacCheatResult;
// Every expected byte is checked before the first write. The in-flight write is
// included in rollback. Rollback is bounded by patch count, not forward deadline.
TacCheatResult tac_cheat_apply(TacCheatPlan*,const TacCheatOps*);
