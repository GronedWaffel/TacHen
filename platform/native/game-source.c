// SPDX-License-Identifier: GPL-3.0-or-later
#include "game-source.h"
#include "game-info.h"
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/user.h>
#include "process-info.h"
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
int tac_game_identity(int pid,const char* generation,const char* title){
 struct timeval boot;size_t size=sizeof boot;int bm[]={CTL_KERN,KERN_BOOTTIME};
 if(sysctl(bm,2,&boot,&size,NULL,0)||size!=sizeof boot)return 0;
 struct kinfo_proc info={0};
 if(tac_process_info(pid,&info)||info.ki_start.tv_sec<=0||info.ki_start.tv_usec<0||info.ki_start.tv_usec>=1000000)return 0;
 char actual[128];snprintf(actual,sizeof actual,"%lld:%lld/%d/%lld:%lld",(long long)boot.tv_sec,(long long)boot.tv_usec,pid,(long long)info.ki_start.tv_sec,(long long)info.ki_start.tv_usec);
 TacAppInfo app;return !strcmp(actual,generation)&&!tac_game_app_info(pid,&app)&&!strcmp(app.title,title);
}
static int sandbox_name(const char* entry,const char* title){
 if(strncmp(entry,title,9)||entry[9]!='_')return 0;size_t n=strlen(entry+10);if(!n||n>6)return 0;
 for(size_t i=10;entry[i];i++)if(entry[i]<'0'||entry[i]>'9')return 0;return 1;
}
int tac_game_sandbox_open(int pid,const char* generation,const char* title,char* message,size_t capacity){
 int root=-1;DIR* directory=NULL;const char* reason="Running application sandbox could not be opened";
 if(!generation||!title||pid<=1||strlen(generation)>=128||!tac_game_title(title)||!tac_game_identity(pid,generation,title)){
  reason="Application identity changed before metadata was read";goto done;
 }
 directory=opendir("/mnt/sandbox");if(!directory)goto done;struct dirent* entry;char selected[32]={0};unsigned matches=0,count=0;
 while((entry=readdir(directory))){
  if(++count>4096){reason="Sandbox listing exceeded its bounded inspection limit";goto done;}
  if(sandbox_name(entry->d_name,title)){if(++matches>1){reason="More than one sandbox matches this title; version selection is ambiguous";goto done;}snprintf(selected,sizeof selected,"%s",entry->d_name);}
 }
 if(matches!=1){reason="The running application's sandbox is not ready";goto done;}
 root=openat(dirfd(directory),selected,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(root<0)goto done;
 if(!tac_game_identity(pid,generation,title)){close(root);root=-1;reason="Game instance changed while opening its sandbox";}
done:
 if(directory)closedir(directory);if(message&&capacity)snprintf(message,capacity,"%s",root<0?reason:"");return root;
}
int tac_game_metadata_read(int pid,const char* generation,const char* title,unsigned char** output,size_t* length,char* message,size_t capacity){
 int result=-1,root=-1,app=-1,sys=-1,file=-1;unsigned char* bytes=NULL;
 const char* reason="Running application metadata could not be read";char sandbox_reason[192];*output=NULL;*length=0;
 root=tac_game_sandbox_open(pid,generation,title,sandbox_reason,sizeof sandbox_reason);
 if(root<0){reason=sandbox_reason;goto done;}
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
   after.st_mtim.tv_sec!=before.st_mtim.tv_sec||after.st_mtim.tv_nsec!=before.st_mtim.tv_nsec||!tac_game_identity(pid,generation,title)){
  reason="Game instance or mounted metadata changed during inspection";goto done;
 }
 *output=bytes;*length=size;bytes=NULL;result=0;
done:
 free(bytes);if(file>=0)close(file);if(sys>=0)close(sys);if(app>=0)close(app);if(root>=0)close(root);
 if(message&&capacity)snprintf(message,capacity,"%s",result?reason:"");return result;
}
