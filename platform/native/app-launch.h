// SPDX-License-Identifier: GPL-3.0-or-later
#ifndef TAC_APP_LAUNCH_H
#define TAC_APP_LAUNCH_H
#include <stdint.h>
typedef struct {uint32_t magic,stage;char request[33],title[10];int32_t result,appId,pid;int64_t bootSec,bootUsec;char message[192];unsigned char checksum[32];} TacAppLaunch;
int tac_app_id_valid(const char*);
int tac_app_title_valid(const char*);
int tac_app_load(const char*,TacAppLaunch*);
int tac_app_save(TacAppLaunch*,int);
int tac_app_boot(TacAppLaunch*,int);
#endif
