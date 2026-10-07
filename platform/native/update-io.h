// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "update-core.h"
#define TAC_UPDATE_ROOT "/data/tachen/updates"
int tac_update_lock(void);
int tac_update_read(TacUpdateState*,int*);
int tac_update_write(TacUpdateState*);
int tac_update_boot(int64_t*,int64_t*);
int tac_update_read_image(const TacUpdateHeader*,uint32_t,uint8_t**,size_t*);
int tac_update_save_image(const void*,size_t,uint32_t,TacUpdateHeader*);
