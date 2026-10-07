// SPDX-License-Identifier: GPL-3.0-or-later
#include "trace-wait.h"
#include <stddef.h>
int tac_trace_wait(const TacTraceWaitOps* o,int expected,unsigned timeout,TacTraceEvent* last){
 if(!o||!o->now||!o->poll||!o->sleep||!last||!timeout||timeout>10000)return TAC_TRACE_ERROR;
 *last=(TacTraceEvent){0};uint64_t start,previous;
 if(o->now(o->context,&start))return TAC_TRACE_ERROR;previous=start;
 // An iteration bound also protects against a broken/frozen time source.
 for(unsigned i=0;i<=timeout+1;i++){
  uint64_t now;if(o->now(o->context,&now)||now<previous)return TAC_TRACE_ERROR;previous=now;
  if(now-start>=timeout)return TAC_TRACE_TIMEOUT;
  *last=o->poll(o->context);
  if(last->kind==TAC_TRACE_STOPPED)return !expected||expected==last->signal?TAC_TRACE_OK:TAC_TRACE_WRONG_STOP;
  if(last->kind==TAC_TRACE_EXITED)return TAC_TRACE_GONE;
  if(last->kind!=TAC_TRACE_PENDING)return TAC_TRACE_ERROR;
  o->sleep(o->context,1);
 }
 return TAC_TRACE_TIMEOUT;
}
