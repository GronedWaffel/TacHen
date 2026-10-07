// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#define TAC_PACKAGE_MAX UINT64_C(1099511627776)
#define TAC_PACKAGE_ROOT "/data/tachen/package-install"
#define TAC_PACKAGE_MAGIC UINT32_C(0x5441504b)
enum { TAC_PKG_QUEUED=1,TAC_PKG_HASHING,TAC_PKG_PREFLIGHT,TAC_PKG_SUBMITTING,
       TAC_PKG_INSTALLING,TAC_PKG_COMPLETED,TAC_PKG_REJECTED,TAC_PKG_UNKNOWN };
typedef struct {
 uint32_t magic,version;uint64_t bytes;int64_t bootSec,bootUsec;
 uint32_t type,platform,patch,reserved;
 char request[33],upload[33],sha256[65],content[37],name[128];
 unsigned char checksum[32];
} TacPackageRequest;
typedef struct {
 TacPackageRequest input;uint32_t stage,clean,accepted,observed;
 int32_t error,pid;uint64_t updated,downloaded,total;char state[16],message[192];
 unsigned char checksum[32];
} TacPackageReceipt;
typedef struct { uint64_t bytes;uint32_t type,platform,patch;char content[37]; } TacPackageInfo;
typedef int (*TacPackageRead)(void*,uint64_t,void*,size_t);
int tac_package_inspect(TacPackageRead read,void* context,uint64_t bytes,TacPackageInfo* out);
int tac_package_request_valid(const TacPackageRequest* request);
int tac_package_hex(const char* value,size_t length);
typedef struct {char state[16];uint64_t downloaded,total;int32_t error;} TacPackageProgress;
// A successful API return alone is not completion. Require progress belonging
// to this submission and two terminal observations. Prior playable installs
// must never be mistaken for a newly submitted replacement/patch.
typedef struct {TacPackageProgress baseline;unsigned baselineValid,observed,terminal,unproven;} TacPackageTracker;
// Returns -2 after 120 consecutive unproven none/already-complete polls,
// -1 for invalid/error/lost-task status, 0 while observing, 1 for completion.
int tac_package_track(TacPackageTracker* tracker,const TacPackageProgress* progress,uint64_t bytes,uint32_t platform);
