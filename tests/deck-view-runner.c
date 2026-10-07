// SPDX-License-Identifier: GPL-3.0-or-later
// Managed-object boundary fixture. Exercises the production renderer/cache and
// failure cleanup; does not emulate PUI rendering or validate its console ABI.
#include "deck-view.h"
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#define CHECK(x) do{if(!(x)){fprintf(stderr,"line %d: %s\n",__LINE__,#x);return 1;}}while(0)
enum { FIND=1,ROOT,APPEND,REMOVE,CTOR,FONTCTOR,COLORCTOR,TEXT,NAME,X,Y,WIDTH,HEIGHT,COLOR,FONT,PWIDTH,PHEIGHT,PCOLOR,VISIBLE,PCTOR };
typedef struct {char text[256];unsigned removed,visible;float x,y,width,height;} Obj;
static Obj objects[512],roots[2];static void* handles[2048];static char strings[2048][256];
static unsigned allocated,nextHandle,stringCount,invocations,textCalls,removed,rootIndex,failText,failPanel;
static int sceneAvailable=1;
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
  case FIND:return sceneAvailable?(void*)1:NULL;
  case ROOT:return &roots[rootIndex];
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
int main(void){
 TacDeckView view={0};view.initialized=1;view.domain=(void*)1;view.label=(void*)2;
 view.mono.mono_object_new=object_new;view.mono.mono_gchandle_new=handle_new;
 view.mono.mono_gchandle_get_target=handle_target;view.mono.mono_gchandle_free=handle_free;
 view.mono.mono_object_unbox=unbox;view.mono.mono_string_new=string_new;view.mono.mono_runtime_invoke=invoke;
 view.findScene=(void*)FIND;view.getRoot=(void*)ROOT;view.append=(void*)APPEND;view.remove=(void*)REMOVE;
 view.labelCtor=(void*)CTOR;view.fontCtor=(void*)FONTCTOR;view.colorCtor=(void*)COLORCTOR;
 view.text=(void*)TEXT;view.name=(void*)NAME;view.x=(void*)X;view.y=(void*)Y;view.width=(void*)WIDTH;
 view.height=(void*)HEIGHT;view.textColor=(void*)COLOR;view.labelFont=(void*)FONT;
 view.panel=(void*)3;view.panelCtor=(void*)PCTOR;view.panelWidth=(void*)PWIDTH;view.panelHeight=(void*)PHEIGHT;
 view.panelColor=(void*)PCOLOR;view.panelVisible=(void*)VISIBLE;
 for(unsigned i=0;i<TAC_DECK_STYLES;i++)view.fonts[i]=handle_new(object_new(NULL,NULL),1);
 for(unsigned i=0;i<TAC_DECK_INKS;i++)view.colors[i]=handle_new(object_new(NULL,NULL),1);
 for(unsigned i=0;i<TAC_DECK_BACKGROUNDS;i++)view.backgrounds[i]=handle_new(object_new(NULL,NULL),1);
 TacDeckFrame frame={.flags=3,.sequence=1,.metricsSequence=1,.count=2,.page=1};
 strcpy(frame.title,"TacHen / Plugins");strcpy(frame.rows[0].label,"Start watcher");strcpy(frame.rows[0].detail,"Ready to start.");frame.rows[0].flags=1;
 strcpy(frame.rows[1].label,"Load game module");strcpy(frame.rows[1].detail,"Open the target game first.");strcpy(frame.metrics,"60 FPS");
 CHECK(tac_deck_view_render(&view,&frame,1,0,1000));CHECK(allocated==TAC_DECK_STYLES+TAC_DECK_INKS+TAC_DECK_BACKGROUNDS+TAC_DECK_PANELS+TAC_DECK_LABELS);
 CHECK(((Obj*)handle_target(view.panels[0]))->visible);CHECK(((Obj*)handle_target(view.panels[5]))->y==268);
 CHECK(!strcmp(((Obj*)handle_target(view.labels[29]))->text,"Start watcher"));
 unsigned calls=invocations,allocations=stringCount;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1001));CHECK(invocations==calls&&stringCount==allocations);
 unsigned themeWrites=textCalls,themeObjects=allocated;frame.flags|=16;frame.sequence++;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1001));CHECK(view.painted.labels[0].ink==6);
 CHECK(view.painted.panels[6].ink==10);CHECK(textCalls==themeWrites&&allocated==themeObjects);
 calls=invocations;CHECK(tac_deck_view_render(&view,&frame,1,0,1001));CHECK(invocations==calls);
 unsigned writes=textCalls;strcpy(frame.metrics,"59.8 FPS");frame.metricsSequence++;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1002));CHECK(textCalls==writes+1);
 CHECK(!strcmp(((Obj*)handle_target(view.labels[29]))->text,"Start watcher"));
 CHECK(tac_deck_view_render(&view,&frame,1,1,1003));CHECK(!strcmp(((Obj*)handle_target(view.labels[39]))->text,"Currently unavailable"));
 CHECK(((Obj*)handle_target(view.panels[5]))->y==334);
 CHECK(tac_deck_view_render(&view,&frame,0,1,1004));
 for(unsigned i=0;i<41;i++)CHECK(!((Obj*)handle_target(view.labels[i]))->text[0]);
 CHECK(!strcmp(((Obj*)handle_target(view.labels[42]))->text,"59.8 FPS"));
 for(unsigned i=0;i<9;i++)CHECK(!((Obj*)handle_target(view.panels[i]))->visible);
 CHECK(((Obj*)handle_target(view.panels[10]))->visible);
 frame.flags=0;CHECK(tac_deck_view_render(&view,&frame,0,1,1005));CHECK(!((Obj*)handle_target(view.labels[42]))->text[0]);
 for(unsigned i=0;i<TAC_DECK_PANELS;i++)CHECK(!((Obj*)handle_target(view.panels[i]))->visible);
 sceneAvailable=0;CHECK(!tac_deck_view_render(&view,&frame,0,0,1300));CHECK(!view.root&&!view.paintedValid);CHECK(removed==TAC_DECK_LABELS+TAC_DECK_PANELS);
 sceneAvailable=1;rootIndex=1;frame.flags=3;
 CHECK(tac_deck_view_render(&view,&frame,1,0,1600));CHECK(!strcmp(((Obj*)handle_target(view.labels[29]))->text,"Start watcher"));
 failText=1;frame.sequence++;strcpy(frame.rows[0].label,"Changed");
 CHECK(!tac_deck_view_render(&view,&frame,1,0,1601));CHECK(view.failed&&!view.root);CHECK(removed==(TAC_DECK_LABELS+TAC_DECK_PANELS)*2);
 calls=invocations;CHECK(!tac_deck_view_render(&view,&frame,1,0,1602));CHECK(invocations==calls);
 // A constructor exception must not leave a half-created backplate or roots.
 view.failed=0;failPanel=1;unsigned beforeAppend=appended;
 CHECK(!tac_deck_view_render(&view,&frame,1,0,2000));CHECK(view.failed&&!view.root);
 for(unsigned i=0;i<TAC_DECK_PANELS;i++)CHECK(!view.panels[i]);
 CHECK(removed==(TAC_DECK_LABELS+TAC_DECK_PANELS)*2);CHECK(appended==beforeAppend);
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
 puts("Production native view cache, metric isolation, scene replacement and failure release passed");return 0;
}
