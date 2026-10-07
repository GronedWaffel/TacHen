// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from PS Neighborhood platform plumbing; see vendor/runtime-provenance.json.
#include "quickjs.h"
#include "loader-worker.h"
extern void tac_loader_bind(JSContext*,JSValue);
extern void tac_system_bind(JSContext*,JSValue);
extern void tac_manager_bind(JSContext*,JSValue);
extern void tac_deck_bind(JSContext*,JSValue);
extern void tac_package_bind(JSContext*,JSValue);
extern void tac_game_bind(JSContext*,JSValue);
extern void tac_module_bind(JSContext*,JSValue);
extern void tac_cheat_bind(JSContext*,JSValue);
extern void tac_telemetry_bind(JSContext*,JSValue);

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <time.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/statvfs.h>
#include <sys/socket.h>
#include <sys/file.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <poll.h>
#ifdef __PS5__
#include <ps5/kernel.h>
#else
#include <sys/random.h>
#endif
#ifndef TACHEN_ROOT
#define TACHEN_ROOT "/data/tachen"
#endif
#define ROOT TACHEN_ROOT
#define MAX_FDS 192
static int owned[MAX_FDS];
static JSContext *context;
static int stopping;
static void notify_user(const char *message){
#ifdef __PS5__
 extern int sceKernelSendNotificationRequest(int,const void*,size_t,int);
 unsigned char request[0xc30]={0};int target=-1;memcpy(request+0x10,&target,4);
 request[0x2c]=1;snprintf((char*)request+0x2d,1024,"%s",message);
 snprintf((char*)request+0x42d,1024,"cxml://psnotification/tex_icon_system");
 int result=sceKernelSendNotificationRequest(0,request,sizeof request,0);
 fprintf(stderr,"Local notification result: 0x%08x\n",(unsigned)result);
#else
 fprintf(stderr,"%s\n",message);
#endif
}
static const char *local_ip(char value[512]){
#ifdef __PS5__
 extern int sceNetCtlInit(void);extern int sceNetCtlGetInfo(int,void*);
 memset(value,0,512);sceNetCtlInit();
 if(sceNetCtlGetInfo(14,value)<0)return "PS5-IP";
 value[511]=0;return value;
#else
 (void)value;return "127.0.0.1";
#endif
}
extern const unsigned char tachen_assets_start[],tachen_assets_end[];
static int track(int fd){if(fd<0)return fd;for(int i=0;i<MAX_FDS;i++)if(!owned[i]){owned[i]=fd+1;return fd;}close(fd);errno=EMFILE;return -1;}
static int has(int fd){for(int i=0;i<MAX_FDS;i++)if(owned[i]==fd+1)return 1;return 0;}
static void release(int fd){for(int i=0;i<MAX_FDS;i++)if(owned[i]==fd+1){owned[i]=0;close(fd);return;}}
static JSValue fail(JSContext *ctx,const char *what){int e=errno;JSValue error=JS_NewError(ctx);JS_SetPropertyStr(ctx,error,"message",JS_NewString(ctx,what));const char *code=e==ENOENT?"ENOENT":e==EEXIST?"EEXIST":e==ENOSPC?"ENOSPC":e==EACCES?"EACCES":"EIO";JS_SetPropertyStr(ctx,error,"code",JS_NewString(ctx,code));JS_SetPropertyStr(ctx,error,"errno",JS_NewInt32(ctx,e));return JS_Throw(ctx,error);}
// Resolve each existing component: a path inside the workspace must never use
// a symlink to reach console system files, even when it does not yet exist.
static int path_ok(const char *p){size_t n=strlen(ROOT);if(strncmp(p,ROOT,n)||(p[n]&&p[n]!='/')||strlen(p)>=1024){errno=EACCES;return 0;}char b[1024];strcpy(b,p);for(char *c=b+n;;c++){if(*c=='/'||!*c){char save=*c;*c=0;const char *component=strrchr(b,'/');if(component&&(!strcmp(component,"/..")||!strcmp(component,"/."))){errno=EACCES;return 0;}struct stat st;if(lstat(b,&st)==0&&S_ISLNK(st.st_mode)){errno=EACCES;return 0;}*c=save;if(!save)break;}}return 1;}
static void number(JSContext *c,JSValue o,const char *k,double n){JS_SetPropertyStr(c,o,k,JS_NewFloat64(c,n));}
static JSValue stat_value(JSContext *c,struct stat *s){JSValue o=JS_NewObject(c);number(c,o,"size",s->st_size);number(c,o,"mtimeMs",(double)s->st_mtim.tv_sec*1000+s->st_mtim.tv_nsec/1000000.0);number(c,o,"mode",s->st_mode);number(c,o,"kind",S_ISREG(s->st_mode)?1:S_ISDIR(s->st_mode)?2:S_ISLNK(s->st_mode)?3:0);return o;}
static uint8_t *buffer(JSContext *c,JSValueConst v,size_t *len,JSValue *backing){*backing=JS_UNDEFINED;uint8_t *b=JS_GetArrayBuffer(c,len,v);if(b)return b;JSValue ex=JS_GetException(c);JS_FreeValue(c,ex);size_t off,bytes;*backing=JS_GetTypedArrayBuffer(c,v,&off,len,&bytes);if(JS_IsException(*backing))return NULL;size_t size;b=JS_GetArrayBuffer(c,&size,*backing);return b?b+off:NULL;}
enum {N_LOG,N_RANDOM,N_STAT,N_STATFS,N_REALPATH,N_MKDIR,N_READDIR,N_RENAME,N_UNLINK,N_RMDIR,N_OPEN,N_READ,N_WRITE,N_FSTAT,N_FSYNC,N_CLOSE,N_CONNECT,N_CONNECTED,N_SEND,N_RECV,N_SHUTDOWN,N_LISTEN,N_PORT,N_ACCEPT,N_SQLITE,N_NATIVE,N_NOTIFY,N_IP,N_PEER,N_TRUNCATE,N_UTIME,N_ASSET,N_STOP,N_FIRMWARE};
static JSValue native(JSContext *c,JSValueConst this_value,int argc,JSValueConst *v,int op){(void)this_value;JSValue result=JS_UNDEFINED,backing=JS_UNDEFINED;const char *p=NULL,*q=NULL;int fd=-1,n=0;int64_t position=0;size_t size=0;uint8_t *bytes=NULL;
 if(op==N_LOG){p=JS_ToCString(c,v[0]);if(p){fprintf(stderr,"%s\n",p);JS_FreeCString(c,p);}return JS_UNDEFINED;}
 if(op>=N_STAT&&op<=N_OPEN){p=JS_ToCString(c,v[0]);if(!p)return JS_EXCEPTION;if(!path_ok(p)){result=fail(c,"Path outside console workspace");goto done;}}
 if(op>=N_READ&&op<=N_CLOSE||op==N_CONNECTED||op>=N_SEND&&op<=N_SHUTDOWN||op==N_PORT||op==N_ACCEPT){JS_ToInt32(c,&fd,v[0]);if(!has(fd)){errno=EBADF;result=fail(c,"Closed native handle");goto done;}}
 switch(op){
 case N_RANDOM:JS_ToInt32(c,&n,v[0]);if(n<0||n>1048576){result=JS_ThrowRangeError(c,"Invalid random size");break;}bytes=malloc(n?n:1);if(!bytes){result=JS_ThrowOutOfMemory(c);break;}
#ifdef __PS5__
 arc4random_buf(bytes,n);
#else
 {if(getrandom(bytes,n,0)!=n){free(bytes);result=fail(c,"Random source unavailable");break;}}
#endif
 result=JS_NewArrayBufferCopy(c,bytes,n);free(bytes);break;
 case N_STAT:{struct stat st;if(lstat(p,&st))result=fail(c,"Cannot stat workspace path");else result=stat_value(c,&st);break;}
 case N_STATFS:{struct statvfs st;if(statvfs(p,&st))result=fail(c,"Cannot read workspace capacity");else{result=JS_NewObject(c);number(c,result,"bsize",st.f_frsize);number(c,result,"bavail",st.f_bavail);number(c,result,"blocks",st.f_blocks);}break;}
 case N_REALPATH:{char resolved[1024];if(!realpath(p,resolved)||!path_ok(resolved))result=fail(c,"Cannot resolve workspace path");else result=JS_NewString(c,resolved);break;}
 case N_MKDIR:if(mkdir(p,0700))result=fail(c,"Cannot create workspace directory");break;
 case N_READDIR:{DIR *d=opendir(p);if(!d){result=fail(c,"Cannot list workspace directory");break;}result=JS_NewArray(c);struct dirent *e;uint32_t i=0;while((e=readdir(d))){if(!strcmp(e->d_name,".")||!strcmp(e->d_name,".."))continue;if(i>=100000){JS_FreeValue(c,result);result=JS_ThrowRangeError(c,"Directory too large");break;}char name[1300];snprintf(name,sizeof name,"%s/%s",p,e->d_name);struct stat s;if(lstat(name,&s))continue;JSValue item=stat_value(c,&s);JS_SetPropertyStr(c,item,"name",JS_NewString(c,e->d_name));JS_SetPropertyUint32(c,result,i++,item);}closedir(d);break;}
 case N_RENAME:q=JS_ToCString(c,v[1]);if(!q||!path_ok(q)||rename(p,q))result=fail(c,"Cannot rename workspace file");break;
 case N_UNLINK:if(unlink(p))result=fail(c,"Cannot remove workspace file");break;
 case N_RMDIR:if(!strcmp(p,ROOT)||rmdir(p))result=fail(c,"Cannot remove workspace directory");break;
 case N_OPEN:{q=JS_ToCString(c,v[1]);int flags=-1;if(q){if(!strcmp(q,"r"))flags=O_RDONLY;else if(!strcmp(q,"w"))flags=O_WRONLY|O_CREAT|O_TRUNC;else if(!strcmp(q,"wx"))flags=O_WRONLY|O_CREAT|O_EXCL;else if(!strcmp(q,"a"))flags=O_WRONLY|O_CREAT|O_APPEND;else if(!strcmp(q,"r+"))flags=O_RDWR;else if(!strcmp(q,"w+"))flags=O_RDWR|O_CREAT|O_TRUNC;}if(flags<0){result=JS_ThrowTypeError(c,"Unsupported file flags");break;}fd=track(open(p,flags|O_NOFOLLOW,0600));result=fd<0?fail(c,"Cannot open workspace file"):JS_NewInt32(c,fd);break;}
 case N_READ:case N_RECV:JS_ToInt32(c,&n,v[1]);if(n<0||n>1048576){result=JS_ThrowRangeError(c,"Read limit exceeded");break;}bytes=malloc(n?n:1);if(!bytes){result=JS_ThrowOutOfMemory(c);break;}{ssize_t count;if(op==N_RECV)count=recv(fd,bytes,n,0);else if(argc>2&&!JS_IsNull(v[2])){JS_ToInt64(c,&position,v[2]);count=pread(fd,bytes,n,position);}else count=read(fd,bytes,n);if(count<0)result=op==N_RECV&&(errno==EAGAIN||errno==EWOULDBLOCK)?JS_NULL:fail(c,"Native read failed");else result=JS_NewArrayBufferCopy(c,bytes,count);}free(bytes);break;
 case N_WRITE:case N_SEND:bytes=buffer(c,v[1],&size,&backing);if(!bytes){result=JS_EXCEPTION;break;}if(size>1048576){result=JS_ThrowRangeError(c,"Write limit exceeded");break;}{ssize_t count;if(op==N_SEND)count=send(fd,bytes,size,0);else if(argc>2&&!JS_IsNull(v[2])){JS_ToInt64(c,&position,v[2]);count=pwrite(fd,bytes,size,position);}else count=write(fd,bytes,size);if(count<0&&op==N_SEND&&(errno==EAGAIN||errno==EWOULDBLOCK))count=0;result=count<0?fail(c,"Native write failed"):JS_NewInt64(c,count);}break;
 case N_FSTAT:{struct stat st;if(fstat(fd,&st))result=fail(c,"Cannot stat workspace handle");else result=stat_value(c,&st);break;}
 case N_FSYNC:if(fsync(fd))result=fail(c,"Workspace sync failed");break;
 case N_CLOSE:release(fd);break;
 case N_CONNECT:{JS_ToInt32(c,&n,v[0]);if(n<1||n>65535){result=JS_ThrowRangeError(c,"Invalid console port");break;}fd=socket(AF_INET,SOCK_STREAM,0);if(fd<0){result=fail(c,"Socket allocation failed");break;}fcntl(fd,F_SETFL,O_NONBLOCK);struct sockaddr_in a={0};a.sin_family=AF_INET;
#ifdef __PS5__
 a.sin_len=sizeof a;
#endif
 a.sin_port=htons(n);a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);if(connect(fd,(struct sockaddr *)&a,sizeof a)<0&&errno!=EINPROGRESS){close(fd);result=fail(c,"Console connection failed");break;}fd=track(fd);result=fd<0?fail(c,"Native handle limit"):JS_NewInt32(c,fd);break;}
 case N_CONNECTED:{struct pollfd pollfd={fd,POLLOUT,0};if(poll(&pollfd,1,0)<0){result=fail(c,"Socket poll failed");break;}if(!pollfd.revents){result=JS_FALSE;break;}int error=0;socklen_t len=sizeof error;getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&len);if(error){errno=error;result=fail(c,"Console service refused connection");}else result=JS_TRUE;break;}
 case N_SHUTDOWN:if(shutdown(fd,SHUT_WR)&&errno!=ENOTCONN)result=fail(c,"Socket shutdown failed");break;
 case N_LISTEN:{JS_ToInt32(c,&n,v[0]);q=JS_ToCString(c,v[1]);if(n!=0&&n!=8780&&n!=2122){result=JS_ThrowRangeError(c,"Local service port is 8780");break;}fd=socket(AF_INET,SOCK_STREAM,0);if(fd<0){result=fail(c,"Listen socket allocation failed");break;}int yes=1;setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof yes);fcntl(fd,F_SETFL,O_NONBLOCK);struct sockaddr_in a={0};a.sin_family=AF_INET;
#ifdef __PS5__
 a.sin_len=sizeof a;
#endif
 a.sin_port=htons(n);a.sin_addr.s_addr=htonl(q&&!strcmp(q,"127.0.0.1")?INADDR_LOOPBACK:INADDR_ANY);
#ifndef __PS5__
 a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
#endif
 if(bind(fd,(struct sockaddr *)&a,sizeof a)||listen(fd,16)){close(fd);result=fail(c,"Local service port unavailable");break;}fd=track(fd);result=fd<0?fail(c,"Native handle limit"):JS_NewInt32(c,fd);break;}
 case N_PORT:{struct sockaddr_in a;socklen_t len=sizeof a;if(getsockname(fd,(struct sockaddr *)&a,&len))result=fail(c,"Cannot read local port");else result=JS_NewInt32(c,ntohs(a.sin_port));break;}
 case N_ACCEPT:{int accepted=accept(fd,NULL,NULL);if(accepted>=0){fcntl(accepted,F_SETFL,O_NONBLOCK);accepted=track(accepted);}result=JS_NewInt32(c,accepted);break;}
 case N_SQLITE:result=JS_ThrowInternalError(c,"Catalog adapter is not installed");break;
 case N_NATIVE:result=JS_ThrowInternalError(c,"Receiver adapter is not installed");break;
 case N_NOTIFY:p=JS_ToCString(c,v[0]);if(p)notify_user(p);break;
 case N_IP:{char value[512];result=JS_NewString(c,local_ip(value));break;}
 case N_TRUNCATE:case N_UTIME:p=JS_ToCString(c,v[0]);if(!p||!path_ok(p)){result=fail(c,"Invalid file attribute path");break;}JS_ToInt64(c,&position,v[1]);if(position<0){result=JS_ThrowRangeError(c,"Invalid file attribute");break;}if(op==N_TRUNCATE){if(truncate(p,position))result=fail(c,"Cannot resize workspace file");}else{struct timeval times[2]={{position/1000,(position%1000)*1000},{position/1000,(position%1000)*1000}};if(utimes(p,times))result=fail(c,"Cannot set workspace timestamp");}break;
 case N_ASSET:JS_ToInt64(c,&position,v[0]);JS_ToInt32(c,&n,v[1]);if(position<0||n<0||n>32*1048576||position+n>tachen_assets_end-tachen_assets_start)result=JS_ThrowRangeError(c,"Invalid static asset");else result=JS_NewArrayBufferCopy(c,tachen_assets_start+position,n);break;
 case N_STOP:if(tac_loader_busy()){result=JS_ThrowInternalError(c,"A native dispatch is still active");break;}stopping=1;break;
 case N_FIRMWARE:
#ifdef __PS5__
 {uint32_t fw=kernel_get_fw_version();char name[16];snprintf(name,sizeof name,"%x.%02x",fw>>24,(fw>>16)&255);result=JS_NewString(c,name);break;}
#else
 result=JS_NULL;break;
#endif
 case N_PEER:{JS_ToInt32(c,&fd,v[0]);if(!has(fd)){result=JS_ThrowTypeError(c,"Closed socket");break;}struct sockaddr_in address;socklen_t length=sizeof address;if(getpeername(fd,(struct sockaddr *)&address,&length))result=fail(c,"Cannot read peer address");else{char name[32];inet_ntop(AF_INET,&address.sin_addr,name,sizeof name);result=JS_NewString(c,name);}break;}
 }
done:if(p)JS_FreeCString(c,p);if(q)JS_FreeCString(c,q);JS_FreeValue(c,backing);return result;
}
static void exception(JSContext *c){JSValue e=JS_GetException(c);const char *message=JS_ToCString(c,e);fprintf(stderr,"Local runtime: %s\n",message?message:"exception");if(message)JS_FreeCString(c,message);JSValue stack=JS_GetPropertyStr(c,e,"stack");const char *trace=JS_ToCString(c,stack);if(trace){fprintf(stderr,"%s\n",trace);JS_FreeCString(c,trace);}JS_FreeValue(c,stack);JS_FreeValue(c,e);}
#ifndef TACHEN_EMBEDDED
static char *load_file(const char *p,size_t *length){FILE *f=fopen(p,"rb");if(!f)return NULL;fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);if(n<0||n>32*1048576){fclose(f);return NULL;}char *b=malloc(n+1);if(!b){fclose(f);return NULL;}*length=fread(b,1,n,f);b[*length]=0;fclose(f);return b;}
#else
#include "bundle.h"
#endif
int main(int argc,char **argv){(void)argc;(void)argv;signal(SIGPIPE,SIG_IGN);mkdir(ROOT,0700);struct stat root_stat;if(lstat(ROOT,&root_stat)||!S_ISDIR(root_stat.st_mode)||S_ISLNK(root_stat.st_mode))return 1;int lock=open(ROOT "/server.lock",O_CREAT|O_RDWR|O_NOFOLLOW,0600);
 if(lock<0){notify_user("TacHen could not open its workspace.");return 1;}
 if(flock(lock,LOCK_EX|LOCK_NB)){char address[512],message[256];snprintf(message,sizeof message,"TacHen is already running\nOpen http://%s:8780",local_ip(address));notify_user(message);close(lock);return 1;}

#ifdef __PS5__
 FILE *runtimeLog=freopen(ROOT "/runtime.log","w",stderr);if(runtimeLog)setvbuf(runtimeLog,NULL,_IOLBF,0);
#endif
 JSRuntime *rt=JS_NewRuntime();if(!rt)return 4;JS_SetMemoryLimit(rt,48*1048576);JS_SetMaxStackSize(rt,2*1048576);context=JS_NewContext(rt);if(!context){JS_FreeRuntime(rt);return 4;}JSValue global=JS_GetGlobalObject(context),api=JS_NewObject(context);
 const char *names[]={"log","random","stat","statfs","realpath","mkdir","readdir","rename","unlink","rmdir","open","read","write","fstat","fsync","close","connect","connected","send","recv","shutdown","listen","port","accept","sqlite","native","notify","ip","peer","truncate","utime","asset","stop","firmware"};for(int i=0;i<(int)(sizeof names/sizeof names[0]);i++)JS_SetPropertyStr(context,api,names[i],JS_NewCFunctionMagic(context,native,names[i],4,JS_CFUNC_generic_magic,i));tac_loader_bind(context,api);tac_system_bind(context,api);tac_manager_bind(context,api);tac_deck_bind(context,api);tac_package_bind(context,api);tac_game_bind(context,api);tac_module_bind(context,api);tac_cheat_bind(context,api);tac_telemetry_bind(context,api);JS_SetPropertyStr(context,global,"__native",api);
#ifdef TACHEN_EMBEDDED
 const char *code=(const char *)tachen_bundle;size_t length=sizeof tachen_bundle-1;
#else
 size_t length=0;char *code=load_file(argv[1],&length);if(!code){fprintf(stderr,"Bundle unavailable\n");return 2;}
#endif
 JSValue evaluation=JS_Eval(context,code,length,"tachen-runtime.js",JS_EVAL_TYPE_GLOBAL);if(JS_IsException(evaluation)){exception(context);return 3;}JS_FreeValue(context,evaluation);
 while(!stopping){JSValue tick=JS_GetPropertyStr(context,global,"__tick");JSValue value=JS_Call(context,tick,global,0,NULL);JS_FreeValue(context,tick);if(JS_IsException(value))exception(context);JS_FreeValue(context,value);JSContext *jobContext;for(int n=0;n<256;n++){int result=JS_ExecutePendingJob(rt,&jobContext);if(result<0){exception(jobContext);break;}if(!result)break;}usleep(10000);}
 for(int i=0;i<MAX_FDS;i++)if(owned[i])release(owned[i]-1);

 JS_FreeValue(context,global);JS_FreeContext(context);JS_FreeRuntime(rt);close(lock);return 0;
}
