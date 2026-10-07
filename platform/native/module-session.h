// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "game-gate.h"
#define TAC_MODULE_SESSION_MAGIC UINT32_C(0x544d5331)
enum { TAC_ARENA_EMPTY=0,TAC_ARENA_INTENT=1,TAC_ARENA_READY=2,TAC_ARENA_UNKNOWN=3 };
enum { TAC_PRX_EMPTY=0,TAC_PRX_QUEUED=1,TAC_PRX_ARMING=2,TAC_PRX_ARMED=3,TAC_PRX_STARTED=4,
  TAC_PRX_FAILED=5,TAC_PRX_UNKNOWN=6,TAC_PRX_REJECTED=7 };
typedef struct {
  char request[33],upload[33],sha256[65],extension[8];
  uint32_t stage,clean;int32_t handle,startResult;char message[192];
} TacModuleReceipt;
typedef struct {
  uint32_t magic,version,phase;int32_t pid;uint64_t arena,control,cookie;
  char generation[128],title[10],metadataHash[65];
  TacModuleReceipt slots[TAC_GAME_MODULE_SLOTS];unsigned char checksum[32];
} TacModuleSession;
int tac_hex_string(const char *value,size_t bytes);
void tac_module_seal(TacModuleSession *session);
int tac_module_decode(const void *bytes,size_t length,const char *generation,TacModuleSession *session);
int tac_module_slot(const TacModuleSession *session,const char *request);
void tac_module_path(const TacModuleReceipt *receipt,char path[256]);
// Identity of the in-game control block; no pointer obtained from it is used.
int tac_module_gate_valid(const TacModuleSession *session,const TacGameGate *gate);
// Pure publication primitive. Caller must hold a stopped process lease through
// both writes, readback and rollback. 0=armed, 1=not applied, -1=uncertain.
typedef struct {void *context;int(*read)(void*,TacGameGate*);int(*write)(void*,size_t,const void*,size_t);} TacModuleOps;
int tac_module_stage(const TacModuleSession *session,unsigned slot,const TacModuleOps *ops);
