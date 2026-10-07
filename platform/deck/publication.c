// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from the etaHEN port's stopped-process publication design. No writes
// while controller/render threads can execute partially replaced instructions.
#include "publication.h"
#include <string.h>
int tac_publish_hooks(const TacDeckPatch* patches,size_t count,const TacPublicationOps* o){
 if(!patches||count<1||count>2||!o||!o->attach||!o->detach||!o->threads||!o->read||!o->write||!o->ack||!o->reject||!o->pause)return 1;
 for(size_t i=0;i<count;i++){
  if(patches[i].address<0x10000||patches[i].address>UINT64_C(0x7fffffffffff)-64)return 1;
  for(size_t j=0;j<i;j++)if(patches[i].address<patches[j].address+14&&patches[j].address<patches[i].address+14)return 1;
 }
 for(unsigned attempt=0;attempt<20;attempt++){
  if(o->attach(o->context))return -1;
  uint64_t pcs[2048];int n=o->threads(o->context,pcs,2048),busy=0,ok=1;
  if(n<=0||n>2048){o->detach(o->context);return -1;}
  for(int i=0;i<n;i++)for(size_t j=0;j<count;j++)if(pcs[i]>=patches[j].address&&pcs[i]<patches[j].address+14)busy=1;
  if(busy){if(o->detach(o->context))return -1;o->pause(o->context);continue;}
  for(size_t i=0;i<count;i++){
   unsigned char bytes[14];if(o->read(o->context,patches[i].address,bytes,14)||memcmp(bytes,patches[i].before,14)){ok=0;break;}
  }
  size_t attempted=0;
  if(ok)for(size_t i=0;i<count;i++){
   attempted=i+1; // a failed write may still have modified part of this patch
   if(o->write(o->context,patches[i].address,patches[i].after,14)){ok=0;break;}
  }
  if(ok&&o->ack(o->context))ok=0;
  int restored=1;
  if(!ok)while(attempted){size_t i=--attempted;if(o->write(o->context,patches[i].address,patches[i].before,14))restored=0;}
  // A partial acknowledgement must not let a resumed initializer observe
  // success after the hooks were restored. Reject before resuming any thread.
  if(!ok&&o->reject(o->context))restored=0;
  if(o->detach(o->context)||!restored)return -1;
  return ok?0:1;
 }
 return 1;
}
