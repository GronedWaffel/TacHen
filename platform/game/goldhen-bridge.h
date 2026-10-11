// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "game-gate.h"
#define TAC_GOLDHEN_MAGIC UINT64_C(0x54414347484e3031)
enum { TAC_GH_IDLE=0,TAC_GH_LOCKED=1,TAC_GH_PENDING=2,TAC_GH_DONE=3,TAC_GH_EXPIRED=4 };
// GoldHEN SDK v1 process-info and process-RW wire layouts (packed).
typedef struct __attribute__((packed)) {
  int32_t pid; char name[40],path[64],title[16],content[64],version[6]; uint64_t base;
} TacGoldhenInfo;
typedef struct { uint64_t address,data,length,write; } TacGoldhenRw;
typedef struct {
  uint64_t magic,cookie,sleep;
  uint32_t state; int32_t result;
  uint64_t command,argument;
} TacGoldhenBridge;
typedef int (TAC_GAME_SYSV *TacGoldhenSleep)(unsigned);
int TAC_GAME_SYSV tac_goldhen_bridge(TacGoldhenBridge*,uint64_t,void*);
