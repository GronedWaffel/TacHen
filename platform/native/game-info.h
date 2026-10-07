// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
typedef struct {uint32_t appId;unsigned titleOffset;char title[10];} TacAppInfo;
int tac_game_title(const char* title);
int tac_app_info_decode(const unsigned char* bytes,size_t length,TacAppInfo* out);
int tac_game_app_info(int pid,TacAppInfo* out);
int tac_game_info_available(void);
