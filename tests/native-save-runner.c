// SPDX-License-Identifier: GPL-3.0-or-later
#include "check.h"
#include "save-core.h"
#include "save-flow.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static size_t calls,fail;
static int output(void* ctx,const void* bytes,size_t length){if(++calls==fail)return -1;return fwrite(bytes,1,length,ctx)==length?0:-1;}
static TacSaveRequest request(void){
 TacSaveRequest r={.magic=TAC_SAVE_MAGIC,.version=1,.mode=TAC_SAVE_EXPORT,.bootSec=1,.platform=5};
 memset(r.request,'a',32);memset(r.stamp,'b',64);strcpy(r.user,"123abc");strcpy(r.title,"PPSA00001");strcpy(r.slot,"sdimg_profile");return r;
}
typedef struct {char events[128];unsigned n,lastStage;int clean,mounted;char failOperation;unsigned failStage;} Fixture;
static int event(Fixture* f,char value){CHECK(f->n<sizeof f->events-1);f->events[f->n++]=value;return f->failOperation==value?-1:0;}
static int record(void* ctx,unsigned stage,int clean,int mounted,const char* message){
 Fixture* f=ctx;CHECK(message&&*message);f->lastStage=stage;f->clean=clean;f->mounted=mounted;return stage==f->failStage?-1:0;
}
static int prepare(void* c){return event(c,'p');}static int copy(void* c){return event(c,'c');}
static int mount(void* c){return event(c,'m');}static int extract(void* c){return event(c,'e');}
static int unmount(void* c){return event(c,'u');}static int publish(void* c){return event(c,'s');}
static void discard(void* c){event(c,'d');}
static int flow(Fixture* f){TacSaveFlow ops={f,record,prepare,copy,mount,extract,unmount,publish,discard};return tac_save_export_flow(&ops);}
int main(int argc,char** argv){
 if(argc==2&&!strcmp(argv[1],"--fail-check")){CHECK(0);}
 CHECK(argc>=2);
 if(!strcmp(argv[1],"--flow")){
  Fixture f={0};CHECK(!flow(&f));CHECK(!strcmp(f.events,"pcmeusd"));CHECK(f.lastStage==TAC_SAVE_COMPLETE&&f.clean&&!f.mounted);
  f=(Fixture){.failOperation='p'};CHECK(flow(&f));CHECK(!strcmp(f.events,"pd"));CHECK(f.lastStage==TAC_SAVE_REJECTED&&f.clean);
  f=(Fixture){.failOperation='c'};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcd"));CHECK(f.lastStage==TAC_SAVE_REJECTED&&f.clean);
  f=(Fixture){.failOperation='m'};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcmud"));CHECK(f.lastStage==TAC_SAVE_REJECTED&&f.clean&&!f.mounted);
  f=(Fixture){.failOperation='e'};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcmeud"));CHECK(f.lastStage==TAC_SAVE_REJECTED&&f.clean);
  f=(Fixture){.failOperation='u'};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcmeu"));CHECK(f.lastStage==TAC_SAVE_UNKNOWN&&!f.clean&&f.mounted);
  f=(Fixture){.failOperation='s'};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcmeus"));CHECK(f.lastStage==TAC_SAVE_UNKNOWN&&!f.clean&&!f.mounted);
  f=(Fixture){.failStage=TAC_SAVE_MOUNTING};CHECK(flow(&f));CHECK(!strcmp(f.events,"pc"));
  f=(Fixture){.failStage=TAC_SAVE_EXTRACTING};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcmud"));
  f=(Fixture){.failStage=TAC_SAVE_UNMOUNTING};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcmeud"));
  f=(Fixture){.failStage=TAC_SAVE_PUBLISHING};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcmeu"));
  f=(Fixture){.failStage=TAC_SAVE_COMPLETE};CHECK(flow(&f));CHECK(!strcmp(f.events,"pcmeus"));
  puts("passed");return 0;
 }
 if(!strcmp(argv[1],"--validate")){
  TacSaveRequest r=request();CHECK(tac_save_request_valid(&r));r.destination=1;CHECK(!tac_save_request_valid(&r));
  memset(r.volume,'c',64);CHECK(tac_save_request_valid(&r));r.platform=4;CHECK(!tac_save_request_valid(&r));
  strcpy(r.title,"CUSA00001");CHECK(tac_save_request_valid(&r));r.slot[127]='a';CHECK(!tac_save_request_valid(&r));
  r=request();r.mode=TAC_SAVE_CATALOG;CHECK(!tac_save_request_valid(&r));r.user[0]=r.title[0]=r.slot[0]=r.stamp[0]=0;r.platform=0;CHECK(tac_save_request_valid(&r));
  const char* bad[]={"/absolute","..","a/../b","a/./b","a//b","a/","a\\b","a\n","\xc0\xaf","\xed\xa0\x80","\xf4\x90\x80\x80","\xe2\x82"};
  for(unsigned i=0;i<sizeof bad/sizeof bad[0];i++)CHECK(!tac_save_relative(bad[i]));
  CHECK(tac_save_relative("files/\xe6\x97\xa5\xe6\x9c\xac/\xf0\x9f\x98\x80.bin"));
  CHECK(!tac_save_slot("sdimg_sce_bu_slot"));CHECK(!tac_save_slot("sdimg_.."));CHECK(!tac_save_user("ABCDEF"));
  puts("passed");return 0;
 }
 FILE* f=fopen(argv[1],"wb");CHECK(f);const unsigned char data[]={0,1,2,255,10};
 char longpath[250];strcpy(longpath,"files/");memset(longpath+6,'x',220);strcpy(longpath+226,"/data.bin");
 if(argc>2&&!strcmp(argv[2],"--large")){CHECK(!tac_save_tar_header(output,f,longpath,UINT64_C(9000000000),0));}
 else if(argc>2&&!strcmp(argv[2],"--failure")){
  for(size_t at=1;at<=4;at++){calls=0;fail=at;CHECK(tac_save_tar_header(output,f,longpath,5,0)==-1);}
  fail=1;calls=0;CHECK(tac_save_tar_end(output,f)==-1);
 }else{
  CHECK(!tac_save_tar_header(output,f,"files",0,1));CHECK(!tac_save_tar_header(output,f,"files/empty",0,1));
  CHECK(!tac_save_tar_header(output,f,"files/\xe6\x97\xa5\xe6\x9c\xac.bin",sizeof data,0));CHECK(!output(f,data,sizeof data));CHECK(!tac_save_tar_padding(output,f,sizeof data));
  CHECK(!tac_save_tar_header(output,f,longpath,0,0));CHECK(!tac_save_tar_end(output,f));
 }
 CHECK(!fclose(f));return 0;
}
