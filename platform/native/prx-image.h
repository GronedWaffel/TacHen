// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stddef.h>
// Structural container validation only. Imports and module initialization are
// checked by the console loader in the target game. platform: 0=ELF, 4=PS4, 5=PS5.
int tac_prx_inspect(const void *data,size_t size,int *platform,char *reason,size_t capacity);
