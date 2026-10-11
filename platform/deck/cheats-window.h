// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "mono-api.h"
#include "deck-bootstrap.h"
#define TAC_CHEATS_PATCHES 4
int tac_cheats_prepare(TacMono*,void*,void*[TAC_CHEATS_PATCHES],void*[TAC_CHEATS_PATCHES]);
void tac_cheats_originals(void*[TAC_CHEATS_PATCHES]);
void tac_cheats_bind(volatile TacDeckBoot*);
void tac_cheats_poll(const char[33]); // worker only
void tac_cheats_tick(void); // UI thread only
int tac_cheats_active(void);
