// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "save-core.h"
#include <sys/stat.h>
typedef struct { int directory,image,key;struct stat imageStat,keyStat;char stamp[65]; } TacSaveSource;
int tac_save_directory(const char* path,int create);
int tac_save_child_directory(int parent,const char* name,int create);
int tac_save_source_open(const TacSaveRequest* input,TacSaveSource* source);
void tac_save_source_close(TacSaveSource* source);
int tac_save_source_current(const TacSaveRequest* input,const TacSaveSource* source);
int tac_save_volume(unsigned destination,char path[64],char stamp[65]);
int tac_save_volume_open(unsigned destination,char path[64],char stamp[65]);
int tac_save_read_all(int fd,uint64_t offset,void* data,size_t bytes);
int tac_save_write_all(void* fd,const void* data,size_t bytes);
int tac_save_request_load(TacSaveRequest* input);
int tac_save_request_save(TacSaveRequest* input);
int tac_save_receipt_load(const char* id,TacSaveReceipt* receipt);
int tac_save_receipt_save(TacSaveReceipt* receipt);
int tac_save_boot(TacSaveRequest* input,int compare);
uint64_t tac_save_millis(void);
typedef int (*TacSaveProgress)(void* context,uint64_t bytes);
int tac_save_copy(int source,int target,uint64_t bytes,char sha256[65],TacSaveProgress progress,void* context);
int tac_save_hash_file(int file,uint64_t bytes,char sha256[65],TacSaveProgress progress,void* context);
