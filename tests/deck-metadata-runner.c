// SPDX-License-Identifier: GPL-3.0-or-later
// Synthetic metadata models the two overloads observed on the user's 13.60
// console. No Sony binaries or copied metadata are included in this fixture.
#include "../platform/deck/deck-view.c"
#include "../platform/deck/deck-bootstrap.h"
#include "../platform/native/deck-protection.h"
#define CHECK(x) do{if(!(x)){fprintf(stderr,"line %d: %s\n",__LINE__,#x);return 1;}}while(0)
typedef struct {int kind;void* klass;} Type;
typedef struct {const char* name;unsigned flags,count;Type result,param;} Method;
static Method methods[4];static unsigned total;static int widget,internal,klass;
int tac_mono_load(TacMono* unused){(void)unused;return 0;}
static void* next(void* k,void** it){(void)k;size_t i=(size_t)*it;*it=(void*)(i+1);return i<total?&methods[i]:NULL;}
static const char* name(void* m){return ((Method*)m)->name;}
static uint32_t flags(void* m,uint32_t* unused){(void)unused;return ((Method*)m)->flags;}
static void* signature(void* m){return m;}
static uint32_t count(void* m){return ((Method*)m)->count;}
static void* result(void* m){return &((Method*)m)->result;}
static void* param(void* m,void** it){(void)it;return &((Method*)m)->param;}
static int kind(void* t){return ((Type*)t)->kind;}
static void* type_class(void* t){return ((Type*)t)->klass;}
int main(void){
 TacDeckView v={0};v.mono.mono_class_get_methods=next;v.mono.mono_method_get_name=name;
 v.mono.mono_method_get_flags=flags;v.mono.mono_method_signature=signature;
 v.mono.mono_signature_get_param_count=count;v.mono.mono_signature_get_return_type=result;
 v.mono.mono_signature_get_params=param;v.mono.mono_type_get_type=kind;v.mono.mono_class_from_mono_type=type_class;
 methods[0]=(Method){"AppendChild",0,1,{1,NULL},{0x12,&internal}};
 methods[1]=(Method){"AppendChild",0,1,{1,NULL},{0x12,&widget}};total=2;
 CHECK(method(&v,&klass,"AppendChild",1,0,1,NULL)==NULL);
 CHECK(object_method(&v,&klass,"AppendChild",&widget)==&methods[1]);
 methods[2]=methods[1];total=3;CHECK(!object_method(&v,&klass,"AppendChild",&widget));
 methods[2].flags=16;CHECK(object_method(&v,&klass,"AppendChild",&widget)==&methods[1]);
 methods[1].param.kind=0x10;CHECK(!object_method(&v,&klass,"AppendChild",&widget));
 methods[1].param.kind=0x12;methods[1].result.kind=8;CHECK(!object_method(&v,&klass,"AppendChild",&widget));
 methods[1].result.kind=1;methods[1].count=2;CHECK(!object_method(&v,&klass,"AppendChild",&widget));
 CHECK(!strcmp(tac_deck_prepare_error(112),"append"));
 TacDeckPatch patch={.address=0x12340000};memset(patch.before,0x90,14);
 patch.after[0]=0xff;patch.after[1]=0x25;patch.after[6]=0x42;
 CHECK(tac_deck_final_protection(4,&patch,patch.address,patch.after,14)==5);
 CHECK(tac_deck_final_protection(4,&patch,patch.address,patch.before,14)==4);
 CHECK(tac_deck_final_protection(5,&patch,patch.address,patch.after,14)==5);
 CHECK(tac_deck_final_protection(3,&patch,patch.address,patch.after,14)==-1);
 CHECK(tac_deck_final_protection(4,&patch,patch.address+1,patch.after,14)==-1);
 CHECK(tac_deck_final_protection(4,&patch,patch.address,patch.after,13)==-1);
 unsigned char unknown[14]={0};CHECK(tac_deck_final_protection(4,&patch,patch.address,unknown,14)==-1);
 void* update=(void*)1;void* input=(void*)1;
 volatile uint32_t trace=0;CHECK(!tac_deck_view_prepare(&v,&update,&input,&trace));CHECK(trace==101);CHECK(v.prepareError==101&&!update&&!input);
 puts("Exact Widget overload, incompatible/ambiguous rejection, preparation diagnostics and readable jump rollback passed");return 0;
}
