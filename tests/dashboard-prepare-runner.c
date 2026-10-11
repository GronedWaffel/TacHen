#include "../platform/deck/dashboard.c"
#include <assert.h>
#define PTR(x) ((void*)(uintptr_t)(x))
typedef struct {unsigned cls;const char*name;int ret,count,isStatic;int params[8];} Method;
static Method methods[]={
 {101,"createJson",1,8,0,{0x12,0xe,0xe,0xe,0xe,0xe,0x12,2}},
 {102,"RejectInvalidURL",2,2,0,{0xe,0x12}}
};
static unsigned attached,detached,missingClass,missingMethod,missingCompile,missingRegistry;
int kernel_dynlib_handle(int p,const char*n,uint32_t*h){(void)p;assert(!strcmp(n,"libSceRegMgr.sprx"));*h=1;return 0;}
uintptr_t kernel_dynlib_dlsym(int p,uint32_t h,const char*n){(void)p;assert(h==1&&!strcmp(n,"sceRegMgrGetInt"));return missingRegistry?0:99;}
static void* attach(void*d){assert(d==PTR(1));attached++;return PTR(2);}
static void detach(void*t){assert(t==PTR(2));detached++;}
static void* assembly(void*d,const char*p){assert(d==PTR(1));assert(strstr(p,".dll"));return PTR(3);}
static void* image(void*a){return a;}
static void* class_name(void*i,const char*ns,const char*n){
 (void)i;(void)ns;const char*names[]={"OptionMenu","LinkingPSModule"};
 for(unsigned x=0;x<2;x++)if(!strcmp(n,names[x]))return missingClass==101+x?NULL:PTR(101+x);return NULL;
}
static void* field_name(void*c,const char*n){(void)c;return !strcmp(n,"optionsArray")?PTR(0x12):PTR(0xe);}
static void* field_type(void*f){return f;}static int type_id(void*t){return (int)(uintptr_t)t;}
static void* method_next(void*c,void**it){
 for(unsigned i=(unsigned)(uintptr_t)*it;i<2;i++)if(methods[i].cls==(uintptr_t)c&&missingMethod!=i+1){*it=PTR(i+1);return &methods[i];}return NULL;
}
static const char* method_name(void*f){return ((Method*)f)->name;}
static uint32_t flags(void*f,uint32_t*out){(void)out;return ((Method*)f)->isStatic?16:0;}
static void* signature(void*f){return f;}static uint32_t count(void*f){return ((Method*)f)->count;}
static void* result(void*f){return PTR(((Method*)f)->ret);}
static void* parameter(void*f,void**it){unsigned i=(unsigned)(uintptr_t)*it;*it=PTR(i+1);return PTR(((Method*)f)->params[i]);}
static void* compile(void*f){return missingCompile==(unsigned)((Method*)f-methods+1)?NULL:f;}
static int length(void*s){(void)s;return 0;}static const uint16_t* chars(void*s){(void)s;return NULL;}
int main(void){
 TacMono api={.mono_string_length=length,.mono_string_chars=chars,.mono_thread_attach=attach,.mono_thread_detach=detach,
 .mono_domain_assembly_open=assembly,.mono_assembly_get_image=image,.mono_class_from_name=class_name,
 .mono_class_get_field_from_name=field_name,.mono_field_get_type=field_type,.mono_type_get_type=type_id,
 .mono_class_get_methods=method_next,.mono_method_get_name=method_name,.mono_method_get_flags=flags,
 .mono_method_signature=signature,.mono_signature_get_param_count=count,.mono_signature_get_return_type=result,
 .mono_signature_get_params=parameter,.mono_compile_method=compile};
 void*targets[3]={0},*replacements[3]={0};
 assert(tac_dashboard_prepare(&api,PTR(1),targets,replacements));assert(!tac_dashboard_prepare_error());assert(attached==detached);
 assert(targets[0]==PTR(99)&&replacements[0]);for(unsigned i=0;i<2;i++)assert(targets[i+1]==&methods[i]&&replacements[i+1]);
 api.mono_string_length=NULL;assert(!tac_dashboard_prepare(&api,PTR(1),targets,replacements));assert(tac_dashboard_prepare_error()==1);api.mono_string_length=length;
 for(unsigned i=0;i<2;i++){missingClass=101+i;assert(!tac_dashboard_prepare(&api,PTR(1),targets,replacements));assert(tac_dashboard_prepare_error()==10+i);}missingClass=0;
 missingMethod=1;assert(!tac_dashboard_prepare(&api,PTR(1),targets,replacements));assert(tac_dashboard_prepare_error()==30);missingMethod=0;
 missingCompile=1;assert(!tac_dashboard_prepare(&api,PTR(1),targets,replacements));assert(tac_dashboard_prepare_error()==41);
 missingCompile=0;missingRegistry=1;assert(!tac_dashboard_prepare(&api,PTR(1),targets,replacements));assert(tac_dashboard_prepare_error()==31);
 assert(attached==detached);return 0;
}
