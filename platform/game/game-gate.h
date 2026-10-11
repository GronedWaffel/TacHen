// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#if defined(__x86_64__) && defined(_WIN32)
#define TAC_GAME_SYSV __attribute__((sysv_abi))
#else
#define TAC_GAME_SYSV
#endif
#define TAC_GAME_GATE_MAGIC UINT64_C(0x54414347414d4531)
#define TAC_GAME_MODULE_SLOTS 8
#define TAC_GAME_GATE_VERSION 2
#define TAC_GAME_MODULE_PREFIX "/tachen-modules/"
enum { TAC_MODULE_PENDING=0,TAC_MODULE_STARTING=1,TAC_MODULE_STARTED=2,TAC_MODULE_FAILED=3,TAC_MODULE_REJECTED=4 };
enum { TAC_MODULE_PHASE_IDLE=0,TAC_MODULE_PHASE_THREAD=1,TAC_MODULE_PHASE_LOAD=2,
  TAC_MODULE_PHASE_EXPORTS=3,TAC_MODULE_PHASE_ACTIVATE=4,TAC_MODULE_PHASE_COMPLETE=5 };
typedef struct {
  uint32_t enabled,state;
  int32_t handle,startResult;
  char path[256];
  uint32_t phase,activation;
  int32_t threadResult,detachResult,activationResult,loadSymbolResult,unloadSymbolResult;
} TacGameModule;
typedef struct {
  uint64_t magic,cookie,loadStartModule;
  uint32_t version,bytes,enabled,busy;
  uint64_t callbacks[2];
  uint64_t threadCreate,threadDetach,dlsym;
  TacGameModule modules[TAC_GAME_MODULE_SLOTS];
} TacGameGate;
typedef int (TAC_GAME_SYSV *TacGameLoadModule)(const char*,uint64_t,const void*,unsigned,const void*,int*);
typedef void* (TAC_GAME_SYSV *TacGameThreadEntry)(void*);
typedef int (TAC_GAME_SYSV *TacGameThreadCreate)(uintptr_t*,const void*,TacGameThreadEntry,void*,const char*);
typedef int (TAC_GAME_SYSV *TacGameThreadDetach)(uintptr_t);
typedef int (TAC_GAME_SYSV *TacGameDlsym)(int,const char*,void**);
typedef int (TAC_GAME_SYSV *TacGamePluginLoad)(int,const char**);
void TAC_GAME_SYSV tac_game_gate(TacGameGate *control,uint64_t cookie,unsigned lane);
typedef struct { uint8_t bytes[512];size_t size,stolen; } TacGameTrampoline;
#ifdef __cplusplus
extern "C" {
#endif
int tac_game_trampoline(const uint8_t *before,size_t available,uint64_t target,uint64_t stub,
  uint64_t control,uint64_t cookie,uint64_t gate,unsigned lane,TacGameTrampoline *out);
int tac_game_import_trampoline(uint64_t original,uint64_t control,uint64_t cookie,uint64_t gate,unsigned lane,TacGameTrampoline *out);
#ifdef __cplusplus
}
#endif
