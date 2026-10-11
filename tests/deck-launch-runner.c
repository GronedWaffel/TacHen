// SPDX-License-Identifier: GPL-3.0-or-later
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdio.h>
#include <signal.h>
#ifndef SIGTRAP
#define SIGTRAP 5
#endif
#ifndef SIGSTOP
#define SIGSTOP 17
#endif
int fake_kill(int,int);
#define kill fake_kill
#include "../platform/native/deck-launch.c"
static int mode,infos,sets,waits,kills;
static struct reg saved={.r_rip=0x1234,.r_rsp=0x10008,.r_rcx=0xbeef};
int pt_copyout(pid_t p,uint64_t a,void* b,size_t n){assert(p==58&&a==0x401c&&n==1);*(unsigned char*)b=mode==7?0:0xcc;return 0;}
int pt_stop_info(pid_t p,int* tid,int* sig,int* code,uintptr_t* address){
 assert(p==58);*sig=0;*code=0;*address=0;*tid=++infos==1?101:mode==1?202:101;return 0;
}
int pt_getregs(int tid,struct reg* r){
 if(sets==0){assert(tid==101);*r=saved;return 0;}
 assert(tid==(mode==1?202:101));*r=saved;r->r_rip=mode==2?0x7777:0x401d;r->r_rax=mode==3?12:0;return 0;
}
int pt_setregs(int tid,const struct reg* r){
 assert(tid==101);sets++;
 if(sets==1){assert(r->r_rip==0x4000&&r->r_rdi==0x9000&&r->r_rsp%16==8);}
 else{assert(!memcmp(r,&saved,sizeof saved));if(mode==8)return -1;}
 return 0;
}
int pt_continue(pid_t p,int s){assert(p==58&&s==0);return 0;}
int pt_wait_signal(pid_t p,unsigned timeout,int* sig){
 assert(p==58);waits++;assert(timeout==(waits==1?2000:1000));
 if((mode==4||mode==5||mode==6||mode==9)&&waits==1){errno=ETIMEDOUT;return -1;}
 if(mode==6)return -1;
 *sig=mode==4?SIGSTOP:mode==5?SIGSEGV:SIGTRAP;return 0;
}
int fake_kill(int p,int s){assert(p==58&&s==SIGSTOP);kills++;return 0;}
int main(void){
 for(mode=0;mode<10;mode++){
  infos=sets=waits=kills=0;TacDeckLaunch report;
  int r=tac_deck_launch(58,0x4000,0x401d,0x9000,&report);
  assert((r==0)==(mode==0));
  if(mode==7){assert(!sets&&!waits);continue;}
  assert(report.caller==101);
  if(mode==6){assert(sets==1&&!report.restored);continue;}
  assert(sets==2&&report.restored==(mode!=8));
  if(mode==1||mode==2)assert(report.deliver==SIGTRAP);
  if(mode==5)assert(report.deliver==SIGSEGV);
  if(mode==0||mode==3||mode==4||mode==8||mode==9)assert(report.deliver==0);
 }
 puts("Launch checks exact thread and trap; restores only its caller and preserves unrelated signals");return 0;
}
