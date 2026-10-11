// SPDX-License-Identifier: GPL-3.0-or-later
// Launch ABI follows PS Neighborhood / Itemzflow. Runs outside ShellUI and
// outside the coordinator so temporary credentials and a watchdog stay local.
#include "app-launch.h"
#include <ps5/kernel.h>
#include <sys/file.h>
#include <dlfcn.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <signal.h>
struct LaunchParam{uint32_t size,user,options;uint64_t crash;uint32_t flags;};
_Static_assert(sizeof(struct LaunchParam)==32,"Launch parameter ABI");
static int publish(TacAppLaunch*r,unsigned stage,const char*message){r->stage=stage;snprintf(r->message,sizeof r->message,"%s",message);return tac_app_save(r,0);}
int main(void){
 signal(SIGALRM,SIG_DFL);alarm(20);
 int lock=open("/data/tachen/launches/active.lock",O_CREAT|O_RDWR|O_NOFOLLOW,0600);if(lock<0||flock(lock,LOCK_EX|LOCK_NB))return 1;
 int fd=open("/data/tachen/launches/current",O_RDONLY|O_NOFOLLOW);char id[33]={0};if(fd<0)return 2;ssize_t n=read(fd,id,33);close(fd);if(n!=32||!tac_app_id_valid(id))return 2;
 TacAppLaunch r={0};if(tac_app_load(id,&r)||tac_app_boot(&r,1)||r.stage!=1)return 3;r.pid=getpid();
 void*sys=dlopen("libSceSystemService.sprx",RTLD_LAZY),*usr=dlopen("libSceUserService.sprx",RTLD_LAZY);
 if(!sys||!usr){publish(&r,4,"Game-launch services could not be loaded");return 4;}
 int(*appid)(const char*)=dlsym(sys,"sceLncUtilGetAppId");int(*launch)(const char*,const char**,struct LaunchParam*)=dlsym(sys,"sceLncUtilLaunchApp");
 int(*init)(void)=dlsym(sys,"sceLncUtilInitialize");int(*userinit)(const void*)=dlsym(usr,"sceUserServiceInitialize");int(*user)(int*)=dlsym(usr,"sceUserServiceGetForegroundUser");
 int(*active)(void)=dlsym(sys,"sceSystemServiceGetAppIdOfRunningBigApp");
 if(!appid||!launch||!init||!userinit||!user||!active){publish(&r,4,"Game-launch functions are unavailable");return 4;}
 uint64_t saved=kernel_get_ucred_authid(getpid());if(!saved||saved==UINT64_MAX){publish(&r,4,"Could not read launch credentials");return 4;}
 if(kernel_set_ucred_authid(getpid(),UINT64_C(0x4801000000000013))||kernel_get_ucred_authid(getpid())!=UINT64_C(0x4801000000000013)){kernel_set_ucred_authid(getpid(),saved);publish(&r,4,"Could not establish launch credentials");return 4;}
 int uid=-1;const char*reason="Game launch was not submitted";unsigned stage=4;
 init();userinit(0);r.appId=appid(r.title);
 if(r.appId>=0){stage=3;reason="Game is already running";goto done;}
 if(r.appId!=-1){r.result=r.appId;reason="Could not check the selected game";goto done;}
 int current=active();if(current>=0){reason="Close the current game before starting another";goto done;}
 if(current!=-1){r.result=current;reason="Could not confirm that the current game is closed";goto done;}
 if(user(&uid)||uid<=0){reason="Sign in to a console user before starting a game";goto done;}
 if(publish(&r,2,"Starting game"))goto done;
 struct LaunchParam p={.size=sizeof p,.user=(uint32_t)uid,.flags=2};r.result=launch(r.title,0,&p);stage=5;reason="Launch submitted; waiting for the game to appear";
 if(r.result<0){reason="Console rejected the game launch";goto done;}
 for(unsigned i=0;i<40;i++){r.appId=appid(r.title);if(r.appId>=0){stage=3;reason="Game started";break;}usleep(250000);}
done:
 {int restored=0;for(unsigned i=0;i<3;i++)if(!kernel_set_ucred_authid(getpid(),saved)&&kernel_get_ucred_authid(getpid())==saved){restored=1;break;}if(!restored){stage=5;reason="Launch helper could not verify restored credentials";}publish(&r,stage,reason);}
 return stage==3?0:1;
}
