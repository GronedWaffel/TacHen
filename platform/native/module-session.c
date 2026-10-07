// SPDX-License-Identifier: GPL-3.0-or-later
#include "module-session.h"
#include "game-info.h"
#include "sha256.h"
#include <string.h>
#include <stdio.h>
int tac_hex_string(const char *s,size_t n){if(!s||strlen(s)!=n)return 0;for(size_t i=0;i<n;i++)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return 0;return 1;}
static void digest(const TacModuleSession *s,unsigned char out[32]){SHA256_CTX h;sha256_init(&h);sha256_update(&h,(const unsigned char*)s,offsetof(TacModuleSession,checksum));sha256_final(&h,out);}
void tac_module_seal(TacModuleSession *s){digest(s,s->checksum);}
int tac_module_decode(const void *bytes,size_t length,const char *generation,TacModuleSession *s){
  if(!bytes||!generation||length!=sizeof *s)return -1;memcpy(s,bytes,sizeof *s);unsigned char hash[32];digest(s,hash);
  if(memcmp(hash,s->checksum,32)||s->magic!=TAC_MODULE_SESSION_MAGIC||s->version!=1||s->phase>TAC_ARENA_UNKNOWN||s->pid<=1||
    s->generation[127]||s->title[9]||s->metadataHash[64]||strcmp(s->generation,generation)||!tac_game_title(s->title)||!tac_hex_string(s->metadataHash,64))return -1;
  if(s->phase==TAC_ARENA_READY&&(!s->cookie||s->arena<0x10000||s->arena>UINT64_C(0x7fffffffffff)-0x8000||
    (s->arena&0x3fff)||s->control!=s->arena+0x4000))return -1;
  for(unsigned i=0;i<TAC_GAME_MODULE_SLOTS;i++){
    const TacModuleReceipt *r=&s->slots[i];
    if(r->stage>TAC_PRX_REJECTED||r->clean>1||r->request[32]||r->upload[32]||r->sha256[64]||r->extension[7]||r->message[191])return -1;
    if(!r->stage){TacModuleReceipt empty={0};if(memcmp(r,&empty,sizeof empty))return -1;continue;}
    if(!tac_hex_string(r->request,32)||!tac_hex_string(r->upload,32)||!tac_hex_string(r->sha256,64)||
      (strcmp(r->extension,"prx")&&strcmp(r->extension,"sprx")))return -1;
    if(r->stage==TAC_PRX_STARTED&&(r->handle<0||r->startResult<0||r->clean))return -1;
    if(r->clean&&r->stage!=TAC_PRX_QUEUED&&r->stage!=TAC_PRX_REJECTED)return -1;
    for(unsigned j=0;j<i;j++)if(s->slots[j].stage&&!strcmp(s->slots[j].request,r->request))return -1;
  }
  return 0;
}
int tac_module_slot(const TacModuleSession *s,const char *request){for(unsigned i=0;i<TAC_GAME_MODULE_SLOTS;i++)if(s->slots[i].stage&&!strcmp(s->slots[i].request,request))return (int)i;return -1;}
void tac_module_path(const TacModuleReceipt *r,char path[256]){snprintf(path,256,TAC_GAME_MODULE_PREFIX "%s.%s",r->sha256,r->extension);}
int tac_module_gate_valid(const TacModuleSession *s,const TacGameGate *g){
  return s->phase==TAC_ARENA_READY&&g->magic==TAC_GAME_GATE_MAGIC&&g->version==1&&g->bytes==sizeof *g&&g->cookie==s->cookie&&
    g->enabled==1&&g->busy<=1&&g->loadStartModule>=0x10000&&g->loadStartModule<UINT64_C(0x7fffffffffff);
}
int tac_module_stage(const TacModuleSession *s,unsigned slot,const TacModuleOps *ops){
  if(!s||!ops||!ops->read||!ops->write||slot>=TAC_GAME_MODULE_SLOTS||s->slots[slot].stage!=TAC_PRX_ARMING)return 1;
  TacGameGate g;TacGameModule empty={0},pending={0};
  if(ops->read(ops->context,&g)||!tac_module_gate_valid(s,&g)||g.busy||memcmp(&g.modules[slot],&empty,sizeof empty))return 1;
  tac_module_path(&s->slots[slot],pending.path);size_t at=offsetof(TacGameGate,modules)+slot*sizeof pending;
  if(ops->write(ops->context,at,&pending,sizeof pending)||ops->read(ops->context,&g)||!tac_module_gate_valid(s,&g)||
    memcmp(&g.modules[slot],&pending,sizeof pending))goto rollback;
  pending.enabled=1;
  if(ops->write(ops->context,at,&pending.enabled,sizeof pending.enabled)||ops->read(ops->context,&g)||!tac_module_gate_valid(s,&g)||
    memcmp(&g.modules[slot],&pending,sizeof pending))goto rollback;
  return 0;
rollback:
  // No thread may execute until the caller has finished this rollback.
  if(ops->write(ops->context,at,&empty,sizeof empty)||ops->read(ops->context,&g)||!tac_module_gate_valid(s,&g)||
    memcmp(&g.modules[slot],&empty,sizeof empty))return -1;
  return 1;
}
