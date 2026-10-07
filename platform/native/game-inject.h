// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>
// Caller owns the native operation guard and durable intent. A successful
// install publishes disabled module slots only; it does not load any PRX.
typedef struct { intptr_t arena,control;uint64_t cookie;int installed,uncertain;char message[192]; } TacGameInjection;
int tac_game_inject(pid_t pid,uint64_t cookie,int(*identity)(void*),void* context,TacGameInjection *out);
