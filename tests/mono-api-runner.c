#include <assert.h>
#include <string.h>
#include "../platform/deck/mono-api.c"
static int missingOptional,missingRequired,missingModule,optionalCalls;
int kernel_dynlib_handle(int pid,const char*name,uint32_t*out){assert(pid>0);assert(!strcmp(name,"libmonosgen-2.0.sprx"));*out=0x55;return missingModule;}
uintptr_t kernel_dynlib_dlsym(int pid,uint32_t handle,const char*name){
 assert(pid>0&&handle==0x55);
 if(!strcmp(name,"mono_string_length")||!strcmp(name,"mono_string_chars")){optionalCalls++;return missingOptional?0:0x2000;}
 if(missingRequired&&!strcmp(name,"mono_thread_attach"))return 0;
 return 0x1000;
}
int main(void){
 TacMono api;assert(tac_mono_load(&api));assert(optionalCalls==2&&api.mono_string_length&&api.mono_string_chars);
 missingOptional=1;assert(tac_mono_load(&api));assert(api.mono_thread_attach&&!api.mono_string_length&&!api.mono_string_chars);
 missingRequired=1;assert(!tac_mono_load(&api));missingRequired=0;missingModule=1;assert(!tac_mono_load(&api));return 0;
}
