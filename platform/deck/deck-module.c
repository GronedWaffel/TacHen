// SPDX-License-Identifier: GPL-3.0-or-later
#include "deck-core.h"
#include "deck-route.h"
#include "deck-view.h"
#include "deck-render-state.h"
#include "deck-http.h"
#include "deck-bootstrap.h"
#include "resident-memory.h"
#include "dashboard.h"
#include "cheats-window.h"
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
static TacDeck deck;static TacDeckView view,hud;
static TacDeckRoute route;static uint64_t renderedAt;
static unsigned gameRouting,lastDashboardDevice,wasStalled;
static int gameFocused=-2;
static pthread_mutex_t mutex=PTHREAD_MUTEX_INITIALIZER;
static volatile TacDeckBoot* boot;static unsigned ready,visible,workerRunning,workerStop,rendering;
static void (*originalUpdate)(void*);static TacPad (*originalInput)(int);
static char credential[33];
static uint64_t millis(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
static void render(void* instance){
 boot->renderPhase=1;originalUpdate(instance);boot->renderPhase=2;
 if(__atomic_exchange_n(&rendering,1,__ATOMIC_ACQ_REL))return;
 tac_cheats_tick();
 int focus=tac_deck_view_game_focus(&view);
 __atomic_store_n(&gameFocused,focus,__ATOMIC_RELEASE);
 boot->inputFocus=focus;
 if(!__atomic_load_n(&workerRunning,__ATOMIC_ACQUIRE)){
  if(__atomic_exchange_n(&ready,0,__ATOMIC_ACQ_REL)||view.overlayScene||hud.overlayScene){
   TacDeckFrame empty={0};tac_deck_view_render(&view,&empty,0,0,millis());tac_deck_view_render(&hud,&empty,0,0,millis());
  }
  __atomic_store_n(&visible,0,__ATOMIC_RELEASE);__atomic_store_n(&rendering,0,__ATOMIC_RELEASE);return;
 }
 TacDeckFrame frame;int open=0,stalled=0;unsigned selected=0;
 if(pthread_mutex_trylock(&mutex)){__atomic_store_n(&rendering,0,__ATOMIC_RELEASE);return;}
 // Apply focus changes on the UI tick as well as on network delivery. A game
 // taking focus must release the dashboard chord before the next input call.
 TacDeckInput inputRoute=deck.frame.input;
 tac_deck_route_focus(&inputRoute,focus);
 if(inputRoute.active!=route.active){
  // Do not replay an old game batch during the focus transition. The worker
  // will deliver a fresh packet with its original ownership checks intact.
  if(inputRoute.active==1){inputRoute.active=2;inputRoute.count=0;}
  tac_deck_route_receive(&deck,&route,&inputRoute,millis());
 }
 __atomic_store_n(&gameRouting,route.active!=0,__ATOMIC_RELEASE);
 if(deck.open&&deck.valid&&millis()>=deck.received&&millis()-deck.received>TAC_DECK_DISCONNECTED_MS)boot->menuUpdateExpired++;
 tac_deck_tick(&deck,millis());tac_deck_route_tick(&deck,&route,millis());frame=deck.frame;open=tac_deck_route_visible(&deck,&route);selected=deck.selected;
 stalled=open&&tac_deck_stalled(&deck,millis());
 frame.notice.remainingMs=tac_deck_notice_remaining(&deck,millis());
 tac_deck_metrics_focus(&frame,focus);
 if(!deck.valid){open=0;frame.flags=0;frame.sequence=0;frame.metricsSequence=0;}
 pthread_mutex_unlock(&mutex);
 if(stalled){
  strcpy(frame.subtitle,"Waiting for an update. Your operation continues in the background.");
  strcpy(frame.footer,"Circle: Close");
  frame.flags|=64;
  for(unsigned i=0;i<frame.count;i++)frame.rows[i].flags&=~1u;
 }
 if(wasStalled!=(unsigned)stalled){view.paintedValid=0;if(stalled)boot->menuUpdateWaits++;wasStalled=(unsigned)stalled;}
 boot->renderPhase=3;
 // HUD has its own scene/handles and no input ownership. Its failures must not
 // disable the menu chord. Remove it while the full menu shows its own metrics.
 TacDeckFrame empty={0};tac_deck_view_render(&hud,open?&empty:&frame,0,0,millis());
 int rendered=tac_deck_view_render(&view,&frame,open,selected,millis());
 TacDeckRenderState presentation=tac_deck_render_state(rendered,open,frame.sequence,millis());
 boot->reservedTrace=view.sceneStatus;
 boot->renderPhase=4;
 if(rendered==1&&!pthread_mutex_trylock(&mutex)){
  tac_deck_present(&deck,frame.sequence,open,selected);renderedAt=millis();pthread_mutex_unlock(&mutex);
 }
 __atomic_store_n(&ready,presentation.ready,__ATOMIC_RELEASE);
 __atomic_store_n(&visible,presentation.visible,__ATOMIC_RELEASE);
 if(presentation.heartbeat)boot->renderedAt=presentation.heartbeat;
 tac_dashboard_tick(!open&&focus==0&&!tac_cheats_active());
 if(presentation.close&&!pthread_mutex_trylock(&mutex)){
  if(deck.open)deck.drain[deck.owner]=1;deck.open=0;pthread_mutex_unlock(&mutex);
 }
 __atomic_store_n(&rendering,0,__ATOMIC_RELEASE);
}
static TacPad input(int device){
 boot->inputPhase=1;TacPad result=originalInput(device);boot->inputPhase=2;int consume=0;
 boot->inputCalls++;boot->inputDevice=device;boot->inputButtonsSeen|=result.buttons;
 boot->inputSkipped+=!!result.skip;boot->inputReady=__atomic_load_n(&ready,__ATOMIC_ACQUIRE);
 if(!__atomic_load_n(&ready,__ATOMIC_ACQUIRE)||tac_cheats_active())return result;
 if(!pthread_mutex_trylock(&mutex)){
  boot->inputRoute=route.active;boot->inputOpen=deck.open;
  boot->inputRequestedRoute=deck.frame.input.active;
  if(__atomic_load_n(&gameFocused,__ATOMIC_ACQUIRE)!=0&&__atomic_load_n(&gameFocused,__ATOMIC_ACQUIRE)!=-2&&route.active==0){pthread_mutex_unlock(&mutex);return result;}
  if(route.active){pthread_mutex_unlock(&mutex);return result;}
  if(device>=0&&device<8&&result.buttons)lastDashboardDevice=(unsigned)device;
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
  tac_cheats_poll(credential);
  TacDeckFrame frame;int status=tac_deck_http(8780,credential,pending?&event:NULL,&feedback,&frame);
  int frameStatus=status;
  if(pending&&(status<0||status>=500))frameStatus=tac_deck_http(8780,credential,NULL,&feedback,&frame);
  pthread_mutex_lock(&mutex);
  if(tac_deck_http_has_frame(frameStatus)&&tac_deck_receive(&deck,&frame,sizeof frame,millis())){
   tac_dashboard_receive(&frame.dashboard);

   TacDeckInput inputRoute=frame.input;
   tac_deck_route_focus(&inputRoute,__atomic_load_n(&gameFocused,__ATOMIC_ACQUIRE));
   tac_deck_route_receive(&deck,&route,&inputRoute,millis());__atomic_store_n(&gameRouting,route.active!=0,__ATOMIC_RELEASE);
  }
  // An HTTP rejection is a definitive reply. A broken connection is unknown:
  // keep the exact request for deduplicated retry; no second user action.
  if(pending&&tac_deck_http_acknowledges(status))tac_deck_ack(&deck,event.serial);
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
// Once a worker may reference this image, returning through SDK main would
// finalize/close its dependencies. Keep the resident CRT alive on successful,
// rejected and uncertain publication alike. Metadata preparation has already
// detached this thread from Mono, so sleeping does not obstruct managed GC.
static _Noreturn void resident_wait(void){for(;;)sleep(3600);}
int main(void){
 boot=(volatile TacDeckBoot*)((unsigned char*)payload_get_args()+TAC_DECK_BOOT_OFFSET);
 if(boot->magic!=TAC_DECK_BOOT_MAGIC||boot->version!=TAC_DECK_BOOT_VERSION||boot->state||boot->credential[32])return -1;
 memcpy(credential,(const void*)boot->credential,33);
 for(unsigned i=0;i<32;i++)if(!((credential[i]>='0'&&credential[i]<='9')||(credential[i]>='a'&&credential[i]<='f')))return -1;
 boot->phase=10;tac_deck_init(&deck);void* update=NULL;void* get=NULL;
 if(!tac_deck_view_prepare(&view,&update,&get,&boot->phase)){boot->error=view.prepareError?view.prepareError:1;boot->state=3;return -1;}
 // Preparation has resolved metadata only; no managed scene/style handles yet.
 // Copy immutable bindings now, before the two renderers acquire owned objects.
 hud=view;hud.hud=1;hud.animate=0;hud.prepareTrace=NULL;
 boot->phase=20;void* arena=tac_deck_mmap(NULL,0x4000,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 if(arena==MAP_FAILED){boot->error=2;boot->state=3;return -1;}
 boot->phase=21;TacDeckPatch patches[TAC_DECK_MAX_PATCHES]={0};unsigned patchCount=2;
 if(!prepare_patch(update,render,arena,&patches[0])||!prepare_patch(get,input,(unsigned char*)arena+512,&patches[1])){
  tac_deck_munmap(arena,0x4000);boot->error=3;boot->state=3;return -1;
 }
 void*targets[3]={0},*replacements[3]={0},*trampolines[3]={0};
 if(tac_dashboard_prepare(&view.mono,view.domain,targets,replacements)){
  unsigned i;for(i=0;i<3;i++){trampolines[i]=(unsigned char*)arena+(i+2)*512;if(!prepare_patch(targets[i],replacements[i],trampolines[i],&patches[i+2]))break;}
  if(i==3){tac_dashboard_originals(trampolines);tac_dashboard_bind(boot);patchCount=5;}
  else boot->dashboardError=50+i;
 }else boot->dashboardError=tac_dashboard_prepare_error();
 void*ct[4]={0},*cr[4]={0},*co[4]={0};
 if(patchCount==5&&tac_cheats_prepare(&view.mono,view.domain,ct,cr)){
  unsigned i;for(i=0;i<4;i++){co[i]=(unsigned char*)arena+(i+5)*512;if(!prepare_patch(ct[i],cr[i],co[i],&patches[i+5]))break;}
  if(i==4){tac_cheats_originals(co);tac_cheats_bind(boot);patchCount=9;}else boot->cheatsError=20+i;
 }else boot->cheatsError=1;
 // Version decoration is independent: failure leaves the title-ID/cheats
 // hooks and main menu usable. Never replace identifiers in the game database.
 if(patchCount==9){
  void*vt=NULL,*vr=NULL,*original=(unsigned char*)arena+9*512;
  if(tac_dashboard_version_prepare(&vt,&vr)&&prepare_patch(vt,vr,original,&patches[9])){tac_dashboard_version_original(original);patchCount=10;}
  else boot->dashboardVersionError=1;
 }
 if(kernel_mprotect(getpid(),(uintptr_t)arena,0x4000,PROT_READ|PROT_EXEC)){tac_deck_munmap(arena,0x4000);boot->error=3;boot->state=3;return -1;}
 originalUpdate=(void(*)(void*))arena;originalInput=(TacPad(*)(int))((unsigned char*)arena+512);
 memcpy((void*)boot->patches,patches,patchCount*sizeof patches[0]);boot->count=patchCount;
 boot->phase=22;pthread_t thread;if(pthread_create(&thread,NULL,worker,NULL)){boot->error=4;boot->state=3;return -1;}
 pthread_detach(thread);
 __atomic_thread_fence(__ATOMIC_RELEASE);boot->phase=23;boot->state=1;
 for(unsigned i=0;i<1500;i++){
  if(boot->state==2){boot->phase=24;boot->state=4;resident_wait();}if(boot->state==3){__atomic_store_n(&workerStop,1,__ATOMIC_RELEASE);resident_wait();}usleep(10000);
 }
 // Publication outcome is unknown: leave trampolines mapped, disable deck
 // input, and let the coordinator report uncertainty instead of reinjecting.
 boot->error=5;__atomic_store_n(&workerStop,1,__ATOMIC_RELEASE);__atomic_store_n(&workerRunning,0,__ATOMIC_RELEASE);resident_wait();
}
