// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
enum { TAC_DISPATCH_QUEUED=1,TAC_DISPATCH_SPAWNING,TAC_DISPATCH_SPAWNED,TAC_DISPATCH_FAILED,TAC_DISPATCH_UNKNOWN };
typedef struct {
  uint32_t magic,version,stage,no_side_effects;
  int64_t boot_sec,boot_usec;
  int32_t pid,reserved;
  char request[33],upload[33],sha256[65],message[192];
  uint32_t plugin;
  char plugin_id[10],plugin_version[5],generation[128];
  uint8_t checksum[32];
} TacDispatchReceipt;
int tac_loader_start(const char *request,const char *upload,const char *sha256);
int tac_plugin_start(const char *request,const char *upload,const char *sha256);
int tac_loader_poll(const char *request,TacDispatchReceipt *receipt);
int tac_loader_busy(void);
