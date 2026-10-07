#include "publication.h"
#include <stdio.h>
#include <string.h>
#define CHECK(expr) do{if(!(expr)){fprintf(stderr,"%d: %s\n",__LINE__,#expr);return 1;}}while(0)
typedef struct {unsigned char memory[64];int stopped,attached,detached,writes,acked,busy,failWrite,failAck,failDetach,failRollback;} Mock;
static int attach(void* p){Mock* m=p;m->stopped=1;m->attached++;return 0;}
static int detach(void* p){Mock* m=p;m->stopped=0;m->detached++;return m->failDetach;}
static int threads(void* p,uint64_t* pcs,size_t n){(void)n;Mock* m=p;pcs[0]=m->busy?0x10005:0x50000;if(m->busy>0)m->busy--;return 1;}
static int readbytes(void* p,uint64_t a,void* b,size_t n){Mock* m=p;if(!m->stopped||a<0x10000||a+n>0x10040)return -1;memcpy(b,m->memory+(a-0x10000),n);return 0;}
static int writebytes(void* p,uint64_t a,const void* b,size_t n){Mock* m=p;if(!m->stopped)return -1;m->writes++;
 if(m->writes==m->failWrite){memcpy(m->memory+(a-0x10000),b,5);return -1;}
 if(m->failRollback&&m->writes>m->failWrite)return -1;
 memcpy(m->memory+(a-0x10000),b,n);return 0;}
static int ack(void* p){Mock* m=p;if(!m->stopped)return -1;m->acked++;return m->failAck;}
static int reject(void* p){return ((Mock*)p)->stopped?0:-1;}
static void pause_mock(void* p){(void)p;}
static int run(Mock* m,TacDeckPatch* patches){TacPublicationOps o={m,attach,detach,threads,readbytes,writebytes,ack,reject,pause_mock};return tac_publish_hooks(patches,2,&o);}
int main(void){
 TacDeckPatch p[2]={{.address=0x10000},{.address=0x10020}};memset(p[0].after,0xa1,14);memset(p[1].after,0xb2,14);
 Mock m={0};CHECK(run(&m,p)==0);CHECK(m.acked==1&&m.detached==1&&!m.stopped);CHECK(m.memory[0]==0xa1&&m.memory[32]==0xb2);
 m=(Mock){.busy=3};CHECK(run(&m,p)==0);CHECK(m.attached==4&&m.detached==4&&m.writes==2);
 m=(Mock){.busy=100};CHECK(run(&m,p)==1);CHECK(m.writes==0&&m.attached==20&&m.detached==20);
 m=(Mock){.failWrite=2};CHECK(run(&m,p)==1);for(int i=0;i<64;i++)CHECK(m.memory[i]==0);CHECK(m.acked==0&&m.writes==4);
 m=(Mock){.failAck=1};CHECK(run(&m,p)==1);for(int i=0;i<64;i++)CHECK(m.memory[i]==0);
 m=(Mock){.failWrite=2,.failRollback=1};CHECK(run(&m,p)==-1);CHECK(!m.stopped);
 m=(Mock){.failDetach=1};CHECK(run(&m,p)==-1);
 m=(Mock){0};m.memory[32]=1;CHECK(run(&m,p)==1);CHECK(m.writes==0);
 m=(Mock){0};p[1].address=0x10005;CHECK(run(&m,p)==1);CHECK(m.attached==0);
 puts("Stopped-thread publication, collisions, partial-write rollback and uncertain outcomes passed");return 0;
}
