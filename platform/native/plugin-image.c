// SPDX-License-Identifier: GPL-3.0-or-later
// etaHEN_PLUGIN container layout: see NOTICE.md. Identity belongs to the
// plugin itself; it must never be interpreted as the target game's title ID.
#include "plugin-image.h"
#include "elf-image.h"
#include <string.h>
#include <stdio.h>
int tac_plugin_inspect(const uint8_t *data,size_t size,TacPluginImage *plugin,char *reason,size_t capacity){
  if(!data||!plugin||size<TAC_PLUGIN_HEADER+64||size>128*1024*1024||
     memcmp(data,"etaHEN_PLUGIN\0",14)||data[23]||data[28])goto bad;
  for(size_t i=14;i<23;i++){
    unsigned c=data[i];
    if(i<18 ? !((c>='a'&&c<='z')||(c>='A'&&c<='Z')) : !(c>='0'&&c<='9'))goto bad;
  }
  if(data[24]<'0'||data[24]>'9'||data[25]!='.'||data[26]<'0'||data[26]>'9'||data[27]<'0'||data[27]>'9')goto bad;
  TacElfImage elf;if(tac_elf_inspect(data+TAC_PLUGIN_HEADER,size-TAC_PLUGIN_HEADER,&elf,reason,capacity))return -1;
  memset(plugin,0,sizeof *plugin);memcpy(plugin->id,data+14,9);memcpy(plugin->version,data+24,4);plugin->offset=TAC_PLUGIN_HEADER;return 0;
bad:
  if(reason&&capacity)snprintf(reason,capacity,"Invalid etaHEN .plugin container; no process was started");return -1;
}
