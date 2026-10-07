// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#define TAC_FPS_MAGIC UINT64_C(0x5441434650533031)
typedef struct {uint64_t magic,cookie,frames;uint32_t enabled,reserved;} TacFpsGate;
typedef struct {uint8_t bytes[320];size_t size,stolen;} TacFpsTrampoline;
#ifdef __cplusplus
extern "C" {
#endif
int tac_fps_trampoline(const uint8_t*,size_t,uint64_t,uint64_t,uint64_t,TacFpsTrampoline*);
typedef struct {
 uint64_t arena,control,target,cookie;uint8_t before[14],after[14];
 int installed,uncertain,resumed;char message[192];
} TacFpsInjection;
// Caller owns the native-operation guard and durable intent, saved BEFORE this
// operation. No filesystem activity while the target is stopped.
int tac_fps_inject(int pid,uint64_t cookie,int(*identity)(void*),void*,TacFpsInjection*);
#ifdef __cplusplus
}
#endif
