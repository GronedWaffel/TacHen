// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
enum { TAC_TRACE_PENDING=0,TAC_TRACE_STOPPED=1,TAC_TRACE_EXITED=2,TAC_TRACE_POLL_ERROR=3 };
enum { TAC_TRACE_OK=0,TAC_TRACE_TIMEOUT=1,TAC_TRACE_GONE=2,TAC_TRACE_WRONG_STOP=3,TAC_TRACE_ERROR=4 };
typedef struct { int kind,signal,error; } TacTraceEvent;
typedef struct {
 void* context;
 int (*now)(void*,uint64_t*);
 TacTraceEvent (*poll)(void*);
 void (*sleep)(void*,unsigned);
} TacTraceWaitOps;
// Polls only; it never resumes, kills or sends a signal to a target. Callers
// retain ownership of restoration/detach and treat uncertain outcomes as such.
int tac_trace_wait(const TacTraceWaitOps*,int expectedSignal,unsigned timeoutMs,TacTraceEvent* last);
