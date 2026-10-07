// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#define TAC_DECK_BOOT_OFFSET 0x800
#define TAC_DECK_BOOT_MAGIC UINT64_C(0x5441434445434b31)
typedef struct { uint64_t address; uint8_t before[14],after[14]; } TacDeckPatch;
typedef struct {
 uint64_t magic; uint32_t version,state; char credential[33],reserved[7];
 // 0 prepare, 1 complete patch batch requested, 2 published while stopped,
 // 3 rejected, 4 bootstrap complete. Render heartbeat is a separate readiness.
 uint32_t count,error; uint64_t renderedAt; TacDeckPatch patches[2];
} TacDeckBoot;
