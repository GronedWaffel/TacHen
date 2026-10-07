// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#define TAC_SAVE_ROOT "/data/tachen/save-export"
#define TAC_SAVE_MAX_BYTES (UINT64_C(32)*1024*1024*1024)
#define TAC_SAVE_MAX_ARCHIVE (TAC_SAVE_MAX_BYTES+32*1024*1024)
#define TAC_SAVE_MAX_FILES 10000u
#define TAC_SAVE_MAX_CATALOG 2048u
#define TAC_SAVE_MAGIC UINT32_C(0x54415356)
enum { TAC_SAVE_CATALOG=1, TAC_SAVE_EXPORT=2 };
enum { TAC_SAVE_QUEUED=1,TAC_SAVE_PREPARING,TAC_SAVE_COPYING,TAC_SAVE_MOUNTING,
       TAC_SAVE_EXTRACTING,TAC_SAVE_UNMOUNTING,TAC_SAVE_PUBLISHING,TAC_SAVE_COMPLETE,TAC_SAVE_REJECTED,TAC_SAVE_UNKNOWN };
typedef struct {
 uint32_t magic,version,mode,destination; // destination 0: FTP share, 1..8: usb0..7
 int64_t bootSec,bootUsec;
 char request[33],user[9],title[10],slot[128],stamp[65],volume[65];
 uint32_t platform,reserved; // 4 or 5 for export; no caller-controlled paths
 unsigned char checksum[32];
} TacSaveRequest;
typedef struct {
 TacSaveRequest input;
 uint32_t stage,clean,mounted,files;int32_t error,pid;
 uint64_t updated,completed,total,archiveBytes;
 char output[256],sha256[65],message[192];unsigned char checksum[32];
} TacSaveReceipt;
int tac_save_request_valid(const TacSaveRequest* input);
int tac_save_hex(const char* text,size_t length);
int tac_save_user(const char* text);
int tac_save_slot(const char* text);
int tac_save_relative(const char* text);
int tac_save_platform(const char* title);
void tac_save_digest(const void* data,size_t bytes,unsigned char output[32]);
void tac_save_hash_text(const unsigned char digest[32],char text[65]);
typedef int (*TacSaveWrite)(void* context,const void* data,size_t bytes);
// POSIX pax archive headers; paths never become links or absolute entries.
int tac_save_tar_header(TacSaveWrite write,void* context,const char* path,uint64_t bytes,int directory);
int tac_save_tar_padding(TacSaveWrite write,void* context,uint64_t bytes);
int tac_save_tar_end(TacSaveWrite write,void* context);
int tac_save_json_string(TacSaveWrite write,void* context,const char* text);
