// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "game-gate.h"
#define TAC_PAD_MAGIC UINT64_C(0x5441435041443031)
#define TAC_PAD_EVENTS 128u
#define TAC_PAD_CONTROLLERS 8u
#define TAC_PAD_LEASE_NS UINT64_C(500000000)
#define TAC_PAD_DRAIN_NS UINT64_C(250000000)
// Normal scePadRead/scePadReadState interoperability layout. Other/extended
// input APIs are not interpreted as this structure.
typedef struct {
 uint32_t buttons;uint8_t sticks[4],triggers[2],reserved0[2];
 float orientation[4],acceleration[3],angular[3];
 uint8_t touches[24];int32_t connected;uint64_t timestamp;
 uint8_t extension[16],connection,reserved1[2],deviceLength,device[12];
} TacPadSample;
enum {TAC_PAD_OFF=0,TAC_PAD_OBSERVE=1,TAC_PAD_CAPTURE=2};
typedef struct {
 uint32_t revision,epoch,mode;int32_t owner;uint32_t connection,reserved;
 uint64_t expires;
} TacPadLease;
typedef struct {
 uint32_t sequence,buttons;int32_t handle;uint32_t connection;
 uint64_t time;uint8_t sticks[4],triggers[2],reserved[2];
} TacPadEvent;
typedef struct {
 int32_t handle;uint32_t used,connection,buttons;uint64_t timestamp,lastEvent,drainUntil,captureUntil,lastSeen;
 uint8_t sticks[4],triggers[2],captured,reserved;
} TacPadController;
typedef struct {
 uint64_t magic,cookie,moduleControl,moduleEntry,clock;
 uint32_t version,bytes,enabled,lock;
 TacPadLease lease;
 uint32_t written,consumed,faultEpoch,faults;
 TacPadController controllers[TAC_PAD_CONTROLLERS];
 TacPadEvent events[TAC_PAD_EVENTS];
} TacPadBridge;
typedef struct {int64_t sec,nsec;} TacPadTime;
typedef int(TAC_GAME_SYSV *TacPadClock)(int,TacPadTime*);
typedef int(TAC_GAME_SYSV *TacPadRead)(int,TacPadSample*,int);
typedef int(TAC_GAME_SYSV *TacPadReadState)(int,TacPadSample*);
// Called through a typed SysV entry stub. The original pad function and its
// return value are preserved even when capture is disabled or incompatible.
int TAC_GAME_SYSV tac_pad_bridge(TacPadBridge*,uint64_t,unsigned,uint64_t,int,TacPadSample*,int);
#ifdef __cplusplus
extern "C" {
#endif
int tac_pad_trampoline(const uint8_t*,size_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,unsigned,TacGameTrampoline*);
#ifdef __cplusplus
}
#endif
