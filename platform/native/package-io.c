// SPDX-License-Identifier: GPL-3.0-or-later
#include "package-io.h"
#include "sha256.h"
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <sys/time.h>
#include <time.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
static void digest(const void* p,size_t n,unsigned char* out){SHA256_CTX s;sha256_init(&s);sha256_update(&s,p,n);sha256_final(&s,out);}
int tac_package_directory(void){
 struct stat st;
 if(lstat("/data/tachen",&st)||!S_ISDIR(st.st_mode)||S_ISLNK(st.st_mode))return -1;
 if(mkdir(TAC_PACKAGE_ROOT,0700)&&errno!=EEXIST)return -1;
 return lstat(TAC_PACKAGE_ROOT,&st)||!S_ISDIR(st.st_mode)||S_ISLNK(st.st_mode)?-1:0;
}
static int load(const char* path,void* value,size_t bytes){
 int fd=open(path,O_RDONLY|O_NOFOLLOW);if(fd<0)return -1;struct stat st;size_t at=0;
 int bad=fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_size!=(off_t)bytes;
 while(!bad&&at<bytes){ssize_t n=read(fd,(unsigned char*)value+at,bytes-at);if(n<0&&errno==EINTR)continue;if(n<=0)bad=1;else at+=(size_t)n;}
 close(fd);if(bad){errno=EINVAL;return -1;}return 0;
}
static int save(const char* path,const void* value,size_t bytes){
 char temporary[256];if(snprintf(temporary,sizeof temporary,"%s.tmp",path)>=(int)sizeof temporary){errno=EINVAL;return -1;}
 int fd=open(temporary,O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW,0600);if(fd<0)return -1;size_t at=0;int bad=0;
 while(at<bytes){ssize_t n=write(fd,(const unsigned char*)value+at,bytes-at);if(n<0&&errno==EINTR)continue;if(n<=0){bad=1;break;}at+=(size_t)n;}
 if(!bad)bad=fsync(fd);if(close(fd))bad=1;if(!bad)bad=rename(temporary,path);if(bad)return -1;
 fd=open(TAC_PACKAGE_ROOT,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)return -1;bad=fsync(fd);close(fd);return bad?-1:0;
}
int tac_package_request_load(TacPackageRequest* r){
 if(load(TAC_PACKAGE_ROOT "/request.bin",r,sizeof *r))return -1;unsigned char sum[32];digest(r,offsetof(TacPackageRequest,checksum),sum);
 if(!tac_package_request_valid(r)||memcmp(sum,r->checksum,32)){errno=EINVAL;return -1;}return 0;
}
int tac_package_request_save(TacPackageRequest* r){
 if(!tac_package_request_valid(r)){errno=EINVAL;return -1;}digest(r,offsetof(TacPackageRequest,checksum),r->checksum);
 return save(TAC_PACKAGE_ROOT "/request.bin",r,sizeof *r);
}
int tac_package_receipt_load(const char* request,TacPackageReceipt* r){
 if(!tac_package_hex(request,32)){errno=EINVAL;return -1;}char path[256];snprintf(path,sizeof path,TAC_PACKAGE_ROOT "/%s.receipt",request);
 if(load(path,r,sizeof *r))return -1;unsigned char sum[32];digest(r,offsetof(TacPackageReceipt,checksum),sum);
 if(!tac_package_request_valid(&r->input)||strcmp(request,r->input.request)||r->stage<1||r->stage>TAC_PKG_UNKNOWN||r->clean>1||r->accepted>1||r->observed>1||
   r->state[15]||r->message[191]||r->total>TAC_PACKAGE_MAX||r->downloaded>r->total||memcmp(sum,r->checksum,32)){errno=EINVAL;return -1;}
 return 0;
}
int tac_package_receipt_save(TacPackageReceipt* r){
 r->updated=tac_package_millis();digest(r,offsetof(TacPackageReceipt,checksum),r->checksum);
 char path[256];snprintf(path,sizeof path,TAC_PACKAGE_ROOT "/%s.receipt",r->input.request);return save(path,r,sizeof *r);
}
int tac_package_boot(TacPackageRequest* r,int compare){
 struct timeval boot;size_t size=sizeof boot;int mib[]={CTL_KERN,KERN_BOOTTIME};
 if(sysctl(mib,2,&boot,&size,NULL,0)||size!=sizeof boot)return -1;
 if(compare)return r->bootSec==boot.tv_sec&&r->bootUsec==boot.tv_usec?0:-1;
 r->bootSec=boot.tv_sec;r->bootUsec=boot.tv_usec;return 0;
}
uint64_t tac_package_millis(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
