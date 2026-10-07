// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stddef.h>
#include <stdint.h>
#define TAC_UPDATE_LIMIT (64u*1024u*1024u)
#define TAC_UPDATE_MASK 0x3fffu
typedef struct {
  char magic[8];uint32_t version,header_size;uint64_t bytes;
  uint32_t firmware_mask,state_schema;uint8_t payload_hash[32],source_hash[32];
  char label[64];uint8_t reserved[64],checksum[32];
} TacUpdateHeader;
enum { TAC_UPDATE_IDLE=0,TAC_UPDATE_STAGED=1,TAC_UPDATE_ARMED=2,TAC_UPDATE_TRIAL=3 };
enum { TAC_BOOT_NONE=0,TAC_BOOT_BASELINE=1,TAC_BOOT_TRIAL=2,TAC_BOOT_ROLLBACK=3 };
typedef struct {
  uint32_t magic,version,phase,reserved;uint64_t revision;
  TacUpdateHeader good,previous,candidate,attempt;
  int64_t boot_sec,boot_usec;int32_t pid;uint32_t attempt_kind;
  uint8_t checksum[32];
} TacUpdateState;
_Static_assert(sizeof(TacUpdateHeader)==256,"Update header is a fixed wire format");
void tac_update_digest(const void*,size_t,uint8_t[32]);
void tac_update_hex(const uint8_t[32],char[65]);
int tac_update_unhex(const char*,uint8_t[32]);
int tac_update_header(const void*,size_t,TacUpdateHeader*);
int tac_update_image(const void*,size_t,uint32_t,TacUpdateHeader*);
int tac_update_supported(const TacUpdateHeader*,uint32_t);
void tac_update_init(TacUpdateState*);
void tac_update_seal(TacUpdateState*);
int tac_update_decode(const void*,size_t,TacUpdateState*);
int tac_update_stage(TacUpdateState*,const TacUpdateHeader*,uint64_t);
int tac_update_arm(TacUpdateState*,uint64_t);
int tac_update_revert(TacUpdateState*,uint64_t);
int tac_update_discard(TacUpdateState*,uint64_t);
int tac_update_retirable(const TacUpdateState*,const uint8_t[32],uint64_t);
int tac_update_plan(TacUpdateState*,int64_t,int64_t,const TacUpdateHeader*);
int tac_update_fallback(TacUpdateState*,const TacUpdateHeader*);
int tac_update_ack(TacUpdateState*,int64_t,int64_t,int32_t,const uint8_t[32]);
