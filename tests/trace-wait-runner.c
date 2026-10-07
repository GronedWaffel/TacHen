#include "trace-wait.h"
#include <stdio.h>
#define CHECK(e) do{if(!(e)){fprintf(stderr,"line %d: %s\n",__LINE__,#e);return 1;}}while(0)
typedef struct { uint64_t time;unsigned polls,sleeps,readyAt;int kind,signal,frozen,backwards,clockError; } Mock;
static int now(void* p,uint64_t* out){Mock* m=p;*out=m->time;return m->clockError;}
static TacTraceEvent poll(void* p){Mock* m=p;m->polls++;return (TacTraceEvent){m->polls>=m->readyAt?m->kind:TAC_TRACE_PENDING,m->signal,5};}
static void pause_mock(void* p,unsigned ms){Mock* m=p;m->sleeps++;if(!m->frozen)m->time=m->backwards?m->time-ms:m->time+ms;}
static int run(Mock* m,unsigned timeout){TacTraceWaitOps ops={m,now,poll,pause_mock};TacTraceEvent last;return tac_trace_wait(&ops,5,timeout,&last);}
int main(void){
 Mock m={.kind=TAC_TRACE_STOPPED,.signal=5,.readyAt=1};CHECK(run(&m,10)==TAC_TRACE_OK);CHECK(m.polls==1&&m.sleeps==0);
 m=(Mock){.kind=TAC_TRACE_STOPPED,.signal=5,.readyAt=4};CHECK(run(&m,10)==TAC_TRACE_OK);CHECK(m.polls==4&&m.sleeps==3);
 m=(Mock){.kind=TAC_TRACE_PENDING};CHECK(run(&m,10)==TAC_TRACE_TIMEOUT);CHECK(m.polls==10&&m.sleeps==10);
 m=(Mock){.kind=TAC_TRACE_STOPPED,.signal=19};CHECK(run(&m,10)==TAC_TRACE_WRONG_STOP);
 m=(Mock){.kind=TAC_TRACE_EXITED};CHECK(run(&m,10)==TAC_TRACE_GONE);CHECK(m.polls==1);
 m=(Mock){.kind=TAC_TRACE_POLL_ERROR};CHECK(run(&m,10)==TAC_TRACE_ERROR);
 m=(Mock){.kind=TAC_TRACE_PENDING,.frozen=1};CHECK(run(&m,10)==TAC_TRACE_TIMEOUT);CHECK(m.polls<=12);
 m=(Mock){.time=100,.backwards=1};CHECK(run(&m,10)==TAC_TRACE_ERROR);
 m=(Mock){.clockError=1};CHECK(run(&m,10)==TAC_TRACE_ERROR);CHECK(m.polls==0);
 puts("Bounded native trace waits: real stops, delayed stops, timeout, exit, unexpected signals and broken clocks passed");return 0;
}
