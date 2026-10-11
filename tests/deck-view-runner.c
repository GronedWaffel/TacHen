// SPDX-License-Identifier: GPL-3.0-or-later
// Managed-object boundary fixture. Exercises the production renderer/cache and
// failure cleanup; does not emulate PUI rendering or validate its console ABI.
#include "deck-view.h"
#include "deck-render-state.h"
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#define CHECK(x) do{if(!(x)){fprintf(stderr,"line %d: %s\n",__LINE__,#x);return 1;}}while(0)
enum { FIND=1,ROOT,APPEND,REMOVE,CTOR,FONTCTOR,COLORCTOR,TEXT,NAME,X,Y,WIDTH,HEIGHT,COLOR,FONT,PWIDTH,PHEIGHT,PCOLOR,VISIBLE,PCTOR,APPLICATION,SCENEVISIBLE,SCENEADD,SCENEREMOVE,SCENEFOCUS,SCENEFRONT,SCENEBG,SCENEBGLIMIT,SCENEBGMODE,SCENEPASSFRONT };
typedef struct {char text[256];unsigned removed,visible,backgroundMode,passFront;float x,y,width,height,background,backgroundLimit;} Obj;
static Obj objects[2048],roots[2],parents[2];static void* handles[2048];static char strings[2048][256];
static unsigned sceneAdds,sceneRemoves,failSceneRemove;
static unsigned allocated,nextHandle,stringCount,invocations,textCalls,removed,rootIndex,failText,failPanel;
static int sceneAvailable=1;
static uint8_t gameFocus;static int failFocus;
static uint8_t sceneVisible=1;static int compatibleScene=1;static unsigned rootCalls;
static void* object_class(void* object){(void)object;return (void*)(uintptr_t)(compatibleScene?100:101);}
static void* class_parent(void* klass){(void)klass;return NULL;}
static Obj* failingObject;static unsigned failHide,failRemove,appended;
int tac_mono_load(TacMono* unused){(void)unused;return 0;}
static void* object_new(void* domain,void* klass){(void)domain;(void)klass;return &objects[allocated++];}
static uint32_t handle_new(void* object,int pinned){(void)pinned;handles[++nextHandle]=object;return nextHandle;}
static void* handle_target(uint32_t handle){return handles[handle];}
static void handle_free(uint32_t handle){handles[handle]=NULL;}
static void* unbox(void* object){return object;}
static void* string_new(void* domain,const char* text){(void)domain;snprintf(strings[stringCount],256,"%s",text);return strings[stringCount++];}
static void* invoke(void* method,void* object,void** args,void** exception){
 invocations++;*exception=NULL;
 switch((uintptr_t)method){
  case 1000:if(failFocus){*exception=(void*)1;return NULL;}return &gameFocus;
  case APPLICATION:return (void*)2;
  case FIND:if(object!=(void*)2||args){*exception=(void*)1;return NULL;}return sceneAvailable?&parents[rootIndex]:NULL;
  case SCENEADD:sceneAdds++;if(object!=&parents[rootIndex]||!((Obj*)args[0])->passFront)*exception=(void*)1;break;
  case SCENEPASSFRONT:((Obj*)object)->passFront=*(uint8_t*)args[0];break;
  case SCENEREMOVE:if(failSceneRemove){failSceneRemove--;*exception=(void*)1;}else sceneRemoves++;break;
  case SCENEFOCUS:case SCENEFRONT:if(*(uint8_t*)args[0])*exception=(void*)1;break;
  case SCENEBGMODE:((Obj*)object)->backgroundMode=*(uint32_t*)args[0];break;
  case SCENEBGLIMIT:((Obj*)object)->backgroundLimit=*(float*)args[0];break;
  case SCENEBG:
   if(((Obj*)object)->backgroundMode!=7||((Obj*)object)->backgroundLimit!=0)*exception=(void*)1;
   ((Obj*)object)->background=*(float*)args[0];break;
  case SCENEVISIBLE:return &sceneVisible;
  case ROOT:rootCalls++;return &roots[rootIndex];
  case TEXT:textCalls++;if(failText){failText=0;*exception=(void*)1;break;}snprintf(((Obj*)object)->text,256,"%s",(char*)args[0]);break;
  case APPEND:appended++;break;
  case REMOVE:if(object==failingObject&&failRemove){failRemove--;*exception=(void*)1;break;}((Obj*)object)->removed=1;removed++;break;
  case VISIBLE:if(object==failingObject&&failHide){failHide--;*exception=(void*)1;break;}((Obj*)object)->visible=*(uint8_t*)args[0];break;
  case X:((Obj*)object)->x=*(float*)args[0];break;
  case Y:((Obj*)object)->y=*(float*)args[0];break;
  case PWIDTH:((Obj*)object)->width=*(float*)args[0];break;
  case PHEIGHT:((Obj*)object)->height=*(float*)args[0];break;
  case PCTOR:if(failPanel){failPanel=0;*exception=(void*)1;}break;
  default:break;
 }return NULL;
}
static int motion_checks(void){
 TacDeckFrame frame={.flags=3,.count=8};TacDeckLayout layout;TacDeckMotion motion={0};
 tac_deck_layout(&frame,1,0,&layout);CHECK(tac_deck_motion(&motion,&layout,0,1000));
 CHECK(layout.panels[1].x==320&&layout.labels[0].x==424);
 tac_deck_layout(&frame,1,0,&layout);CHECK(tac_deck_motion(&motion,&layout,0,1110));
 CHECK(layout.panels[1].x>256&&layout.panels[1].x<320);
 tac_deck_layout(&frame,1,0,&layout);CHECK(!tac_deck_motion(&motion,&layout,0,1220));
 CHECK(layout.panels[1].x==256);
 // Rapid navigation retargets from the last visible marker position. The
 // selected card and its inverse label are never separated by the animation.
 tac_deck_layout(&frame,1,7,&layout);CHECK(tac_deck_motion(&motion,&layout,7,1230));
 CHECK(layout.panels[5].y==734&&layout.labels[19].ink==7&&layout.panels[8].y==336);
 tac_deck_layout(&frame,1,7,&layout);CHECK(tac_deck_motion(&motion,&layout,7,1290));
 float edge=layout.panels[8].y;CHECK(edge>336&&edge<742);
 tac_deck_layout(&frame,1,2,&layout);CHECK(tac_deck_motion(&motion,&layout,2,1291));
 CHECK(layout.panels[8].y==edge);
 tac_deck_layout(&frame,1,2,&layout);CHECK(!tac_deck_motion(&motion,&layout,2,1411));
 CHECK(layout.panels[8].y==452&&layout.panels[5].y==444);
 // A clock regression settles rather than wrapping an unsigned duration.
 tac_deck_layout(&frame,1,2,&layout);CHECK(!tac_deck_motion(&motion,&layout,2,500));
 CHECK(layout.panels[1].x==256&&layout.panels[8].y==452);
 return 0;
}
int main(void){
 CHECK(!motion_checks());
 TacDeckView focusView={0};CHECK(tac_deck_view_game_focus(&focusView)==-2);
 focusView.gameLayerFocused=(void*)1000;focusView.mono.mono_runtime_invoke=invoke;focusView.mono.mono_object_unbox=unbox;
 CHECK(tac_deck_view_game_focus(&focusView)==0);gameFocus=1;CHECK(tac_deck_view_game_focus(&focusView)==1);
 failFocus=1;CHECK(tac_deck_view_game_focus(&focusView)==-1);failFocus=0;
 TacDeckView view={0};view.initialized=1;view.domain=(void*)1;view.label=(void*)2;
 view.mono.mono_object_new=object_new;view.mono.mono_gchandle_new=handle_new;
 view.mono.mono_gchandle_get_target=handle_target;view.mono.mono_gchandle_free=handle_free;
 view.mono.mono_object_unbox=unbox;view.mono.mono_string_new=string_new;view.mono.mono_runtime_invoke=invoke;
 view.mono.mono_object_get_class=object_class;view.mono.mono_class_get_parent=class_parent;
 view.getApplication=(void*)APPLICATION;view.sceneClass=(void*)100;view.sceneVisible=(void*)SCENEVISIBLE;
 view.containerClass=(void*)100;view.sceneCtor=(void*)CTOR;view.addScene=(void*)SCENEADD;view.removeScene=(void*)SCENEREMOVE;
 view.sceneOverlay=(void*)VISIBLE;view.sceneFocusable=(void*)SCENEFOCUS;view.sceneFrontable=(void*)SCENEFRONT;
 view.scenePassFrontActive=(void*)SCENEPASSFRONT;
 view.sceneWidth=(void*)PWIDTH;view.sceneHeight=(void*)PHEIGHT;view.sceneBackground=(void*)SCENEBG;
 // Use a nonzero fixture value to ensure the renderer uses the enum value
 // obtained from runtime metadata rather than assuming Manual always means 0.
 view.sceneBackgroundControl=(void*)SCENEBGMODE;view.sceneBackgroundLimit=(void*)SCENEBGLIMIT;view.sceneManualMode=7;
 view.findScene=(void*)FIND;view.getRoot=(void*)ROOT;view.append=(void*)APPEND;view.remove=(void*)REMOVE;
 view.labelCtor=(void*)CTOR;view.fontCtor=(void*)FONTCTOR;view.colorCtor=(void*)COLORCTOR;
 view.text=(void*)TEXT;view.name=(void*)NAME;view.x=(void*)X;view.y=(void*)Y;view.width=(void*)WIDTH;
 view.height=(void*)HEIGHT;view.textColor=(void*)COLOR;view.labelFont=(void*)FONT;
 view.panel=(void*)3;view.panelCtor=(void*)PCTOR;view.panelWidth=(void*)PWIDTH;view.panelHeight=(void*)PHEIGHT;
 view.panelColor=(void*)PCOLOR;view.panelVisible=(void*)VISIBLE;
 TacDeckView hud=view;hud.hud=1;hud.initialized=0;
 for(unsigned i=0;i<TAC_DECK_STYLES;i++)view.fonts[i]=handle_new(object_new(NULL,NULL),1);
 for(unsigned i=0;i<TAC_DECK_INKS;i++)view.colors[i]=handle_new(object_new(NULL,NULL),1);
 for(unsigned i=0;i<TAC_DECK_BACKGROUNDS;i++)view.backgrounds[i]=handle_new(object_new(NULL,NULL),1);
 TacDeckFrame frame={.flags=3,.sequence=1,.metricsSequence=1,.count=2,.page=1};
 strcpy(frame.title,"TacHen / Plugins");strcpy(frame.rows[0].label,"Start watcher");strcpy(frame.rows[0].detail,"Ready to start.");frame.rows[0].flags=1;
 strcpy(frame.rows[1].label,"Load game module");strcpy(frame.rows[1].detail,"Open the target game first.");strcpy(frame.metrics,"60 FPS");
 CHECK(tac_deck_view_render(&view,&frame,0,0,900)==1);
 CHECK(sceneAdds==0&&!view.overlayScene&&!view.root&&view.sceneStatus==8);
 TacDeckRenderState state=tac_deck_render_state(1,0,frame.sequence,900);
 CHECK(state.ready&&!state.visible&&!state.close&&state.heartbeat==900);
 CHECK(tac_deck_view_render(&view,&frame,1,0,1000));CHECK(allocated==1+TAC_DECK_STYLES+TAC_DECK_INKS+TAC_DECK_BACKGROUNDS+TAC_DECK_PANELS+TAC_DECK_LABELS);
 CHECK(sceneAdds==1&&view.overlayScene&&view.parentScene&&view.sceneAttached);
 Obj* overlay=handle_target(view.overlayScene);CHECK(overlay->visible&&overlay->width==1920&&overlay->height==1080);
 CHECK(overlay->backgroundMode==7&&overlay->background==0&&overlay->backgroundLimit==0);
 CHECK(((Obj*)handle_target(view.panels[0]))->visible);CHECK(((Obj*)handle_target(view.panels[5]))->y==328);
 CHECK(!strcmp(((Obj*)handle_target(view.labels[29]))->text,"Start watcher"));
 unsigned calls=invocations,allocations=stringCount;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1001));CHECK(invocations==calls&&stringCount==allocations);
 unsigned themeWrites=textCalls,themeObjects=allocated;frame.flags|=16;frame.sequence++;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1001));CHECK(view.painted.labels[0].ink==TAC_INK_TEXT);
 CHECK(view.painted.panels[5].ink==10);CHECK(textCalls==themeWrites&&allocated==themeObjects);
 calls=invocations;CHECK(tac_deck_view_render(&view,&frame,1,0,1001));CHECK(invocations==calls);
 unsigned writes=textCalls;strcpy(frame.metrics,"59.8 FPS");frame.metricsSequence++;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1002));CHECK(textCalls==writes+1);
 CHECK(!strcmp(((Obj*)handle_target(view.labels[29]))->text,"Start watcher"));
 CHECK(tac_deck_view_render(&view,&frame,1,1,1003));CHECK(!strcmp(((Obj*)handle_target(view.labels[39]))->text,""));
 CHECK(((Obj*)handle_target(view.panels[5]))->y==386);
 CHECK(tac_deck_view_render(&view,&frame,0,1,1004)==1);
 CHECK(!view.overlayScene&&!view.parentScene&&!view.root&&view.sceneStatus==8);
 for(unsigned i=0;i<TAC_DECK_LABELS;i++)CHECK(!view.labels[i]);
 for(unsigned i=0;i<TAC_DECK_PANELS;i++)CHECK(!view.panels[i]);
 CHECK(sceneRemoves==1&&removed==TAC_DECK_LABELS+TAC_DECK_PANELS);
 calls=invocations;CHECK(tac_deck_view_render(&view,&frame,0,1,1005)==1);CHECK(invocations==calls);
 // First load and repeated closed frames must never attach a scene, even with
 // metrics/IP requested. The open chord remains ready while there is no view.
 CHECK(view.initialized&&!view.sceneAttached);
 view.animate=1;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1100)==1);CHECK(sceneAdds==2&&view.moving);
 CHECK(((Obj*)handle_target(view.panels[1]))->x==320);
 calls=invocations;allocations=stringCount;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1101)==1);CHECK(invocations==calls);
 CHECK(tac_deck_view_render(&view,&frame,1,0,1133)==1);CHECK(invocations>calls&&stringCount==allocations);
 CHECK(tac_deck_view_render(&view,&frame,1,0,1320)==1);CHECK(!view.moving&&view.painted.panels[1].x==256);
 calls=invocations;CHECK(tac_deck_view_render(&view,&frame,1,0,1321)==1);CHECK(invocations==calls);
 view.animate=0;
 sceneAvailable=0;CHECK(!tac_deck_view_render(&view,&frame,1,0,1400));CHECK(!view.root&&!view.paintedValid);
 CHECK(removed==(TAC_DECK_LABELS+TAC_DECK_PANELS)*2);
 CHECK(sceneRemoves==2&&!view.overlayScene&&!view.parentScene);
 sceneAvailable=1;rootIndex=1;frame.flags=3;
 // A hidden or incompatible foreground scene must not provide readiness or
 // invoke UI2.RootWidget against an object with another managed ABI.
 unsigned rootsBefore=rootCalls;sceneVisible=0;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1500)==2);CHECK(!view.root&&rootCalls==rootsBefore);
 CHECK(view.overlayScene&&view.sceneAttached); // Attached scene can become visible on a later UI tick.
 sceneVisible=1;compatibleScene=0;
 CHECK(!tac_deck_view_render(&view,&frame,1,0,1600));CHECK(!view.root&&rootCalls==rootsBefore);
 CHECK(!view.overlayScene&&!view.parentScene);
 compatibleScene=1;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1700));CHECK(!strcmp(((Obj*)handle_target(view.labels[29]))->text,"Start watcher"));
 failText=1;frame.sequence++;strcpy(frame.rows[0].label,"Changed");
 CHECK(!tac_deck_view_render(&view,&frame,1,0,1701));CHECK(view.failed&&!view.root);CHECK(removed==(TAC_DECK_LABELS+TAC_DECK_PANELS)*3);
 calls=invocations;CHECK(!tac_deck_view_render(&view,&frame,1,0,1702));CHECK(invocations==calls);
 // A constructor exception must not leave a half-created backplate or roots.
 view.failed=0;failPanel=1;unsigned beforeAppend=appended;
 CHECK(!tac_deck_view_render(&view,&frame,1,0,2000));CHECK(view.failed&&!view.root);
 for(unsigned i=0;i<TAC_DECK_PANELS;i++)CHECK(!view.panels[i]);
 CHECK(removed==(TAC_DECK_LABELS+TAC_DECK_PANELS)*3);CHECK(appended==beforeAppend);
 // A transient error in both hide and removal retains the orphan's GC root.
 view.failed=0;CHECK(tac_deck_view_render(&view,&frame,1,0,3000));
 uint32_t retained=view.panels[0];failingObject=handle_target(retained);CHECK(failingObject->visible);
 failHide=failRemove=1;failText=1;frame.sequence++;strcpy(frame.rows[0].label,"Another failure");
 CHECK(!tac_deck_view_render(&view,&frame,1,0,3001));CHECK(view.failed&&view.root);
 CHECK(view.panels[0]==retained&&handle_target(retained)==failingObject&&failingObject->visible);
 for(unsigned i=0;i<TAC_DECK_LABELS;i++)CHECK(!view.labels[i]);
 for(unsigned i=1;i<TAC_DECK_PANELS;i++)CHECK(!view.panels[i]);
 calls=invocations;CHECK(!tac_deck_view_render(&view,&frame,1,0,3200));CHECK(calls==invocations);
 CHECK(!tac_deck_view_render(&view,&frame,1,0,3251));CHECK(view.failed&&!view.root&&!view.panels[0]);
 CHECK(!handle_target(retained)&&failingObject->removed&&!failingObject->visible);
 for(unsigned i=0;i<TAC_DECK_STYLES;i++)CHECK(!view.fonts[i]);
 for(unsigned i=0;i<TAC_DECK_INKS;i++)CHECK(!view.colors[i]);
 for(unsigned i=0;i<TAC_DECK_BACKGROUNDS;i++)CHECK(!view.backgrounds[i]);
 calls=invocations;CHECK(!tac_deck_view_render(&view,&frame,1,0,5000));CHECK(calls==invocations);
 // A scene removal exception must retain its handles and retry cleanup even
 // after every widget has been removed. Do not leave an orphaned overlay.
 view.failed=0;CHECK(tac_deck_view_render(&view,&frame,1,0,6000));
 uint32_t sceneHandle=view.overlayScene;failSceneRemove=1;failText=1;frame.sequence++;strcpy(frame.rows[0].label,"Scene cleanup failure");
 CHECK(!tac_deck_view_render(&view,&frame,1,0,6001));CHECK(view.failed&&!view.root&&view.overlayScene==sceneHandle);
 CHECK(!tac_deck_view_render(&view,&frame,1,0,6251));CHECK(!view.overlayScene&&!view.parentScene&&!handle_target(sceneHandle));
 // An unseen scene may become visible on a later frame, but must not remain
 // attached indefinitely if ShellUI never activates it.
 view.failed=0;sceneVisible=0;
 CHECK(tac_deck_view_render(&view,&frame,1,0,7000)==2);
 state=tac_deck_render_state(2,1,frame.sequence,7000);
 CHECK(!state.ready&&!state.visible&&!state.close&&!state.heartbeat);
 CHECK(tac_deck_view_render(&view,&frame,1,0,7250)==2);
 CHECK(!tac_deck_view_render(&view,&frame,1,0,9000));
 CHECK(view.failed&&!view.overlayScene&&!view.parentScene&&!view.root);
 state=tac_deck_render_state(0,1,frame.sequence,9000);
 CHECK(!state.ready&&!state.visible&&state.close&&!state.heartbeat);
 // The independent HUD renders only four labels / three small panels. It
 // cannot retain menu chrome, capture input, or poison the main view on error.
 sceneVisible=1;frame.flags=3;strcpy(frame.ip,"192.168.1.20");strcpy(frame.metrics,"FPS 60");
 CHECK(tac_deck_view_render(&hud,&frame,0,0,10000)==1);
 CHECK(hud.overlayScene&&hud.root&&!hud.open);
 for(unsigned i=0;i<TAC_DECK_LABELS;i++)CHECK(!!hud.labels[i]==(i>=41&&i<=44));
 for(unsigned i=0;i<TAC_DECK_PANELS;i++)CHECK(!!hud.panels[i]==(i>=9&&i<=11));
 CHECK(((Obj*)handle_target(hud.panels[11]))->y==1000);
 CHECK(!strcmp(((Obj*)handle_target(hud.labels[42]))->text,"FPS 60"));
 calls=invocations;CHECK(tac_deck_view_render(&hud,&frame,0,0,10001)==1);CHECK(calls==invocations);
 TacDeckFrame empty={0};CHECK(tac_deck_view_render(&hud,&empty,0,0,10002)==1);CHECK(!hud.root&&!hud.overlayScene);
 CHECK(tac_deck_view_render(&hud,&frame,0,0,11000)==1);
 failText=1;frame.metricsSequence++;strcpy(frame.metrics,"FPS 59");
 CHECK(!tac_deck_view_render(&hud,&frame,0,0,11001));CHECK(hud.failed&&!hud.overlayScene);
 view.failed=0;CHECK(tac_deck_view_render(&view,&frame,1,0,12000)==1);CHECK(!view.failed&&view.root);
 puts("Production native view cache, independent HUD, scene replacement and failure release passed");return 0;
}
