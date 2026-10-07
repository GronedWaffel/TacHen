// SPDX-License-Identifier: GPL-3.0-or-later
#include "mono-api.h"
#include <ps5/kernel.h>
#include <unistd.h>
#include <string.h>
int tac_mono_load(TacMono* api){
 uint32_t handle=0;memset(api,0,sizeof *api);
 // Read-only lookup; never temporarily replace ShellUI's process credentials.
 if(kernel_dynlib_handle(getpid(),"libmonosgen-2.0.sprx",&handle))return 0;
#define RESOLVE(ret,name,args) api->name=(ret (*) args)kernel_dynlib_dlsym(getpid(),handle,#name);if(!api->name)return 0;
 TAC_MONO_API(RESOLVE)
#undef RESOLVE
 return 1;
}
