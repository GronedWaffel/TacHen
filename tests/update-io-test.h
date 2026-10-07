// SPDX-License-Identifier: GPL-3.0-or-later
// Host-only syscall boundary for the actual update-io.c implementation.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
typedef ptrdiff_t ssize_t;
struct mock_stat { unsigned st_mode; int64_t st_size; };
struct mock_timeval { int64_t tv_sec,tv_usec; };
#define stat mock_stat
#define timeval mock_timeval
enum { O_RDONLY=1,O_RDWR=2,O_WRONLY=4,O_CREAT=8,O_TRUNC=16,O_NOFOLLOW=32,O_DIRECTORY=64,O_NONBLOCK=128 };
enum { TEST_REG=1,TEST_DIR=2,TEST_LINK=3,TEST_FIFO=4,LOCK_EX=1,LOCK_NB=2,CTL_KERN=1,KERN_BOOTTIME=2 };
#define S_ISREG(mode) ((mode)==TEST_REG)
#define S_ISDIR(mode) ((mode)==TEST_DIR)
#define S_ISLNK(mode) ((mode)==TEST_LINK)
int mock_open(const char*,int,...);
int mock_close(int);
int mock_mkdir(const char*,int);
int mock_lstat(const char*,struct mock_stat*);
int mock_fstat(int,struct mock_stat*);
int mock_flock(int,int);
int mock_fsync(int);
int mock_rename(const char*,const char*);
int mock_unlink(const char*);
ssize_t mock_read(int,void*,size_t);
ssize_t mock_write(int,const void*,size_t);
int mock_sysctl(const int*,unsigned,void*,size_t*,const void*,size_t);
#define open mock_open
#define close mock_close
#define mkdir mock_mkdir
#define lstat mock_lstat
#define fstat mock_fstat
#define flock mock_flock
#define fsync mock_fsync
#define rename mock_rename
#define unlink mock_unlink
#define read mock_read
#define write mock_write
#define sysctl mock_sysctl
