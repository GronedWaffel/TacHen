// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from GronedWaffel/ps-neighborhood receiver-ps5/install-abi.h.
// Only the 13.60 marshaller is evidenced here. Do not guess lower-FW layouts.
#pragma once
#include <stdint.h>
#include <stddef.h>
typedef struct {const char *uri,*extra,*scenario,*content,*name,*icon;uint32_t option;uint8_t flag;} TacInstallMeta;
typedef struct {char content[48];int type,platform;} TacInstallPackage;
typedef struct {char languages[30][8],scenarios[64][3],contents[64][48];uint8_t reserved[6480];} TacInstallPlaygo;
typedef struct {int32_t code,version;char description[512],type[9];} TacInstallError;
typedef struct {char state[16],source[8];uint32_t seconds;uint64_t downloaded,initial,total;uint32_t promote;uint8_t reserved[100];TacInstallError error;int32_t copyPercent;_Bool copyOnly;uint8_t trailing[15];} TacInstallStatus;
_Static_assert(sizeof(TacInstallMeta)==56&&offsetof(TacInstallMeta,flag)==0x34,"InstallByPackage metadata ABI");
_Static_assert(sizeof(TacInstallPackage)==56&&sizeof(TacInstallPlaygo)==9984,"InstallByPackage output ABI");
_Static_assert(sizeof(TacInstallStatus)==712&&offsetof(TacInstallStatus,error)==0xa0&&offsetof(TacInstallStatus,total)==0x30,"13.60 installation status ABI");
