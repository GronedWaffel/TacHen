// SPDX-License-Identifier: GPL-3.0-or-later
#include "package-core.h"
#include "package-abi.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "check.h"
typedef struct {FILE* file;int virtual;} Reader;
static void progress_prefix(void){
 // Historical etaHEN declaration (first public source, 2.4B and 2.5B).
 typedef struct {char state[16],source[8];uint32_t seconds;uint64_t downloaded,initial,total;uint32_t promote;TacInstallError error;int32_t copy;_Bool copyOnly;} Legacy;
 _Static_assert(sizeof(Legacy)==600&&offsetof(Legacy,error)==60,"Historical etaHEN status declaration");
 _Static_assert(offsetof(Legacy,downloaded)==offsetof(TacInstallStatus,downloaded)&&offsetof(Legacy,total)==offsetof(TacInstallStatus,total),"Shared progress offsets");
 Legacy old;memset(&old,0xa5,sizeof old);strcpy(old.state,"downloading");old.downloaded=UINT64_C(5)*1024*1024*1024;old.total=UINT64_C(180)*1024*1024*1024;
 TacPackageProgress p;
 CHECK(!tac_install_progress(&old,sizeof old,0x11200000,&p));CHECK(!p.error&&p.downloaded==old.downloaded&&p.total==old.total);
 TacInstallStatus current;memset(&current,0x5a,sizeof current);memcpy(current.state,old.state,16);current.downloaded=old.downloaded;current.total=old.total;current.error.code=-42;
 CHECK(!tac_install_progress(&current,sizeof current,0x12400000,&p));CHECK(!p.error&&p.total==old.total);
 CHECK(!tac_install_progress(&current,sizeof current,0x13600000,&p));CHECK(p.error==-42);
 CHECK(tac_install_progress(&current,sizeof current-1,0x13600000,&p));
 CHECK(tac_install_progress(&old,55,0x11200000,&p));
 memset(old.state,'x',16);CHECK(tac_install_progress(&old,sizeof old,0x11200000,&p));
 strcpy(old.state,"error");CHECK(!tac_install_progress(&old,sizeof old,0x11200000,&p));TacPackageTracker tracker={0};CHECK(tac_package_track(&tracker,&p,old.total,4)==-1);
 old.downloaded=old.total+1;CHECK(tac_install_progress(&old,sizeof old,0x11200000,&p));
 old.total=old.downloaded=TAC_PACKAGE_MAX+1;CHECK(tac_install_progress(&old,sizeof old,0x11200000,&p));
 puts("common status prefix passed");
}
static int read_at(void* data,uint64_t at,void* buffer,size_t bytes){
 Reader* r=data;if(r->virtual&&at==UINT64_C(5)*1024*1024*1024)at=0x438;
 if(at>0x7fffffff||fseek(r->file,(long)at,SEEK_SET))return -1;
 return fread(buffer,1,bytes,r->file)==bytes?0:-1;
}
static void tracking(void){
 TacPackageTracker t={0};TacPackageProgress p={.state="error",.downloaded=100,.total=8192};
 CHECK(tac_package_track(&t,&p,8192,4)==-1);CHECK(!t.observed&&!t.terminal);
 p=(TacPackageProgress){.state="none",.downloaded=100,.total=8192};
 for(unsigned i=0;i<119;i++)CHECK(tac_package_track(&t,&p,8192,4)==0);
 CHECK(tac_package_track(&t,&p,8192,4)==-2);CHECK(t.unproven==120&&!t.observed);
 CHECK(tac_package_track(&t,&p,8192,4)==-2);CHECK(t.unproven==120);
 memset(&t,0,sizeof t);
 for(unsigned i=0;i<100;i++)CHECK(tac_package_track(&t,&p,8192,4)==0);
 strcpy(p.state,"queued");p.downloaded=p.total=0;CHECK(tac_package_track(&t,&p,8192,4)==0);CHECK(!t.unproven);
 strcpy(p.state,"none");CHECK(tac_package_track(&t,&p,8192,4)==0);CHECK(t.unproven==1);
 p=(TacPackageProgress){.state="downloading",.downloaded=100,.total=8192};
 CHECK(tac_package_track(&t,&p,8192,4)==0);CHECK(t.observed&&!t.unproven);
 strcpy(p.state,"none");CHECK(tac_package_track(&t,&p,8192,4)==-1);CHECK(!t.terminal);
 strcpy(p.state,"playable");p.downloaded=8192;CHECK(tac_package_track(&t,&p,8192,4)==0);
 strcpy(p.state,"error");CHECK(tac_package_track(&t,&p,8192,4)==-1);CHECK(!t.terminal);
 memset(&t,0,sizeof t);p=(TacPackageProgress){.state="playable",.downloaded=8192,.total=8192};
 // Returning the old playable status forever never proves a new install.
 t.baseline=p;t.baselineValid=1;
 for(int i=0;i<10;i++)CHECK(tac_package_track(&t,&p,8192,4)==0);
 p.downloaded=100;CHECK(tac_package_track(&t,&p,8192,4)==0);CHECK(t.observed);
 p.downloaded=8192;CHECK(tac_package_track(&t,&p,8192,4)==0);CHECK(tac_package_track(&t,&p,8192,4)==1);
 p.error=-1;CHECK(tac_package_track(&t,&p,8192,4)==-1);CHECK(!t.terminal);p.error=0;
 p.downloaded=p.total=4096;CHECK(tac_package_track(&t,&p,8192,4)==0); // old base/patch total
 p.downloaded=p.total=8192;CHECK(tac_package_track(&t,&p,8192,4)==0); // two fresh confirmations
 memset(p.state,'a',16);CHECK(tac_package_track(&t,&p,8192,4)==-1);
 memset(&t,0,sizeof t);p=(TacPackageProgress){.state="playable",.downloaded=256,.total=1024};
 CHECK(tac_package_track(&t,&p,8192,5)==0);p.downloaded=1024;
 CHECK(tac_package_track(&t,&p,8192,5)==0);CHECK(tac_package_track(&t,&p,8192,5)==1); // PS5 status units can differ
 p.downloaded=1025;CHECK(tac_package_track(&t,&p,8192,5)==-1);
 puts("tracking guards passed");
}
static void requests(void){
 TacPackageRequest r={.magic=TAC_PACKAGE_MAGIC,.version=1,.bytes=8192,.bootSec=123,.type=0x1a,.platform=4};
 memset(r.request,'a',32);memset(r.upload,'b',32);memset(r.sha256,'c',64);strcpy(r.content,"UP0001-CUSA00001_00-ABCDEFGHIJKLMNOP");strcpy(r.name,"Game.pkg");
 CHECK(tac_package_request_valid(&r));r.bytes=TAC_PACKAGE_MAX+1;CHECK(!tac_package_request_valid(&r));r.bytes=8192;
 r.patch=2;CHECK(!tac_package_request_valid(&r));r.patch=0;r.platform=5;CHECK(!tac_package_request_valid(&r));r.platform=4;
 r.sha256[64]='a';CHECK(!tac_package_request_valid(&r));r.sha256[64]=0;
 r.content[7]='n';CHECK(!tac_package_request_valid(&r));r.content[7]='C';r.name[0]='\n';CHECK(!tac_package_request_valid(&r));
 puts("request guards passed");
}
int main(int argc,char** argv){
 if(argc==2&&!strcmp(argv[1],"--prefix")){progress_prefix();return 0;}
 if(argc==2&&!strcmp(argv[1],"--fail-check"))CHECK(0);
 if(argc==2&&!strcmp(argv[1],"--track")){tracking();return 0;}
 if(argc==2&&!strcmp(argv[1],"--requests")){requests();return 0;}
 if(argc<2)return 2;Reader r={.file=fopen(argv[1],"rb"),.virtual=argc==3};if(!r.file)return 3;
 fseek(r.file,0,SEEK_END);uint64_t bytes=r.virtual?UINT64_C(5)*1024*1024*1024+0x8000:(uint64_t)ftell(r.file);
 TacPackageInfo info;int accepted=!tac_package_inspect(read_at,&r,bytes,&info);fclose(r.file);
 if(!accepted)puts("{\"accepted\":false}");else printf("{\"accepted\":true,\"bytes\":%llu,\"contentId\":\"%s\",\"type\":%u,\"platform\":%u,\"patch\":%u}\n",(unsigned long long)info.bytes,info.content,info.type,info.platform,info.patch);return 0;
}
