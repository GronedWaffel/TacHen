// SPDX-License-Identifier: GPL-3.0-or-later
#include "deck-core.h"
#include "deck-route.h"
#include "deck-view.h"
#include "deck-http.h"
#include "deck-bootstrap.h"
#include <ps5/kernel.h>
#include <ps5/payload.h>
#include <sys/mman.h>
#include <pthread.h>
#include <time.h>
#include <unistd.h>
#include <string.h>
#include <stddef.h>
extern long __crt_syscall(long,...);
extern int tac_deck_trampoline(const unsigned char*,uint64_t,void*,size_t);
typedef struct { uint8_t skip,pad[3];uint32_t buttons,previous,down,up;float leftX,leftY,rightX,rightY; } TacPad;
_Static_assert(sizeof(TacPad)==36,"Managed controller value ABI");
_Static_assert(offsetof(TacPad,rightY)==32,"Managed right stick ABI");
static TacDeck deck;static TacDeckView view;
static TacDeckRoute route;static uint64_t renderedAt;
static unsigned gameRouting;
static pthread_mutex_t mutex=PTHREAD_MUTEX_INITIALIZER;
static volatile TacDeckBoot* boot;static unsigned ready,visible,workerRunning,workerStop,rendering;
static void (*originalUpdate)(void*);static TacPad (*originalInput)(int);
static char credential[33];
static uint64_t millis(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
static void render(void* instance){
 originalUpdate(instance);
 if(__atomic_exchange_n(&rendering,1,__ATOMIC_ACQ_REL))return;
 if(!__atomic_load_n(&workerRunning,__ATOMIC_ACQUIRE)){
  if(__atomic_exchange_n(&ready,0,__ATOMIC_ACQ_REL)||(view.failed&&view.root)){
   TacDeckFrame empty={0};tac_deck_view_render(&view,&empty,0,0,millis());
  }
  __atomic_store_n(&visible,0,__ATOMIC_RELEASE);__atomic_store_n(&rendering,0,__ATOMIC_RELEASE);return;
 }
 TacDeckFrame frame;int open=0;unsigned selected=0;
 if(pthread_mutex_trylock(&mutex)){__atomic_store_n(&rendering,0,__ATOMIC_RELEASE);return;}
 tac_deck_tick(&deck,millis());tac_deck_route_tick(&deck,&route,millis());frame=deck.frame;open=tac_deck_route_visible(&deck,&route);selected=deck.selected;
 frame.notice.remainingMs=tac_deck_notice_remaining(&deck,millis());
 if(!deck.valid){open=0;frame.flags=0;frame.sequence=0;frame.metricsSequence=0;}
 pthread_mutex_unlock(&mutex);
 int rendered=tac_deck_view_render(&view,&frame,open,selected,millis());
 if(rendered&&!pthread_mutex_trylock(&mutex)){
  tac_deck_present(&deck,frame.sequence,open,selected);renderedAt=millis();pthread_mutex_unlock(&mutex);
 }
 __atomic_store_n(&ready,rendered,__ATOMIC_RELEASE);
 __atomic_store_n(&visible,rendered&&open,__ATOMIC_RELEASE);
 if(rendered&&frame.sequence&&(frame.flags&1))boot->renderedAt=millis();
 if(!rendered&&!pthread_mutex_trylock(&mutex)){
  if(deck.open)deck.drain[deck.owner]=1;deck.open=0;pthread_mutex_unlock(&mutex);
 }
 __atomic_store_n(&rendering,0,__ATOMIC_RELEASE);
}
static TacPad input(int device){
 TacPad result=originalInput(device);int consume=0;
 if(!__atomic_load_n(&ready,__ATOMIC_ACQUIRE))return result;
 if(!pthread_mutex_trylock(&mutex)){
  if(route.active){pthread_mutex_unlock(&mutex);return result;}
  consume=tac_deck_input(&deck,(unsigned)device,result.buttons,millis());pthread_mutex_unlock(&mutex);
 }else consume=!__atomic_load_n(&gameRouting,__ATOMIC_ACQUIRE)&&__atomic_load_n(&visible,__ATOMIC_ACQUIRE);
 if(consume){result.buttons=result.previous=result.down=result.up=0;result.leftX=result.leftY=result.rightX=result.rightY=0;}
 return result;
}
static void* worker(void* ignored){
 (void)ignored;
 // Before publication the worker stays inert. Never perform an HTTP request
 // from input or render callbacks, nor call Mono from this worker.
 while(boot->state<2&&!__atomic_load_n(&workerStop,__ATOMIC_ACQUIRE))usleep(10000);
 if(boot->state==3||__atomic_load_n(&workerStop,__ATOMIC_ACQUIRE))return NULL;
 __atomic_store_n(&workerRunning,1,__ATOMIC_RELEASE);
 while(!__atomic_load_n(&workerStop,__ATOMIC_ACQUIRE)){
  TacDeckEvent event;int pending;TacDeckFeedback feedback;
  pthread_mutex_lock(&mutex);tac_deck_route_tick(&deck,&route,millis());pending=tac_deck_event(&deck,&event);
  feedback=tac_deck_route_feedback(&deck,&route,__atomic_load_n(&ready,__ATOMIC_ACQUIRE),renderedAt);pthread_mutex_unlock(&mutex);
  TacDeckFrame frame;int status=tac_deck_http(8780,credential,pending?&event:NULL,&feedback,&frame);
  int frameStatus=status;
  if(pending&&(status<0||status>=500))frameStatus=tac_deck_http(8780,credential,NULL,&feedback,&frame);
  pthread_mutex_lock(&mutex);
  if(frameStatus==200&&tac_deck_receive(&deck,&frame,sizeof frame,millis())){
   tac_deck_route_receive(&deck,&route,&frame.input,millis());__atomic_store_n(&gameRouting,route.active!=0,__ATOMIC_RELEASE);
  }
  // An HTTP rejection is a definitive reply. A broken connection is unknown:
  // keep the exact request for deduplicated retry; no second user action.
  if(pending&&(status==200||(status>=400&&status<600)))tac_deck_ack(&deck,event.serial);
  tac_deck_tick(&deck,millis());pthread_mutex_unlock(&mutex);
  if(status==403){__atomic_store_n(&workerRunning,0,__ATOMIC_RELEASE);break;}
  usleep(100000);
 }
 return NULL;
}
static int prepare_patch(void* original,void* replacement,void* slot,TacDeckPatch* patch){
 unsigned char bytes[64];if(kernel_proc_copyout(getpid(),(uintptr_t)original,bytes,sizeof bytes))return 0;
 if(!tac_deck_trampoline(bytes,(uintptr_t)original,slot,512))return 0;
 patch->address=(uintptr_t)original;memcpy(patch->before,bytes,14);
 const unsigned char code[]={0xff,0x25,0,0,0,0};memcpy(patch->after,code,6);memcpy(patch->after+6,&replacement,8);return 1;
}
int main(void){
 boot=(volatile TacDeckBoot*)((unsigned char*)payload_get_args()+TAC_DECK_BOOT_OFFSET);
 if(boot->magic!=TAC_DECK_BOOT_MAGIC||boot->version!=1||boot->state||boot->credential[32])return -1;
 memcpy(credential,(const void*)boot->credential,33);
 for(unsigned i=0;i<32;i++)if(!((credential[i]>='0'&&credential[i]<='9')||(credential[i]>='a'&&credential[i]<='f')))return -1;
 tac_deck_init(&deck);void* update=NULL;void* get=NULL;
 if(!tac_deck_view_prepare(&view,&update,&get)){boot->error=view.prepareError?view.prepareError:1;boot->state=3;return -1;}
 void* arena=mmap(NULL,0x4000,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 if(arena==MAP_FAILED){boot->error=2;boot->state=3;return -1;}
 TacDeckPatch patches[2];
 if(!prepare_patch(update,render,arena,&patches[0])||!prepare_patch(get,input,(unsigned char*)arena+512,&patches[1])||
    kernel_mprotect(getpid(),(uintptr_t)arena,0x4000,PROT_READ|PROT_EXEC)){
  munmap(arena,0x4000);boot->error=3;boot->state=3;return -1;
 }
 originalUpdate=(void(*)(void*))arena;originalInput=(TacPad(*)(int))((unsigned char*)arena+512);
 memcpy((void*)boot->patches,patches,sizeof patches);boot->count=2;
 pthread_t thread;if(pthread_create(&thread,NULL,worker,NULL)){boot->error=4;boot->state=3;return -1;}
 pthread_detach(thread);
 __atomic_thread_fence(__ATOMIC_RELEASE);boot->state=1;
 for(unsigned i=0;i<1500;i++){
  if(boot->state==2){boot->state=4;return 0;}if(boot->state==3)return -1;usleep(10000);
 }
 // Publication outcome is unknown: leave trampolines mapped, disable deck
 // input, and let the coordinator report uncertainty instead of reinjecting.
 boot->error=5;__atomic_store_n(&workerStop,1,__ATOMIC_RELEASE);__atomic_store_n(&workerRunning,0,__ATOMIC_RELEASE);return -1;
}
