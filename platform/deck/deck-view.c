// SPDX-License-Identifier: GPL-3.0-or-later
// PUI entry points informed by etaHEN / LightningMods' overlay-ui and MonoUtils.
// Original TacHen view, metadata validation and managed-object lifetime handling.
#include "deck-view.h"
#include <string.h>
#include <stdio.h>
#include <stddef.h>
static void* call(TacDeckView* v,void* method,void* object,void** args,int* ok){
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
  if(!signature||v->mono.mono_signature_get_param_count(signature)!=1||type(v,v->mono.mono_signature_get_return_type(signature))!=1)return NULL;
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
 v->widget=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI.UI2","Widget");
 v->font=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI.UI2","UIFont");
 v->color=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI","UIColor");
 void* application=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI","Application");
 void* gamepad=v->mono.mono_class_from_name(core,"Sce.PlayStation.Core.Input","GamePad");
 void* layer=v->mono.mono_class_from_name(app,"Sce.Vsh.ShellUI.AppSystem","LayerManager");
 void* scene=v->mono.mono_class_from_name(pui,"Sce.PlayStation.PUI.UI2","Scene");
 if(!v->label||!v->widget||!v->font||!v->color||!application||!gamepad||!layer||!scene)goto done;
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
 v->fontCtor=method(v,v->font,".ctor",3,0,1,fontTypes);
 v->colorCtor=method(v,v->color,".ctor",4,0,1,colorTypes);
 v->text=setter(v,v->label,"Text",0x0e);v->name=setter(v,v->label,"Name",0x0e);
 v->x=setter(v,v->label,"X",0x0c);v->y=setter(v,v->label,"Y",0x0c);
 v->width=setter(v,v->label,"FitWidthToText",2);v->height=setter(v,v->label,"FitHeightToText",2);
 v->textColor=setter(v,v->label,"TextColor",0x11);v->labelFont=setter(v,v->label,"Font",0x11);
 uint32_t alignment=0;
 if(!v->mono.mono_class_is_valuetype(v->font)||!v->mono.mono_class_is_valuetype(v->color)||v->mono.mono_class_value_size(v->color,&alignment)!=16)goto done;
 if(!v->findScene||!v->getRoot||!v->append||!v->remove||!v->labelCtor||!v->fontCtor||!v->colorCtor||!v->text||!v->name||
  !v->x||!v->y||!v->width||!v->height||!v->textColor||!v->labelFont)goto done;
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
 int ok=1;const int sizes[]={38,26,19};
 for(unsigned i=0;i<3;i++){
  v->fonts[i]=object(v,v->font);v->colors[i]=object(v,v->color);if(!v->fonts[i]||!v->colors[i])return 0;
  int size=sizes[i],style=0,weight=0;void* fa[]={&size,&style,&weight};
  call(v,v->fontCtor,v->mono.mono_object_unbox(target(v,v->fonts[i])),fa,&ok);
  float r=i==0?0.36f:i==1?0.95f:0.64f,g=i==0?1.0f:i==1?0.97f:0.7f,b=i==0?0.77f:i==1?1.0f:0.75f,a=1;
  void* ca[]={&r,&g,&b,&a};call(v,v->colorCtor,v->mono.mono_object_unbox(target(v,v->colors[i])),ca,&ok);
 }return ok;
}
static void release_labels(TacDeckView* v){
 int ok=1;for(unsigned i=0;i<21;i++)if(v->labels[i]){set_text(v,v->labels[i],"",&ok);call(v,v->remove,target(v,v->labels[i]),NULL,&ok);v->mono.mono_gchandle_free(v->labels[i]);v->labels[i]=0;}
 if(v->root)v->mono.mono_gchandle_free(v->root);v->root=0;
}
static int labels(TacDeckView* v,uint32_t root){
 v->root=root;if(!v->root)return 0;int ok=1;
 for(unsigned i=0;i<21&&ok;i++){
  v->labels[i]=object(v,v->label);void* label=target(v,v->labels[i]);if(!label)return 0;
  call(v,v->labelCtor,label,NULL,&ok);char name[48];snprintf(name,sizeof name,"TacHenDeck_%u",i);
  set(v,v->name,label,v->mono.mono_string_new(v->domain,name),&ok);
  unsigned row=i>=3?(i-3)/2:0;
  float x=i==19?1480.0f:100.0f,y=i==0?75:i==1?132:i==2?920:i==19?1020:i==20?975:205+row*82+(i%2==0?34:0);
  set(v,v->x,label,&x,&ok);set(v,v->y,label,&y,&ok);uint8_t yes=1;
  set(v,v->width,label,&yes,&ok);set(v,v->height,label,&yes,&ok);
  unsigned font=i==0?0:(i>=3&&i<19&&i%2==1)?1:2;
  set(v,v->labelFont,label,v->mono.mono_object_unbox(target(v,v->fonts[font])),&ok);
  set(v,v->textColor,label,v->mono.mono_object_unbox(target(v,v->colors[font==0?0:font])),&ok);
  set_text(v,v->labels[i],"",&ok);void* args[]={label};call(v,v->append,target(v,v->root),args,&ok);
 }return ok;
}
int tac_deck_view_render(TacDeckView* v,const TacDeckFrame* f,int open,unsigned selected,uint64_t now){
 if(v->failed)return 0;int ok=1;
 if(!v->initialized){if(!styles(v)){v->failed=1;return 0;}v->initialized=1;}
 if(!v->root||now-v->checkedAt>=250){
  v->checkedAt=now;void* arg[]={v->mono.mono_string_new(v->domain,"Game")};
  void* scene=call(v,v->findScene,NULL,arg,&ok);void* root=scene&&ok?call(v,v->getRoot,scene,NULL,&ok):NULL;
  if(!ok)return 0;if(!root){release_labels(v);return 0;}
  if(root!=target(v,v->root)){
   uint32_t pinned=v->mono.mono_gchandle_new(root,1);if(!pinned)return 0;
   release_labels(v);if(!labels(v,pinned)){release_labels(v);v->failed=1;return 0;}v->sequence=0;v->metricsSequence=0;
  }
 }
 int menuChanged=v->sequence!=f->sequence||v->selected!=selected||v->open!=open||v->ipVisible!=!!(f->flags&2);
 if(!menuChanged&&v->metricsSequence==f->metricsSequence)return 1;
 if(v->metricsSequence!=f->metricsSequence) set_text(v,v->labels[20],(f->flags&1)?f->metrics:"",&ok);
 if(menuChanged){
 set_text(v,v->labels[0],open?f->title:"",&ok);set_text(v,v->labels[1],open?f->subtitle:"",&ok);set_text(v,v->labels[2],open?f->footer:"",&ok);
 for(unsigned i=0;i<8;i++){
  char label[112]={0};if(open&&i<f->count)snprintf(label,sizeof label,"%s %s",selected==i?">":" ",f->rows[i].label);
  set_text(v,v->labels[3+i*2],label,&ok);set_text(v,v->labels[4+i*2],open&&i<f->count?f->rows[i].detail:"",&ok);
  unsigned style=i<f->count&&(f->rows[i].flags&1)?(selected==i?0:1):2;
  void* color=v->mono.mono_object_unbox(target(v,v->colors[style]));set(v,v->textColor,target(v,v->labels[3+i*2]),color,&ok);
 }
 set_text(v,v->labels[19],(f->flags&2)?f->ip:"",&ok);
 }
 if(!ok){release_labels(v);v->failed=1;return 0;}
 v->sequence=f->sequence;v->metricsSequence=f->metricsSequence;v->selected=selected;v->open=open;v->ipVisible=!!(f->flags&2);return 1;
}
