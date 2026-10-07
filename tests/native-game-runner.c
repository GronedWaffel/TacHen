// SPDX-License-Identifier: GPL-3.0-or-later
#include "game-info.h"
#include "check.h"
#include <string.h>
#include <stdio.h>
int main(int argc,char** argv){
 (void)argv;if(argc>1)CHECK(0);
 unsigned char raw[96]={0};uint32_t app=24;memcpy(raw,&app,4);TacAppInfo info;
 memcpy(raw+16,"PPSA00001",10);CHECK(!tac_app_info_decode(raw,sizeof raw,&info));CHECK(info.titleOffset==16&&info.appId==24);
 memset(raw+16,0,80);memcpy(raw+20,"CUSA00001",10);CHECK(!tac_app_info_decode(raw,sizeof raw,&info));CHECK(info.titleOffset==20);
 memset(raw+20,'X',10);CHECK(tac_app_info_decode(raw,sizeof raw,&info));
 memcpy(raw+20,"NPXS40001",10);CHECK(tac_app_info_decode(raw,sizeof raw,&info));
 memcpy(raw+20,"PPSA00001",10);CHECK(tac_app_info_decode(raw,95,&info));
 raw[0]=0;CHECK(tac_app_info_decode(raw,sizeof raw,&info));
 CHECK(tac_game_title("MOUU00001"));CHECK(!tac_game_title("PPSA0000/"));CHECK(!tac_game_title("PPSA00001_more"));
 puts("Application identity layouts and bounds passed");return 0;
}
