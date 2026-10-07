// SPDX-License-Identifier: GPL-3.0-or-later
#include "plugin-image.h"
#include "elf-image.h"
#include "check.h"
#include "dispatch-receipt.h"
#include "sha256.h"
#include <stdio.h>
#include <string.h>
int main(int argc,char **argv){
  (void)argv;if(argc>1)CHECK(0);
  uint8_t data[29+160]={0};memcpy(data,"etaHEN_PLUGIN\0TACP00001\0" "1.00\0",29);
  TacElfHeader h={0};memcpy(h.ident,"\177ELF\2\1\1",7);h.type=3;h.machine=62;h.version=1;h.entry=128;
  h.phoff=64;h.ehsize=64;h.phentsize=56;h.phnum=1;memcpy(data+29,&h,sizeof h);
  TacElfProgram p={0};p.type=1;p.flags=5;p.filesz=p.memsz=160;p.align=1;memcpy(data+29+64,&p,sizeof p);
  TacPluginImage image;char reason[192];
  CHECK(!tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));
  CHECK(image.offset==29&&!strcmp(image.id,"TACP00001")&&!strcmp(image.version,"1.00"));
  data[23]='X';CHECK(tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));data[23]=0;
  data[28]='X';CHECK(tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));data[28]=0;
  data[14]='/';CHECK(tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));data[14]='T';
  data[18]='X';CHECK(tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));data[18]='0';
  data[25]='0';CHECK(tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));data[25]='.';
  data[13]='X';CHECK(tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));data[13]=0;
  h.type=0xfe18;memcpy(data+29,&h,sizeof h);CHECK(tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));
  h.type=3;h.phoff=UINT64_MAX;memcpy(data+29,&h,sizeof h);CHECK(tac_plugin_inspect(data,sizeof data,&image,reason,sizeof reason));
  CHECK(tac_plugin_inspect(data,28,&image,reason,sizeof reason));CHECK(tac_plugin_inspect(NULL,100,&image,reason,sizeof reason));
  TacDispatchReceipt original={0},decoded;original.magic=TAC_DISPATCH_MAGIC;original.version=2;original.stage=TAC_DISPATCH_SPAWNED;
  original.boot_sec=100;original.pid=88;original.plugin=1;memset(original.request,'a',32);memset(original.upload,'b',32);memset(original.sha256,'c',64);
  strcpy(original.plugin_id,"TACP00001");strcpy(original.plugin_version,"1.00");strcpy(original.generation,"100:0/88/102:1");tac_dispatch_seal(&original);
  CHECK(!tac_dispatch_decode(&original,sizeof original,original.request,&decoded));CHECK(decoded.pid==88&&decoded.plugin==1);
  original.pid=89;CHECK(tac_dispatch_decode(&original,sizeof original,original.request,&decoded));original.pid=88;
  CHECK(tac_dispatch_decode(&original,sizeof original-1,original.request,&decoded));
  TacDispatchReceipt request=original;memset(request.sha256,'d',64);CHECK(tac_dispatch_conflicts(&request,&original));
  original.stage=TAC_DISPATCH_FAILED;original.no_side_effects=0;CHECK(tac_dispatch_conflicts(&request,&original));
  original.no_side_effects=1;CHECK(!tac_dispatch_conflicts(&request,&original));original.stage=TAC_DISPATCH_SPAWNED;
  request.boot_sec++;CHECK(!tac_dispatch_conflicts(&request,&original));request.boot_sec--;request.plugin=0;
  CHECK(!tac_dispatch_conflicts(&request,&original));strcpy(request.sha256,original.sha256);CHECK(tac_dispatch_conflicts(&request,&original));
  TacDispatchReceiptV1 old={0};old.magic=TAC_DISPATCH_MAGIC;old.version=1;old.stage=TAC_DISPATCH_SPAWNED;old.pid=77;
  strcpy(old.request,original.request);strcpy(old.upload,original.upload);strcpy(old.sha256,original.sha256);
  SHA256_CTX hash;sha256_init(&hash);sha256_update(&hash,(uint8_t*)&old,offsetof(TacDispatchReceiptV1,checksum));sha256_final(&hash,old.checksum);
  CHECK(!tac_dispatch_decode(&old,sizeof old,old.request,&decoded));CHECK(decoded.version==2&&decoded.plugin==0&&decoded.pid==77);
  old.pid=76;CHECK(tac_dispatch_decode(&old,sizeof old,old.request,&decoded));
  puts("Native plugin container, embedded ELF, dispatch receipts and duplicate checks passed");return 0;
}
