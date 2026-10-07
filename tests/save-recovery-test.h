// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "save-core.h"
#include <stdint.h>
struct stat {uint64_t st_dev,st_ino;int64_t st_size;unsigned st_mode;struct {int64_t tv_sec,tv_nsec;} st_mtim,st_ctim;};
struct statfs {uint64_t f_fsid;char f_mntonname[128];};
#define S_ISREG(m) ((m)==1)
#define O_RDONLY 0
#define O_RDWR 1
#define O_NOFOLLOW 2
#define O_NONBLOCK 4
#define O_CLOEXEC 8
#define AT_SYMLINK_NOFOLLOW 16
#define LOCK_EX 1
#define LOCK_NB 2
int openat(int,const char*,int,...);
int fstat(int,struct stat*);
int fstatat(int,const char*,struct stat*,int);
int fstatfs(int,struct statfs*);
int flock(int,int);
int fsync(int);
#define close recovery_test_close
#define dup recovery_test_dup
#define kill recovery_test_kill
int recovery_test_close(int);
int recovery_test_dup(int);
int recovery_test_kill(int,int);
int tac_save_directory(const char*,int);
int tac_save_child_directory(int,const char*,int);
int tac_save_volume(unsigned,char[64],char[65]);
int tac_save_volume_open(unsigned,char[64],char[65]);
int tac_save_request_load(TacSaveRequest*);
int tac_save_receipt_load(const char*,TacSaveReceipt*);
int tac_save_receipt_save(TacSaveReceipt*);
int tac_save_boot(TacSaveRequest*,int);
typedef int (*TacSaveProgress)(void*,uint64_t);
int tac_save_hash_file(int,uint64_t,char[65],TacSaveProgress,void*);
