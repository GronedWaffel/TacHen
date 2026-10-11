// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "game-gate.h"
#define TAC_MODULE_SESSION_MAGIC UINT32_C(0x544d5331)
#define TAC_MODULE_SESSION_VERSION 2u
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
  char arenaRequest[33],arenaMessage[192];uint32_t arenaStage;
  TacModuleReceipt slots[TAC_GAME_MODULE_SLOTS];unsigned char checksum[32];
} TacModuleSession;
int tac_hex_string(const char *value,size_t bytes);
void tac_module_seal(TacModuleSession *session);
int tac_module_decode(const void *bytes,size_t length,const char *generation,TacModuleSession *session);
int tac_module_slot(const TacModuleSession *session,const char *request);
// New operations must not overtake an unresolved game/module publication.
int tac_module_session_held(const TacModuleSession *session);
// 0 claims a new arena request, 1 returns its existing receipt, -1 conflicts.
// Caller persists a new claim before starting a native worker.
int tac_module_arena_claim(TacModuleSession *session,const char *request);
// RAM-only snapshot for high-frequency input. Caller holds native-operation
// ownership; never loads a disk receipt or adopts another game implicitly.
int tac_module_live_session(int pid,const char *generation,const char *metadata,TacModuleSession*);
void tac_module_path(const TacModuleReceipt *receipt,char path[256]);
void tac_module_failure_message(int32_t handle,int32_t startResult,char *message,size_t size);
// Identity of the in-game control block; no pointer obtained from it is used.
int tac_module_gate_valid(const TacModuleSession *session,const TacGameGate *gate);
// Pure publication primitive. Caller must hold a stopped process lease through
// both writes, readback and rollback. 0=armed, 1=not applied, -1=uncertain,
// 2=callback busy with an untouched slot (resume the game before waiting).
typedef struct {void *context;int(*read)(void*,TacGameGate*);int(*write)(void*,size_t,const void*,size_t);} TacModuleOps;
int tac_module_stage(const TacModuleSession *session,unsigned slot,const TacModuleOps *ops);
