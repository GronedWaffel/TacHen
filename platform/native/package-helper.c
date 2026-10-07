// SPDX-License-Identifier: GPL-3.0-or-later
// One submitted package per isolated process. Its watchdog can terminate this
// helper without stopping the phone/deck coordinator. No restart/retry loop.
#include "package-core.h"
#include "package-abi.h"
#include "package-io.h"
#include "sha256.h"
#include <ps5/kernel.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <dlfcn.h>
static TacPackageReceipt receipt;
static int (*initialize)(void),(*install)(TacInstallMeta*,TacInstallPackage*,TacInstallPlaygo*);
static int (*status)(const char*,TacInstallStatus*);
static uint64_t savedAuth;static int elevated;
static int publish(unsigned stage,int clean,const char* text){
 receipt.stage=stage;receipt.clean=clean;snprintf(receipt.message,sizeof receipt.message,"%s",text);return tac_package_receipt_save(&receipt);
}
static int read_at(void* context,uint64_t at,void* data,size_t bytes){
 int fd=*(int*)context;size_t got=0;
 while(got<bytes){ssize_t n=pread(fd,(unsigned char*)data+got,bytes-got,(off_t)(at+got));if(n<0&&errno==EINTR)continue;if(n<=0)return -1;got+=(size_t)n;}return 0;
}
static int auth_begin(void){
 alarm(12);savedAuth=kernel_get_ucred_authid(getpid());
 if(!savedAuth||savedAuth==UINT64_MAX){alarm(0);return -1;}
 elevated=1;
 return kernel_set_ucred_authid(getpid(),UINT64_C(0x4801000000000013))||kernel_get_ucred_authid(getpid())!=UINT64_C(0x4801000000000013)?-1:0;
}
static int auth_end(void){
 if(elevated)for(unsigned i=0;i<3;i++)if(!kernel_set_ucred_authid(getpid(),savedAuth)&&kernel_get_ucred_authid(getpid())==savedAuth){elevated=0;break;}
 alarm(0);return elevated?-1:0;
}
static int same_file(int fd,const char* path,const struct stat* before){
 struct stat after,named;
 return !fstat(fd,&after)&&!lstat(path,&named)&&S_ISREG(named.st_mode)&&!S_ISLNK(named.st_mode)&&
  before->st_dev==named.st_dev&&before->st_ino==named.st_ino&&before->st_size==after.st_size&&
  before->st_mtim.tv_sec==after.st_mtim.tv_sec&&before->st_mtim.tv_nsec==after.st_mtim.tv_nsec;
}
static int get_status(TacPackageProgress* result){
 TacInstallStatus value={0};if(auth_begin()){auth_end();return -1;}
 int rc=status(receipt.input.content,&value),restore=auth_end();if(restore)return -2;if(rc)return rc;
 if(!memchr(value.state,0,sizeof value.state)||value.total>TAC_PACKAGE_MAX||value.downloaded>value.total)return -3;
 memset(result,0,sizeof *result);memcpy(result->state,value.state,sizeof result->state);result->downloaded=value.downloaded;result->total=value.total;result->error=value.error.code;return 0;
}
int main(void){
 signal(SIGPIPE,SIG_IGN);signal(SIGALRM,SIG_DFL);
 if(tac_package_directory())return 1;
 int lock=open(TAC_PACKAGE_ROOT "/active.lock",O_CREAT|O_RDWR|O_NOFOLLOW,0600);
 if(lock<0||flock(lock,LOCK_EX|LOCK_NB))return 2;
 TacPackageRequest request;
 if(tac_package_request_load(&request)||tac_package_boot(&request,1)||tac_package_receipt_load(request.request,&receipt)||
   memcmp(&request,&receipt.input,sizeof request)||receipt.stage!=TAC_PKG_QUEUED||receipt.clean)return 3;
 receipt.pid=getpid();int fd=-1;unsigned char* chunk=NULL;int result=1;const char* reason="Package helper preflight failed";
 if((kernel_get_fw_version()&0xffff0000)!=0x13600000){reason="This firmware has no evidenced package installer ABI yet";goto rejected;}
 if(publish(TAC_PKG_HASHING,1,"Checking the exact package bytes before installation"))goto done;
 struct stat parent;if(lstat("/data/tachen/packages",&parent)||!S_ISDIR(parent.st_mode)||S_ISLNK(parent.st_mode))goto rejected;
 char path[160];snprintf(path,sizeof path,"/data/tachen/packages/%s.payload",request.upload);
 fd=open(path,O_RDONLY|O_NOFOLLOW);struct stat before;
 if(fd<0||fstat(fd,&before)||!S_ISREG(before.st_mode)||(uint64_t)before.st_size!=request.bytes){reason="Verified package file is missing or changed";goto rejected;}
 TacPackageInfo info;
 if(tac_package_inspect(read_at,&fd,request.bytes,&info)||info.type!=request.type||info.platform!=request.platform||info.patch!=request.patch||strcmp(info.content,request.content)){
  reason="Native package header differs from the approved upload";goto rejected;
 }
 chunk=malloc(1024*1024);if(!chunk){reason="Not enough memory for package verification";goto rejected;}
 SHA256_CTX hash;sha256_init(&hash);uint64_t last=tac_package_millis();receipt.total=request.bytes;
 for(uint64_t at=0;at<request.bytes;){
  size_t n=request.bytes-at>1024*1024?1024*1024:(size_t)(request.bytes-at);
  if(read_at(&fd,at,chunk,n)){reason="Package read ended before its checksum was complete";goto rejected;}
  sha256_update(&hash,chunk,n);at+=n;receipt.downloaded=at;uint64_t now=tac_package_millis();
  if(!now||now<last){reason="Monotonic clock unavailable during verification";goto rejected;}
  if(now-last>=2000){if(tac_package_receipt_save(&receipt))goto done;last=now;}
 }
 free(chunk);chunk=NULL;unsigned char digest[32];char actual[65];sha256_final(&hash,digest);
 for(unsigned i=0;i<32;i++)snprintf(actual+i*2,3,"%02x",digest[i]);
 if(strcmp(actual,request.sha256)||!same_file(fd,path,&before)){reason="Package changed after upload verification";goto rejected;}
 receipt.downloaded=receipt.total=0;if(publish(TAC_PKG_PREFLIGHT,1,"Preparing the console package installer"))goto done;
 alarm(12);
 initialize=dlsym(RTLD_DEFAULT,"sceAppInstUtilInitialize");install=dlsym(RTLD_DEFAULT,"sceAppInstUtilInstallByPackage");
 if(!initialize||!install){dlopen("/system/common/lib/libSceAppInstUtil.sprx",RTLD_LAZY);initialize=dlsym(RTLD_DEFAULT,"sceAppInstUtilInitialize");install=dlsym(RTLD_DEFAULT,"sceAppInstUtilInstallByPackage");}
 status=dlsym(RTLD_DEFAULT,request.patch?"sceAppInstUtilGetPatchInstallStatus":"sceAppInstUtilGetInstallStatus");alarm(0);
 if(!initialize||!install||!status){reason="Console installer symbols are unavailable";goto rejected;}
 if(auth_begin()){auth_end();reason="Installer credentials could not be established";goto rejected;}
 int rc=initialize(),restored=auth_end();if(rc||restored){receipt.error=rc;reason="Console installer initialization failed";goto rejected;}
 TacPackageTracker tracker={0};rc=get_status(&tracker.baseline);if(elevated){reason="Installer credentials could not be restored";goto rejected;}tracker.baselineValid=rc==0;
 if(tracker.baselineValid&&tracker.baseline.total&&tracker.baseline.downloaded<tracker.baseline.total){reason="This content already has an unfinished installation";goto rejected;}
 if(!same_file(fd,path,&before)){reason="Package identity changed before submission";goto rejected;}
 // Everything the marshaller can retain stays alive through confirmed finish.
 TacInstallPackage output={0};TacInstallPlaygo playgo={0};TacInstallMeta meta={.uri=path,.extra="",.scenario="",.content="",.name=request.name,.icon=""};
 if(publish(TAC_PKG_SUBMITTING,0,"Submitting this package once to the console installer"))goto done;
 if(auth_begin()){auth_end();reason="Installer credential change failed before submission";goto rejected;}
 rc=install(&meta,&output,&playgo);restored=auth_end();receipt.error=rc;
 if(rc||restored){publish(TAC_PKG_UNKNOWN,0,"Installer call failed or credentials did not restore; its result needs inspection");goto done;}
 receipt.accepted=1;
 if(!memchr(output.content,0,sizeof output.content)||strcmp(output.content,request.content)){
  publish(TAC_PKG_UNKNOWN,0,"Installer returned a different content identity; no second submission was issued");goto done;
 }
 if(publish(TAC_PKG_INSTALLING,0,"Package accepted; observing actual install progress"))goto done;
 uint64_t started=tac_package_millis(),lastPoll=started;unsigned errors=0;
 for(;;){
  uint64_t now=tac_package_millis();if(!now||now<lastPoll||now-started>48ULL*60*60*1000){publish(TAC_PKG_UNKNOWN,0,"Installation observation expired; uploaded package retained");break;}lastPoll=now;
  TacPackageProgress progress;rc=get_status(&progress);
  if(rc){receipt.error=rc;if(elevated||++errors>=5){publish(TAC_PKG_UNKNOWN,0,"Console install status became unavailable; no resubmission was issued");break;}usleep(500000);continue;}
  errors=0;int complete=tac_package_track(&tracker,&progress,request.bytes,request.platform);
  memcpy(receipt.state,progress.state,16);receipt.state[15]=0;receipt.downloaded=progress.downloaded;receipt.total=progress.total;
  receipt.error=progress.error;receipt.observed=tracker.observed;
  if(complete<0){
   const char* detail=complete==-2?(!strcmp(progress.state,"none")?
    "The accepted installation never appeared; source retained and no resubmission issued":
    "Only a completed status was visible; a new install cannot be distinguished from the previous one"):
    "Console installer reported an error, lost task or invalid progress; package retained";
   publish(TAC_PKG_UNKNOWN,0,detail);break;
  }
  if(complete){result=publish(TAC_PKG_COMPLETED,0,"Console reported complete installation after observed transfer progress");break;}
  if(now-receipt.updated>=2000&&tac_package_receipt_save(&receipt))break;usleep(500000);
 }
 goto done;
rejected:
 publish(TAC_PKG_REJECTED,1,reason);
done:
 if(elevated)auth_end();free(chunk);if(fd>=0)close(fd);close(lock);return result;
}
