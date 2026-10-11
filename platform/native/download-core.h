// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
typedef struct { int status;uint64_t length;int has_length,chunked;char location[8193]; } TacDownloadHeaders;
// 0 success, -1 malformed or contradictory headers. Does not trust body lengths.
int tac_download_headers(const char *,size_t,TacDownloadHeaders *);
typedef struct {
 void *context;
 int (*cancelled)(void *);
 int (*read)(void *,void *,size_t);
 int (*write)(void *,const void *,size_t);
 void (*progress)(void *,uint64_t,uint64_t);
} TacDownloadStream;
enum { TAC_DL_OK=0,TAC_DL_CANCELLED=1,TAC_DL_LIMIT=2,TAC_DL_TRUNCATED=3,TAC_DL_READ=4,TAC_DL_WRITE=5,TAC_DL_EMPTY=6 };
int tac_download_stream(const TacDownloadStream *,const TacDownloadHeaders *,uint64_t);

int tac_download_chunk(const TacDownloadStream *,const TacDownloadHeaders *,uint64_t,uint64_t *,const void *,size_t);
int tac_download_complete(const TacDownloadHeaders *,uint64_t);
// Validate real available bytes, retain 16 MiB, and limit unchecked writes to
// 4 MiB. Unknown-length responses pass only their next write, not the file cap.
int tac_download_space(uint64_t,uint64_t,uint64_t,uint64_t *);
