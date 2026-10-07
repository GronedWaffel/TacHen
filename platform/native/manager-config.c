// SPDX-License-Identifier: GPL-3.0-or-later
// Payload Manager v0.5.2 integration. Fixed paths only; preserve original config.
#include "quickjs.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <errno.h>
#define CONFIG "/data/pldmgr/pldmgr_config.txt"
#define LIMIT 65536
static int directory(const char *path,int create){
  if(create && mkdir(path,0700) && errno!=EEXIST)return -1;
  struct stat st;if(lstat(path,&st)||!S_ISDIR(st.st_mode)||S_ISLNK(st.st_mode)){errno=EINVAL;return -1;}return 0;
}
static int write_new(const char *path,const char *data,size_t bytes){
  int fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);if(fd<0)return -1;
  size_t done=0;int bad=0;
  while(done<bytes){ssize_t n=write(fd,data+done,bytes-done);if(n<0&&errno==EINTR)continue;if(n<=0){bad=1;break;}done+=(size_t)n;}
  if(fsync(fd))bad=1;if(close(fd))bad=1;if(bad)unlink(path);return bad?-1:0;
}
static int read_config(char *data,size_t *bytes){
  int fd=open(CONFIG,O_RDONLY|O_NOFOLLOW);if(fd<0){if(errno==ENOENT){*bytes=0;return 0;}return -1;}
  struct stat st;if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_size>LIMIT||st.st_size<0){close(fd);return -1;}
  size_t done=0;while(done<(size_t)st.st_size){ssize_t n=read(fd,data+done,(size_t)st.st_size-done);if(n<0&&errno==EINTR)continue;if(n<=0){close(fd);return -1;}done+=(size_t)n;}
  char extra;int n=read(fd,&extra,1);close(fd);if(n!=0)return -1;
  *bytes=done;return 1;
}
static JSValue prepare(JSContext *c,JSValueConst self,int argc,JSValueConst *args){
  (void)self;const char *message="Payload Manager configuration could not be prepared";
  if(argc!=1)return JS_ThrowTypeError(c,"Expected component request identity");
  const char *request=JS_ToCString(c,args[0]);if(!request)return JS_EXCEPTION;
  if(strlen(request)!=32||strspn(request,"0123456789abcdef")!=32){JS_FreeCString(c,request);return JS_ThrowTypeError(c,"Invalid request identity");}
  char backup[160],temp[160];snprintf(backup,sizeof backup,"/data/tachen/backups/pldmgr-%s.txt",request);
  snprintf(temp,sizeof temp,"/data/pldmgr/.tachen-%s.tmp",request);JS_FreeCString(c,request);
  if(directory("/data/pldmgr",1)||directory("/data/tachen/backups",1))goto fail;
  // Upstream can self-replace from these folders before reading its config.
  // Do not rename/delete user content or execute an unpinned replacement.
  DIR *dir=opendir("/data/pldmgr/payloads");
  if(!dir && errno!=ENOENT)goto fail;
  if(dir){struct dirent *item;unsigned count=0;int collision=0;
    while((item=readdir(dir))){if(++count>4096){collision=1;break;}
      if(!strcasecmp(item->d_name,"pldmgr")||!strcasecmp(item->d_name,"payload-manager")){collision=1;break;}}
    closedir(dir);if(collision){message="Payload Manager has a self-update folder. Review it before starting TacHen's pinned copy";goto fail;}
  }
  char *original=malloc(LIMIT+1),*updated=malloc(LIMIT+256),*check=malloc(LIMIT+1);
  if(!original||!updated||!check){free(original);free(updated);free(check);return JS_ThrowOutOfMemory(c);}
  size_t size=0,used=0;int exists=read_config(original,&size),bad=exists<0;
  if(!bad && memchr(original,0,size))bad=1;
  for(size_t start=0;!bad&&start<size;){
    size_t end=start;while(end<size&&original[end]!='\n')end++;
    // The autoload worker uses a 128-byte fgets buffer, stricter than config.c.
    if(end-start>126){bad=1;break;}
    const char *keys[]={"AUTOLOAD_ENABLED=","AUTO_BROWSER_OPEN=","KILL_DISC_PLAYER_ON_STARTUP=","AUTO_INSTALL_APP="};
    int replace=0;for(unsigned i=0;i<4;i++)if(end-start>=strlen(keys[i])&&!memcmp(original+start,keys[i],strlen(keys[i])))replace=1;
    if(end<size)end++;if(!replace){memcpy(updated+used,original+start,end-start);used+=end-start;}start=end;
  }
  const char settings[]="AUTOLOAD_ENABLED=0\nAUTO_BROWSER_OPEN=0\nKILL_DISC_PLAYER_ON_STARTUP=0\nAUTO_INSTALL_APP=0\n";
  if(used&&updated[used-1]!='\n')updated[used++]='\n';memcpy(updated+used,settings,sizeof settings-1);used+=sizeof settings-1;
  if(used>LIMIT)bad=1;
  int changed=!bad&&(!exists||used!=size||memcmp(updated,original,size));
  if(changed){
    if(exists&&write_new(backup,original,size))bad=1;
    if(!bad&&exists){int fd=open("/data/tachen/backups",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)bad=1;else{if(fsync(fd))bad=1;close(fd);}}
    if(!bad&&write_new(temp,updated,used))bad=1;
    size_t check_size=0;int check_exists=read_config(check,&check_size);
    if(!bad&&(check_exists!=exists||check_size!=size||memcmp(original,check,size))){bad=1;message="Payload Manager configuration changed during startup; retry after reviewing it";}
    if(!bad&&rename(temp,CONFIG))bad=1;
    if(bad)unlink(temp);
    if(!bad){int fd=open("/data/pldmgr",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)bad=1;else{if(fsync(fd))bad=1;close(fd);}}
  }
  free(original);free(updated);free(check);if(bad)goto fail;
  JSValue result=JS_NewObject(c);JS_SetPropertyStr(c,result,"changed",JS_NewBool(c,changed));
  if(changed&&exists)JS_SetPropertyStr(c,result,"backup",JS_NewString(c,backup));return result;
fail:
  return JS_ThrowInternalError(c,"%s",message);
}
void tac_manager_bind(JSContext *c,JSValue api){JS_SetPropertyStr(c,api,"managerPrepare",JS_NewCFunction(c,prepare,"managerPrepare",1));}
