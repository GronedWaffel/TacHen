// SPDX-License-Identifier: GPL-3.0-or-later
#include "quickjs.h"
#include "game-info.h"
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/user.h>
#include <sys/time.h>
#include <sys/stat.h>
#include <dlfcn.h>
#include <dirent.h>
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
static int (*getInfo)(int,void*);static int resolved;
int tac_game_info_available(void){
 if(!resolved){getInfo=dlsym(RTLD_DEFAULT,"sceKernelGetAppInfo");resolved=1;}
 return getInfo!=NULL;
}
int tac_game_app_info(int pid,TacAppInfo* out){
 if(!tac_game_info_available())return -1;
 _Alignas(8) unsigned char bytes[96]={0};if(getInfo(pid,bytes))return -1;
 return tac_app_info_decode(bytes,sizeof bytes,out);
}
static int identity(int pid,const char* generation,const char* title){
 struct timeval boot;size_t size=sizeof boot;int bm[]={CTL_KERN,KERN_BOOTTIME};
 if(sysctl(bm,2,&boot,&size,NULL,0)||size!=sizeof boot)return 0;
 struct kinfo_proc info={0};size=sizeof info;int mib[]={CTL_KERN,KERN_PROC,KERN_PROC_PID,pid};
 if(sysctl(mib,4,&info,&size,NULL,0)||size<offsetof(struct kinfo_proc,ki_comm)+COMMLEN+1||info.ki_pid!=pid||info.ki_start.tv_sec<=0)return 0;
 char actual[128];snprintf(actual,sizeof actual,"%lld:%lld/%d/%lld:%lld",(long long)boot.tv_sec,(long long)boot.tv_usec,pid,(long long)info.ki_start.tv_sec,(long long)info.ki_start.tv_usec);
 TacAppInfo app;return !strcmp(actual,generation)&&!tac_game_app_info(pid,&app)&&!strcmp(app.title,title);
}
static int sandbox_name(const char* entry,const char* title){
 if(strncmp(entry,title,9)||entry[9]!='_')return 0;size_t n=strlen(entry+10);if(!n||n>6)return 0;
 for(size_t i=10;entry[i];i++)if(entry[i]<'0'||entry[i]>'9')return 0;return 1;
}
static JSValue failure(JSContext* c,const char* code,const char* message){
 JSValue error=JS_NewError(c);JS_SetPropertyStr(c,error,"code",JS_NewString(c,code));JS_SetPropertyStr(c,error,"message",JS_NewString(c,message));return JS_Throw(c,error);
}
static JSValue metadata(JSContext* c,JSValueConst self,int argc,JSValueConst* argv){
 (void)self;if(argc!=3)return JS_ThrowTypeError(c,"Expected PID, process generation and title");
 int32_t pid;const char* generation=JS_ToCString(c,argv[1]),*title=JS_ToCString(c,argv[2]);
 JSValue result=JS_UNDEFINED;int root=-1,app=-1,sys=-1,file=-1;DIR* directory=NULL;unsigned char* bytes=NULL;
 const char* code="GAME_METADATA",*reason="Running application metadata could not be read";
 if(!generation||!title||JS_ToInt32(c,&pid,argv[0])||pid<=1||strlen(generation)>=128||!tac_game_title(title)||!identity(pid,generation,title)){
  code="GAME_CHANGED";reason="Application identity changed before metadata was read";goto done;
 }
 directory=opendir("/mnt/sandbox");if(!directory)goto done;struct dirent* entry;char selected[32]={0};unsigned matches=0,count=0;
 while((entry=readdir(directory))){
  if(++count>4096){reason="Sandbox listing exceeded its bounded inspection limit";goto done;}
  if(sandbox_name(entry->d_name,title)){if(++matches>1){reason="More than one sandbox matches this title; version selection is ambiguous";goto done;}snprintf(selected,sizeof selected,"%s",entry->d_name);}
 }
 if(matches!=1){reason="The running application's sandbox is not ready";goto done;}
 root=openat(dirfd(directory),selected,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(root<0)goto done;
 app=openat(root,"app0",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(app<0)goto done;
 sys=openat(app,"sce_sys",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(sys<0)goto done;
 int ps5=!memcmp(title,"PPS",3)||!memcmp(title,"MOUU",4);const char* name=ps5?"param.json":"param.sfo";
 file=openat(sys,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(file<0)goto done;
 struct stat before,after,named;
 if(fstat(file,&before)||!S_ISREG(before.st_mode)||before.st_size<20||before.st_size>1024*1024){reason="Game metadata has an invalid type or size";goto done;}
 size_t size=(size_t)before.st_size;bytes=malloc(size);if(!bytes){reason="Not enough memory for game metadata";goto done;}
 for(size_t at=0;at<size;){ssize_t n=read(file,bytes+at,size-at);if(n<0&&errno==EINTR)continue;if(n<=0){reason="Game metadata read ended early";goto done;}at+=(size_t)n;}
 if(fstat(file,&after)||fstatat(sys,name,&named,AT_SYMLINK_NOFOLLOW)||!S_ISREG(named.st_mode)||
   named.st_dev!=before.st_dev||named.st_ino!=before.st_ino||after.st_size!=before.st_size||
   after.st_mtim.tv_sec!=before.st_mtim.tv_sec||after.st_mtim.tv_nsec!=before.st_mtim.tv_nsec||!identity(pid,generation,title)){
  code="GAME_CHANGED";reason="Game instance or mounted metadata changed during inspection";goto done;
 }
 result=JS_NewObject(c);JS_SetPropertyStr(c,result,"format",JS_NewString(c,ps5?"json":"sfo"));
 JS_SetPropertyStr(c,result,"scope",JS_NewString(c,"running-sandbox"));JS_SetPropertyStr(c,result,"bytes",JS_NewArrayBufferCopy(c,bytes,size));
done:
 free(bytes);if(file>=0)close(file);if(sys>=0)close(sys);if(app>=0)close(app);if(root>=0)close(root);if(directory)closedir(directory);
 if(generation)JS_FreeCString(c,generation);if(title)JS_FreeCString(c,title);
 return JS_IsUndefined(result)?failure(c,code,reason):result;
}
void tac_game_bind(JSContext* c,JSValue api){JS_SetPropertyStr(c,api,"gameMetadata",JS_NewCFunction(c,metadata,"gameMetadata",3));}
