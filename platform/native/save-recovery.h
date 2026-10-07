// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "save-core.h"
typedef struct {
 void* context;
 int (*acquire)(void*,TacSaveReceipt*);
 int (*quiescent)(void*,const TacSaveReceipt*);
 int (*unmounted)(void*,const TacSaveReceipt*);
 // 1: exact published archive verified, 0: publication absent, -1: uncertain.
 int (*published)(void*,TacSaveReceipt*);
 int (*finish)(void*,TacSaveReceipt*,int complete);
 void (*release)(void*);
} TacSaveRecovery;
int tac_save_recovery_flow(const TacSaveRecovery*);
typedef void (*TacSaveRecoveryProgress)(void*,uint64_t,uint64_t);
int tac_save_recover(const char* request,const unsigned char expected[32],char message[192],
 TacSaveRecoveryProgress progress,void* context);
