// SPDX-License-Identifier: GPL-3.0-or-later
// PUI entry points informed by etaHEN / LightningMods' overlay-ui and MonoUtils.
// Original TacHen view, metadata validation and managed-object lifetime handling.
#include "deck-view.h"
#include <string.h>
#include <stdio.h>
#include <stddef.h>
static void* call(TacDeckView* v,void* method,void* object,void** args,int* ok){
 if(!*ok)return NULL;
 if(!method){*ok=0;return NULL;}void* exception=NULL;void* result=v->mono.mono_runtime_invoke(method,object,args,&exception);
 if(exception)*ok=0;return result;
}
static void* image(TacDeckView* v,const char* name){
 char path[192];snprintf(path,sizeof path,"/system_ex/common_ex/lib/%s",name);
 void* assembly=v->mono.mono_domain_assembly_open(v->domain,path);return assembly?v->mono.mono_assembly_get_image(assembly):NULL;
}
static int type(TacDeckView* v,void* t){return t?v->mono.mono_type_get_type(t):-1;}
static void* method(TacDeckView* v,void* klass,const char* name,unsigned count,int isStatic,int returnType,const int* parameters){
 void* iterator=NULL;void* found=NULL;void* m;
 while(klass&&(m=v->mono.mono_class_get_methods(klass,&iterator))){
  if(strcmp(v->mono.mono_method_get_name(m),name))continue;
  void* signature=v->mono.mono_method_signature(m);if(!signature||v->mono.mono_signature_get_param_count(signature)!=count)continue;
  uint32_t flags=v->mono.mono_method_get_flags(m,NULL);if(!!(flags&16)!=isStatic)continue;
  if(returnType>=0&&type(v,v->mono.mono_signature_get_return_type(signature))!=returnType)continue;
  void* it=NULL;unsigned i;for(i=0;i<count;i++)if(parameters){
   void* parameter=v->mono.mono_signature_get_params(signature,&it);int actual=type(v,parameter);
   if(parameters[i]==-2){
    if(actual==8||actual==9)continue;
    void* ec=v->mono.mono_class_from_mono_type(parameter);
    if(actual!=0x11||!ec||!v->mono.mono_class_is_enum(ec))break;
    int base=type(v,v->mono.mono_class_enum_basetype(ec));if(base!=8&&base!=9)break;
   }else if(actual!=parameters[i])break;
  }
  if(i!=count)continue;if(found)return NULL;found=m;
 }
 return found;
}
static void* setter(TacDeckView* v,void* klass,const char* name,int valueType){
 for(unsigned depth=0;klass&&depth<12;depth++,klass=v->mono.mono_class_get_parent(klass)){
  void* property=v->mono.mono_class_get_property_from_name(klass,name);if(!property)continue;
  void* m=v->mono.mono_property_get_set_method(property);if(!m)return NULL;
  void* signature=v->mono.mono_method_signature(m);void* it=NULL;
  if((v->mono.mono_method_get_flags(m,NULL)&16)||!signature||v->mono.mono_signature_get_param_count(signature)!=1||type(v,v->mono.mono_signature_get_return_type(signature))!=1)return NULL;
  if(valueType>=0&&type(v,v->mono.mono_signature_get_params(signature,&it))!=valueType)return NULL;return m;
 }return NULL;
}
static int pad_abi(TacDeckView* v,void* get){
 void* signature=v->mono.mono_method_signature(get);void* t=v->mono.mono_signature_get_return_type(signature);
 if(type(v,t)!=0x11)return 0;void* klass=v->mono.mono_class_from_mono_type(t);uint32_t align=0;
 if(!klass||!v->mono.mono_class_is_valuetype(klass)||v->mono.mono_class_value_size(klass,&align)!=36||align!=4)return 0;
 const char* names[]={"Skip","Buttons","ButtonsPrev","ButtonsDown","ButtonsUp","AnalogLeftX","AnalogLeftY","AnalogRightX","AnalogRightY"};
 const unsigned offsets[]={0,4,8,12,16,20,24,28,32};
 for(unsigned i=0;i<9;i++){
  void* field=v->mono.mono_class_get_field_from_name(klass,names[i]);
  if(!field||v->mono.mono_field_get_offset(field)!=16+offsets[i])return 0;
  void* ft=v->mono.mono_field_get_type(field);int actual=type(v,ft);
  if(i==0){if(actual!=2)return 0;}
  else if(i>=5){if(actual!=0x0c)return 0;}
  else{void* ec=v->mono.mono_class_from_mono_type(ft);
   if(actual!=0x11||!ec||!v->mono.mono_class_is_enum(ec)||type(v,v->mono.mono_class_enum_basetype(ec))!=9)return 0;}
 }
 return 1;
}
int tac_deck_view_prepare(TacDeckView* v,void** update,void** input){
 memset(v,0,sizeof *v);*update=NULL;*input=NULL;
 if(!tac_mono_load(&v->mono)||(v->domain=v->mono.mono_get_root_domain())==NULL)return 0;
 void* thread=v->mono.mono_thread_attach(v->domain);if(!thread)return 0;int ok=0;
 void* pui=image(v,"Sce.PlayStation.PUI.dll"),*core=image(v,"Sce.PlayStation.Core.dll"),*app=image(v,"Sce.Vsh.ShellUI.AppSystem.dll");
 if(!pui||!core||!app)goto done;
 v->label=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI.UI2","Label");
 v->panel=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI.UI2","Panel");
 v->widget=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI.UI2","Widget");
 v->font=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI.UI2","UIFont");
 v->color=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI","UIColor");
 void* application=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI","Application");
 void* gamepad=v->mono.mono_class_from_name(core,"Sce.PlayStation.Core.Input","GamePad");
 void* layer=v->mono.mono_class_from_name(app,"Sce.Vsh.ShellUI.AppSystem","LayerManager");
 void* scene=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI.UI2","Scene");
 if(!v->label||!v->panel||!v->widget||!v->font||!v->color||!application||!gamepad||!layer||!scene)goto done;
 void* parent=v->panel;unsigned depth=0;
 while(parent&&parent!=v->widget&&depth++<12)parent=v->mono.mono_class_get_parent(parent);
 if(parent!=v->widget)goto done;
 int i32[]={8},str[]={0x0e},fontTypes[]={8,-2,-2},colorTypes[]={0x0c,0x0c,0x0c,0x0c};
 void* tick=method(v,application,"Update",0,0,1,NULL);
 void* get=method(v,gamepad,"GetData",1,1,0x11,i32);
 if(!tick||!get||!pad_abi(v,get))goto done;
 v->findScene=method(v,layer,"FindContainerSceneByPath",1,1,-1,str);
 void* property=v->mono.mono_class_get_property_from_name(scene,"RootWidget");
 v->getRoot=property?v->mono.mono_property_get_get_method(property):NULL;
 v->append=method(v,v->widget,"AppendChild",1,0,1,NULL);
 v->remove=method(v,v->widget,"RemoveFromParent",0,0,1,NULL);
 v->labelCtor=method(v,v->label,".ctor",0,0,1,NULL);
 v->panelCtor=method(v,v->panel,".ctor",0,0,1,NULL);
 v->panelWidth=setter(v,v->panel,"Width",0x0c);v->panelHeight=setter(v,v->panel,"Height",0x0c);
 v->panelColor=setter(v,v->panel,"BackgroundColor",0x11);v->panelVisible=setter(v,v->panel,"Visible",2);
 v->fontCtor=method(v,v->font,".ctor",3,0,1,fontTypes);
 v->colorCtor=method(v,v->color,".ctor",4,0,1,colorTypes);
 v->text=setter(v,v->label,"Text",0x0e);v->name=setter(v,v->widget,"Name",0x0e);
 v->x=setter(v,v->widget,"X",0x0c);v->y=setter(v,v->widget,"Y",0x0c);
 v->width=setter(v,v->label,"FitWidthToText",2);v->height=setter(v,v->label,"FitHeightToText",2);
 v->textColor=setter(v,v->label,"TextColor",0x11);v->labelFont=setter(v,v->label,"Font",0x11);
 uint32_t alignment=0;
 if(!v->mono.mono_class_is_valuetype(v->font)||!v->mono.mono_class_is_valuetype(v->color)||v->mono.mono_class_value_size(v->color,&alignment)!=16)goto done;
 if(!v->findScene||!v->getRoot||!v->append||!v->remove||!v->labelCtor||!v->fontCtor||!v->colorCtor||!v->text||!v->name||
  !v->x||!v->y||!v->width||!v->height||!v->textColor||!v->labelFont)goto done;
 if(!v->panelCtor||!v->panelWidth||!v->panelHeight||!v->panelColor||!v->panelVisible)goto done;
 void* colorSignature=v->mono.mono_method_signature(v->panelColor),*colorIterator=NULL;
 if(v->mono.mono_class_from_mono_type(v->mono.mono_signature_get_params(colorSignature,&colorIterator))!=v->color)goto done;
 *update=v->mono.mono_compile_method(tick);*input=v->mono.mono_compile_method(get);ok=*update&&*input;
done:v->mono.mono_thread_detach(thread);return ok;
}
static void* target(TacDeckView* v,uint32_t h){return h?v->mono.mono_gchandle_get_target(h):NULL;}
static uint32_t object(TacDeckView* v,void* klass){void* o=v->mono.mono_object_new(v->domain,klass);return o?v->mono.mono_gchandle_new(o,1):0;}
static void set(TacDeckView* v,void* method,void* o,void* value,int* ok){void* args[]={value};call(v,method,o,args,ok);}
static void set_text(TacDeckView* v,uint32_t label,const char* text,int* ok){
 void* o=target(v,label);if(!o){*ok=0;return;}void* s=v->mono.mono_string_new(v->domain,text);if(!s){*ok=0;return;}set(v,v->text,o,s,ok);
}
static int styles(TacDeckView* v){
 int ok=1;
 for(unsigned i=0;i<TAC_DECK_STYLES&&ok;i++){
  v->fonts[i]=object(v,v->font);v->colors[i]=object(v,v->color);if(!v->fonts[i]||!v->colors[i])return 0;
  int size=tac_deck_font_sizes[i],style=0,weight=0;void* fa[]={&size,&style,&weight};
  call(v,v->fontCtor,v->mono.mono_object_unbox(target(v,v->fonts[i])),fa,&ok);
  float r=tac_deck_ink[i][0],g=tac_deck_ink[i][1],b=tac_deck_ink[i][2],a=tac_deck_ink[i][3];
  void* ca[]={&r,&g,&b,&a};call(v,v->colorCtor,v->mono.mono_object_unbox(target(v,v->colors[i])),ca,&ok);
 }
 for(unsigned i=0;i<TAC_DECK_BACKGROUNDS&&ok;i++){
  v->backgrounds[i]=object(v,v->color);if(!v->backgrounds[i])return 0;
  float r=tac_deck_background[i][0],g=tac_deck_background[i][1],b=tac_deck_background[i][2],a=tac_deck_background[i][3];
  void* ca[]={&r,&g,&b,&a};call(v,v->colorCtor,v->mono.mono_object_unbox(target(v,v->backgrounds[i])),ca,&ok);
 }
 return ok;
}
static void release_styles(TacDeckView* v){
 for(unsigned i=0;i<TAC_DECK_STYLES;i++){
  if(v->fonts[i])v->mono.mono_gchandle_free(v->fonts[i]);v->fonts[i]=0;
  if(v->colors[i])v->mono.mono_gchandle_free(v->colors[i]);v->colors[i]=0;
 }
 for(unsigned i=0;i<TAC_DECK_BACKGROUNDS;i++){
  if(v->backgrounds[i])v->mono.mono_gchandle_free(v->backgrounds[i]);v->backgrounds[i]=0;
 }
 v->initialized=0;
}
static int release_labels(TacDeckView* v){
 int complete=1;
 for(unsigned i=0;i<TAC_DECK_LABELS;i++)if(v->labels[i]){
  int ok=1;
  if(v->attachedLabels&(UINT64_C(1)<<i)){
   set_text(v,v->labels[i],"",&ok);ok=1; // Try removal even if hiding failed.
   call(v,v->remove,target(v,v->labels[i]),NULL,&ok);
  }
  if(!ok){complete=0;continue;}
  v->mono.mono_gchandle_free(v->labels[i]);v->labels[i]=0;v->attachedLabels&=~(UINT64_C(1)<<i);
 }
 for(unsigned i=0;i<TAC_DECK_PANELS;i++)if(v->panels[i]){
  int ok=1;
  if(v->attachedPanels&(1u<<i)){
   uint8_t hidden=0;set(v,v->panelVisible,target(v,v->panels[i]),&hidden,&ok);ok=1;
   call(v,v->remove,target(v,v->panels[i]),NULL,&ok);
  }
  if(!ok){complete=0;continue;}
  v->mono.mono_gchandle_free(v->panels[i]);v->panels[i]=0;v->attachedPanels&=~(1u<<i);
 }
 if(complete&&v->root){v->mono.mono_gchandle_free(v->root);v->root=0;}
 v->paintedValid=0;return complete;
}
static int hold_cleanup(TacDeckView* v,uint64_t now){v->failed=1;v->cleanupAt=now;return 0;}
static int fail_view(TacDeckView* v,uint64_t now){
 hold_cleanup(v,now);
 if(release_labels(v))release_styles(v);
 return 0;
}
static int labels(TacDeckView* v,uint32_t root){
 v->root=root;if(!v->root)return 0;int ok=1;
 TacDeckFrame empty={0};TacDeckLayout layout;tac_deck_layout(&empty,0,0,&layout);
 // Backgrounds are appended before labels. Create them hidden to avoid a flash
 // of partially constructed UI; visibility is published with the first frame.
 for(unsigned i=0;i<TAC_DECK_PANELS&&ok;i++){
  v->panels[i]=object(v,v->panel);void* p=target(v,v->panels[i]);if(!p)return 0;
  call(v,v->panelCtor,p,NULL,&ok);char name[48];snprintf(name,sizeof name,"TacHenPanel_%u",i);
  set(v,v->name,p,v->mono.mono_string_new(v->domain,name),&ok);uint8_t hidden=0;
  set(v,v->panelVisible,p,&hidden,&ok);void* args[]={p};
  if(ok){v->attachedPanels|=1u<<i;call(v,v->append,target(v,v->root),args,&ok);}
 }
 for(unsigned i=0;i<TAC_DECK_LABELS&&ok;i++){
  v->labels[i]=object(v,v->label);void* label=target(v,v->labels[i]);if(!label)return 0;
  call(v,v->labelCtor,label,NULL,&ok);char name[48];snprintf(name,sizeof name,"TacHenDeck_%u",i);
  set(v,v->name,label,v->mono.mono_string_new(v->domain,name),&ok);
  const TacDeckText* item=&layout.labels[i];float x=item->x,y=item->y;
  set(v,v->x,label,&x,&ok);set(v,v->y,label,&y,&ok);uint8_t yes=1;
  set(v,v->width,label,&yes,&ok);set(v,v->height,label,&yes,&ok);
  set(v,v->labelFont,label,v->mono.mono_object_unbox(target(v,v->fonts[item->font])),&ok);
  set(v,v->textColor,label,v->mono.mono_object_unbox(target(v,v->colors[item->ink])),&ok);
  set_text(v,v->labels[i],"",&ok);void* args[]={label};
  if(ok){v->attachedLabels|=UINT64_C(1)<<i;call(v,v->append,target(v,v->root),args,&ok);}
 }return ok;
}
int tac_deck_view_render(TacDeckView* v,const TacDeckFrame* f,int open,unsigned selected,uint64_t now){
 if(v->failed){
  // A transient RemoveFromParent failure must not orphan a visible backplate.
  // Keep roots and retry only cleanup at most four times per second. Input
  // remains disabled; do not recreate a scene or resume normal rendering.
  if(v->root&&(now<v->cleanupAt||now-v->cleanupAt>=250)){
   v->cleanupAt=now;if(release_labels(v))release_styles(v);
  }
  return 0;
 }
 int ok=1;
 if(!v->initialized){if(!styles(v))return fail_view(v,now);v->initialized=1;}
 if(!v->root||now-v->checkedAt>=250){
  v->checkedAt=now;void* arg[]={v->mono.mono_string_new(v->domain,"Game")};
  void* scene=call(v,v->findScene,NULL,arg,&ok);void* root=scene&&ok?call(v,v->getRoot,scene,NULL,&ok):NULL;
  if(!ok)return fail_view(v,now);if(!root){if(!release_labels(v))return hold_cleanup(v,now);return 0;}
  if(root!=target(v,v->root)){
   uint32_t pinned=v->mono.mono_gchandle_new(root,1);if(!pinned)return 0;
   if(!release_labels(v)){v->mono.mono_gchandle_free(pinned);return hold_cleanup(v,now);}
   if(!labels(v,pinned))return fail_view(v,now);v->sequence=0;v->metricsSequence=0;v->noticeSequence=0;
  }
 }
 int menuChanged=!v->paintedValid||v->sequence!=f->sequence||v->selected!=selected||v->open!=open||v->flags!=f->flags;
 int noticeVisible=!open&&(f->flags&1)&&f->notice.kind&&f->notice.remainingMs;
 int noticeChanged=v->noticeSequence!=f->notice.sequence||v->noticeVisible!=!!noticeVisible;
 if(!menuChanged&&v->metricsSequence==f->metricsSequence&&!noticeChanged)return 1;
 TacDeckLayout layout;tac_deck_layout(f,open,selected,&layout);
 for(unsigned i=0;i<TAC_DECK_LABELS&&ok;i++){
  const TacDeckText* current=&layout.labels[i];const TacDeckText* previous=&v->painted.labels[i];
  if(!v->paintedValid||strcmp(current->text,previous->text))set_text(v,v->labels[i],current->text,&ok);
  if(!v->paintedValid||current->ink!=previous->ink){
   void* color=v->mono.mono_object_unbox(target(v,v->colors[current->ink]));
   set(v,v->textColor,target(v,v->labels[i]),color,&ok);
  }
 }
 for(unsigned i=0;i<TAC_DECK_PANELS&&ok;i++){
  const TacDeckPanel* current=&layout.panels[i];const TacDeckPanel* previous=&v->painted.panels[i];void* p=target(v,v->panels[i]);
  if(!p){ok=0;break;}
  if(!v->paintedValid||current->x!=previous->x){float x=current->x;set(v,v->x,p,&x,&ok);}
  if(!v->paintedValid||current->y!=previous->y){float y=current->y;set(v,v->y,p,&y,&ok);}
  if(!v->paintedValid||current->width!=previous->width){float width=current->width;set(v,v->panelWidth,p,&width,&ok);}
  if(!v->paintedValid||current->height!=previous->height){float height=current->height;set(v,v->panelHeight,p,&height,&ok);}
  if(!v->paintedValid||current->ink!=previous->ink)set(v,v->panelColor,p,v->mono.mono_object_unbox(target(v,v->backgrounds[current->ink])),&ok);
  if(!v->paintedValid||current->visible!=previous->visible){uint8_t visible=(uint8_t)current->visible;set(v,v->panelVisible,p,&visible,&ok);}
 }
 if(!ok)return fail_view(v,now);
 v->painted=layout;v->paintedValid=1;
 v->sequence=f->sequence;v->metricsSequence=f->metricsSequence;v->noticeSequence=f->notice.sequence;v->noticeVisible=!!noticeVisible;
 v->selected=selected;v->open=open;v->flags=f->flags;return 1;
}
