#include "module-thread.h"
#include <stdio.h>
#include <string.h>
#define CHECK(x) do{if(!(x)){fprintf(stderr,"%d: %s\n",__LINE__,#x);return 1;}}while(0)
static int fail,created,destroyed,step,entrySeen,argSeen;static size_t stackSeen;
static void *entry(void *arg){return arg;}
int pthread_attr_init(pthread_attr_t *a){memset(a,0,sizeof *a);step++;return fail==1?71:0;}
int pthread_attr_setstacksize(pthread_attr_t *a,size_t n){step++;a->stack=n;return fail==2?72:0;}
int pthread_attr_setdetachstate(pthread_attr_t *a,int n){step++;a->detached=n;return fail==3?73:0;}
int pthread_attr_destroy(pthread_attr_t *a){(void)a;destroyed++;return 0;}
int pthread_create(pthread_t *t,const pthread_attr_t *a,void *(*fn)(void *),void *arg){
 created++;step++;stackSeen=a->stack;entrySeen=fn==entry;argSeen=arg==&fail;
 if(!a->detached||a->stack<1024u*1024u)return 99;
 *t=1;return fail==4?74:0;
}
int main(void){
 for(fail=0;fail<=4;fail++){
  created=destroyed=step=entrySeen=argSeen=0;stackSeen=0;pthread_t t=0;
  int result=tac_module_thread_start(&t,entry,&fail);
  CHECK(result==(fail?70+fail:0));CHECK(destroyed==(fail==1?0:1));
  CHECK(created==(!fail||fail==4));CHECK(step==(fail?fail:4));
  if(created){CHECK(stackSeen>=1024u*1024u);CHECK(entrySeen&&argSeen);}
 }
 puts("Explicit module stack and fail-before-create attribute handling passed");return 0;
}
