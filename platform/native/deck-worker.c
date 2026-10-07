// SPDX-License-Identifier: GPL-3.0-or-later
#include "quickjs.h"
#include "deck-inject.h"
#include "deck-bootstrap.h"
#include "native-operation.h"
#include "kstuff-probe.h"
#include "elf-image.h"
#include "sha256.h"
#include <pthread.h>
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/user.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
#include <string.h>
#include <stdio.h>
#include <errno.h>
#include <stddef.h>
extern const unsigned char tachen_deck_start[],tachen_deck_end[];
#define RECEIPT "/data/tachen/deck.receipt"
#define MAGIC UINT32_C(0x54444431)
typedef struct {
 uint32_t magic,version,stage,clean;int32_t pid;uint32_t error;
 int64_t bootSec,bootUsec;uint64_t control;
 char request[33],generation[128],message[192];unsigned char checksum[32];
} Receipt;
static pthread_mutex_t mutex=PTHREAD_MUTEX_INITIALIZER;
static Receipt current;static char secret[33];static int running;
static int hex(const char* s){if(!s||strlen(s)!=32)return 0;for(unsigned i=0;i<32;i++)if(!((s[i]>='a'&&s[i]<='f')||(s[i]>='0'&&s[i]<='9')))return 0;return 1;}
static uint64_t millis(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
static void checksum(const Receipt* r,unsigned char* digest){SHA256_CTX s;sha256_init(&s);sha256_update(&s,(const unsigned char*)r,offsetof(Receipt,checksum));sha256_final(&s,digest);}
static int load(Receipt* r){
 int fd=open(RECEIPT,O_RDONLY|O_NOFOLLOW);if(fd<0)return -1;struct stat st;
 int bad=fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_size!=sizeof *r||read(fd,r,sizeof *r)!=sizeof *r;close(fd);
 unsigned char digest[32];if(!bad)checksum(r,digest);
 if(bad||r->magic!=MAGIC||r->version!=1||r->stage<1||r->stage>5||r->request[32]||r->generation[127]||r->message[191]||
   !hex(r->request)||memcmp(r->checksum,digest,32)){errno=EINVAL;return -1;}return 0;
}
static int save(Receipt* r){
 checksum(r,r->checksum);int fd=open(RECEIPT ".tmp",O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW,0600);if(fd<0)return -1;
 int bad=write(fd,r,sizeof *r)!=sizeof *r||fsync(fd);if(close(fd))bad=1;
 if(!bad)bad=rename(RECEIPT ".tmp",RECEIPT);
 if(!bad){fd=open("/data/tachen",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)return -1;bad=fsync(fd);close(fd);}return bad?-1:0;
}
static int transition(Receipt* r,unsigned stage,int clean,const char* message){
 r->stage=stage;r->clean=clean;snprintf(r->message,sizeof r->message,"%s",message);int result=save(r);
 pthread_mutex_lock(&mutex);current=*r;pthread_mutex_unlock(&mutex);return result;
}
static int identity(Receipt* r){
 struct timeval boot;size_t size=sizeof boot;int bm[]={CTL_KERN,KERN_BOOTTIME};
 if(sysctl(bm,2,&boot,&size,NULL,0)||size!=sizeof boot)return 0;
 if(r->bootSec!=boot.tv_sec||r->bootUsec!=boot.tv_usec)return 0;
 struct kinfo_proc info={0};size=sizeof info;int mib[]={CTL_KERN,KERN_PROC,KERN_PROC_PID,r->pid};
 if(sysctl(mib,4,&info,&size,NULL,0)||size<offsetof(struct kinfo_proc,ki_comm)+COMMLEN+1||info.ki_pid!=r->pid)return 0;
 info.ki_comm[COMMLEN]=0;if(strcmp(info.ki_comm,"SceShellUI")||info.ki_start.tv_sec<=0||info.ki_start.tv_usec<0||info.ki_start.tv_usec>=1000000)return 0;
 char generation[128];snprintf(generation,sizeof generation,"%lld:%lld/%d/%lld:%lld",(long long)boot.tv_sec,(long long)boot.tv_usec,r->pid,(long long)info.ki_start.tv_sec,(long long)info.ki_start.tv_usec);
 return !strcmp(generation,r->generation);
}
static int verify_identity(void* receipt){return identity(receipt);}
static void* worker(void* ignored){
 (void)ignored;Receipt r;char credential[33];pthread_mutex_lock(&mutex);r=current;memcpy(credential,secret,33);pthread_mutex_unlock(&mutex);
 const SnipersFirmwareProfile* profile=snipers_firmware_profile(kernel_get_fw_version());uint64_t base=KERNEL_ADDRESS_DATA_BASE;
 TacKstuffSnapshot a=tac_kstuff_read(base,profile),b=tac_kstuff_read(base,profile);
 if(!identity(&r)||!tac_kstuff_snapshot_equal(&a,&b)||tac_kstuff_classify(base,&b)!=TAC_KSTUFF_INSTALLED||!tac_kstuff_injection_ready(base,&b)){
  transition(&r,4,1,"ShellUI identity or kstuff readiness changed before injection");goto done;
 }
 TacElfImage image;char reason[192];size_t bytes=(size_t)(tachen_deck_end-tachen_deck_start);
 if(tac_elf_inspect(tachen_deck_start,bytes,&image,reason,sizeof reason)||image.header.type!=3){transition(&r,4,1,"Embedded deck image validation failed");goto done;}
 if(transition(&r,2,0,"Preparing the native deck inside the verified ShellUI process")){
  transition(&r,4,1,"Deck intent could not be saved; injection withheld");goto done;
 }
 intptr_t control=0;int resumed=0;int injected=tac_deck_inject(r.pid,tachen_deck_start,bytes,credential,&control,verify_identity,&r,&resumed);r.control=control;
 if(!resumed){
  // Retain the durable intent. Do not wait on filesystem operations while
  // ShellUI may still be stopped by this coordinator.
  r.stage=5;r.clean=0;snprintf(r.message,sizeof r.message,"ShellUI resume is unconfirmed; original deck intent retained");
  pthread_mutex_lock(&mutex);current=r;pthread_mutex_unlock(&mutex);
 }else if(injected)transition(&r,5,0,"Deck initialization or hook publication was not confirmed; no reinjection was issued");
 else if(transition(&r,3,0,"Deck hooks published; waiting for actual renderer heartbeat")){
  r.stage=5;snprintf(r.message,sizeof r.message,"Deck initialized but its durable receipt could not be saved");pthread_mutex_lock(&mutex);current=r;pthread_mutex_unlock(&mutex);
 }
done:
 memset(credential,0,sizeof credential);pthread_mutex_lock(&mutex);memset(secret,0,sizeof secret);running=0;tac_native_release();pthread_mutex_unlock(&mutex);return NULL;
}
static int start(const char* request,int pid,const char* generation,const char* credential){
 if(!hex(request)||!hex(credential)||pid<=1||!generation||strlen(generation)>=128){errno=EINVAL;return -1;}
 pthread_mutex_lock(&mutex);
 if(running){int same=!strcmp(request,current.request)&&pid==current.pid&&!strcmp(generation,current.generation);pthread_mutex_unlock(&mutex);if(same)return 0;errno=EBUSY;return -1;}
 if(tac_native_busy()){pthread_mutex_unlock(&mutex);errno=EBUSY;return -1;}
 Receipt r={0};r.magic=MAGIC;r.version=1;r.stage=1;r.clean=1;r.pid=pid;strcpy(r.request,request);strcpy(r.generation,generation);
 struct timeval boot;size_t size=sizeof boot;int mib[]={CTL_KERN,KERN_BOOTTIME};
 if(sysctl(mib,2,&boot,&size,NULL,0)||size!=sizeof boot){pthread_mutex_unlock(&mutex);return -1;}r.bootSec=boot.tv_sec;r.bootUsec=boot.tv_usec;
 Receipt prior;
 if(!load(&prior)){
  if(!strcmp(request,prior.request)){
   int same=prior.pid==r.pid&&!strcmp(prior.generation,r.generation)&&prior.bootSec==r.bootSec&&prior.bootUsec==r.bootUsec;
   if(same)current=prior;pthread_mutex_unlock(&mutex);if(same)return 0;errno=EINVAL;return -1;
  }
  if(prior.bootSec==r.bootSec&&prior.bootUsec==r.bootUsec&&!(prior.stage==4&&prior.clean)){
   pthread_mutex_unlock(&mutex);errno=EALREADY;return -1;
  }
 }else if(errno!=ENOENT){pthread_mutex_unlock(&mutex);return -1;}
 if(!identity(&r)||save(&r)||!tac_native_claim()){pthread_mutex_unlock(&mutex);errno=EBUSY;return -1;}
 current=r;memcpy(secret,credential,33);running=1;pthread_t thread;int result=pthread_create(&thread,NULL,worker,NULL);
 if(!result)pthread_detach(thread);
 else{running=0;tac_native_release();current.stage=4;current.clean=1;snprintf(current.message,sizeof current.message,"Deck worker could not start");save(&current);}
 pthread_mutex_unlock(&mutex);if(result){errno=result;return -1;}return 0;
}
static JSValue failure(JSContext* c){
 JSValue error=JS_NewError(c);JS_SetPropertyStr(c,error,"code",JS_NewString(c,errno==EALREADY?"DECK_ALREADY_ATTEMPTED":errno==EBUSY?"NATIVE_BUSY":"DECK_NATIVE"));
 JS_SetPropertyStr(c,error,"message",JS_NewString(c,errno==EALREADY?"This boot already has a deck injection or unresolved attempt. Reinjection is blocked.":"Native deck operation could not be completed."));return JS_Throw(c,error);
}
static JSValue start_js(JSContext* c,JSValueConst self,int argc,JSValueConst* argv){
 (void)self;if(argc!=4)return JS_ThrowTypeError(c,"Expected request, PID, generation and private renderer credential");
 int32_t pid;const char* request=JS_ToCString(c,argv[0]),*generation=JS_ToCString(c,argv[2]),*credential=JS_ToCString(c,argv[3]);
 int result=-1;if(request&&generation&&credential&&!JS_ToInt32(c,&pid,argv[1]))result=start(request,pid,generation,credential);
 if(request)JS_FreeCString(c,request);if(generation)JS_FreeCString(c,generation);if(credential)JS_FreeCString(c,credential);return result?failure(c):JS_UNDEFINED;
}
static JSValue poll_js(JSContext* c,JSValueConst self,int argc,JSValueConst* argv){
 (void)self;if(argc!=1)return JS_ThrowTypeError(c,"Expected deck request");const char* request=JS_ToCString(c,argv[0]);if(!request)return JS_EXCEPTION;
 if(!hex(request)){JS_FreeCString(c,request);return JS_ThrowTypeError(c,"Invalid deck request");}
 Receipt r;pthread_mutex_lock(&mutex);int live=running,found=current.magic==MAGIC&&!strcmp(current.request,request);if(found)r=current;pthread_mutex_unlock(&mutex);
 if(!found&&(load(&r)||strcmp(r.request,request))){JS_FreeCString(c,request);return JS_NULL;}JS_FreeCString(c,request);
 int ready=0;
 if(!live&&(r.stage==1||r.stage==2))r.stage=5;
 if(!tac_native_busy()&&r.stage==3&&r.control&&identity(&r)){
  TacDeckBoot status;uint64_t now=millis();
  if(!kernel_proc_copyout(r.pid,r.control,&status,sizeof status)&&status.magic==TAC_DECK_BOOT_MAGIC&&status.version==1&&status.state==4&&
    status.renderedAt&&now>=status.renderedAt&&now-status.renderedAt<=3000)ready=1;
 }
 JSValue out=JS_NewObject(c);JS_SetPropertyStr(c,out,"request",JS_NewString(c,r.request));JS_SetPropertyStr(c,out,"stage",JS_NewInt32(c,r.stage));
 JS_SetPropertyStr(c,out,"busy",JS_NewBool(c,tac_native_busy()));
 JS_SetPropertyStr(c,out,"pid",JS_NewInt32(c,r.pid));JS_SetPropertyStr(c,out,"generation",JS_NewString(c,r.generation));
 JS_SetPropertyStr(c,out,"ready",JS_NewBool(c,ready));JS_SetPropertyStr(c,out,"noSideEffects",JS_NewBool(c,r.clean));JS_SetPropertyStr(c,out,"message",JS_NewString(c,r.message));
 return out;
}
void tac_deck_bind(JSContext* c,JSValue api){JS_SetPropertyStr(c,api,"deckStart",JS_NewCFunction(c,start_js,"deckStart",4));JS_SetPropertyStr(c,api,"deckPoll",JS_NewCFunction(c,poll_js,"deckPoll",1));}
