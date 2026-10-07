// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stddef.h>
#include <stdint.h>
#define TAC_PLUGIN_HEADER 29
typedef struct { char id[10],version[5]; size_t offset; } TacPluginImage;
int tac_plugin_inspect(const uint8_t *data,size_t size,TacPluginImage *plugin,char *reason,size_t capacity);
