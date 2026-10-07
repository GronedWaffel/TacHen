// SPDX-License-Identifier: GPL-3.0-or-later
#include "check.h"
#include "save-recovery.h"
#include "save-recovery-test.h"
#include <stdio.h>
#include <string.h>
#include <errno.h>
enum {ROOT=1,LOCK,STAGE,MOUNT,BASE,EXPORT,ARCHIVE,USB,FOLDER};
static struct {
 TacSaveReceipt receipt;int handles[128],count,open,closed,writes,hashes,progress;
 int sameBoot,bootError,live,unknownPid,locked,foreignStage,mounted,missingStage,missingMount;
 int missingBase,missingExport,missingArchive,symlink,wrongSize,corrupt,readError,movedFile,movedDir;
 int receiptChanged,activeChanged,commitError,syncError,closeError,usbChanged,usbLostLater,catalog;
 int volumeChecks;unsigned char expected[32];
} s;
static int allocate(int kind){CHECK(++s.count<128);s.handles[s.count]=kind;s.open++;return s.count;}
static int kind(int fd){CHECK(fd>0&&fd<=s.count&&s.handles[fd]);return s.handles[fd];}
static int absent(void){errno=ENOENT;return -1;}
static void reset(void){
 memset(&s,0,sizeof s);TacSaveReceipt* r=&s.receipt;
 r->input=(TacSaveRequest){.magic=TAC_SAVE_MAGIC,.version=1,.mode=TAC_SAVE_EXPORT,.bootSec=10,.platform=5};
 memset(r->input.request,'a',32);strcpy(r->input.user,"123");strcpy(r->input.title,"PPSA00001");strcpy(r->input.slot,"sdimg_slot");memset(r->input.stamp,'b',64);
 r->stage=TAC_SAVE_UNKNOWN;r->pid=77;r->archiveBytes=8192;
 unsigned char data[8192]={0},digest[32];tac_save_digest(data,sizeof data,digest);tac_save_hash_text(digest,r->sha256);
 snprintf(r->output,sizeof r->output,"/data/tachen/share/saves/%s/save.tar",r->input.request);
 memset(r->checksum,0x42,32);memcpy(s.expected,r->checksum,32);
}
int openat(int fd,const char* name,int flags,...){
 (void)flags;int k=kind(fd);
 if(k==ROOT&&!strcmp(name,"active.lock"))return allocate(LOCK);
 if(k==EXPORT&&!strcmp(name,"save.tar")){if(s.missingArchive)return absent();if(s.symlink){errno=ELOOP;return -1;}return allocate(ARCHIVE);}
 if(k==ROOT&&strstr(name,".catalog.json")){if(s.missingArchive)return absent();return allocate(ARCHIVE);}
 CHECK(0);return -1;
}
int tac_save_directory(const char* path,int create){
 CHECK(!create);
 if(!strcmp(path,TAC_SAVE_ROOT))return allocate(ROOT);
 if(!strcmp(path,"/data/tachen/share/saves"))return s.missingBase?absent():allocate(BASE);
 if(strstr(path,"/saves/")||strstr(path,"/Saves/"))return allocate(EXPORT);
 CHECK(0);return -1;
}
int tac_save_child_directory(int fd,const char* name,int create){
 CHECK(!create);int k=kind(fd);
 if(k==ROOT&&!strcmp(name,s.receipt.input.request))return s.missingStage?absent():allocate(STAGE);
 if(k==STAGE&&!strcmp(name,"mount"))return s.missingMount?absent():allocate(MOUNT);
 if(k==BASE&&!strcmp(name,s.receipt.input.request))return s.missingExport?absent():allocate(EXPORT);
 if(k==USB&&!strcmp(name,"TacHen"))return s.missingBase?absent():allocate(FOLDER);
 if(k==FOLDER&&!strcmp(name,"Saves"))return allocate(BASE);
 CHECK(0);return -1;
}
static void info(int k,struct stat* st){
 memset(st,0,sizeof *st);st->st_dev=k==STAGE&&s.foreignStage?7:k==MOUNT&&s.mounted?9:1;
 st->st_ino=(unsigned)k;st->st_mode=k==ARCHIVE||k==LOCK?1:2;
 st->st_size=k==ARCHIVE?(s.wrongSize?1:(int64_t)s.receipt.archiveBytes):0;
}
int fstat(int fd,struct stat* st){int k=kind(fd);info(k,st);if(k==EXPORT&&s.movedDir&&s.hashes)st->st_ino=(unsigned)fd;return 0;}
int fstatat(int fd,const char* name,struct stat* st,int flags){
 CHECK(kind(fd)==EXPORT||kind(fd)==ROOT);CHECK(flags==AT_SYMLINK_NOFOLLOW);CHECK(!strcmp(name,"save.tar")||strstr(name,".catalog.json"));
 info(ARCHIVE,st);if(s.movedFile)st->st_ino++;return 0;
}
int fstatfs(int fd,struct statfs* st){int k=kind(fd);memset(st,0,sizeof *st);st->f_fsid=k==MOUNT&&s.mounted?9:1;strcpy(st->f_mntonname,st->f_fsid==9?"/private/mount":"/data");return 0;}
int flock(int fd,int op){CHECK(kind(fd)==LOCK&&op==(LOCK_EX|LOCK_NB));if(s.locked){errno=EWOULDBLOCK;return -1;}return 0;}
int fsync(int fd){CHECK(kind(fd));return s.syncError?-1:0;}
int recovery_test_close(int fd){int k=kind(fd);s.handles[fd]=0;s.closed++;return k==ARCHIVE&&s.closeError?-1:0;}
int recovery_test_dup(int fd){return allocate(kind(fd));}
int recovery_test_kill(int pid,int signal){CHECK(pid==77&&signal==0);if(s.live)return 0;errno=ESRCH;return -1;}
int tac_save_request_load(TacSaveRequest* r){*r=s.receipt.input;if(s.activeChanged)r->request[0]='b';return 0;}
int tac_save_receipt_load(const char* id,TacSaveReceipt* r){CHECK(!strcmp(id,s.receipt.input.request));*r=s.receipt;if(s.receiptChanged&&s.hashes)r->checksum[0]^=1;return 0;}
int tac_save_receipt_save(TacSaveReceipt* r){s.writes++;if(s.commitError)return -1;s.receipt=*r;return 0;}
int tac_save_boot(TacSaveRequest* r,int compare){CHECK(!compare);if(s.bootError)return -1;r->bootSec=s.sameBoot?10:20;return 0;}
int tac_save_hash_file(int fd,uint64_t bytes,char out[65],TacSaveProgress progress,void* context){
 CHECK(kind(fd)==ARCHIVE&&bytes==s.receipt.archiveBytes);s.hashes++;
 if(s.readError)return -1;unsigned char data[8192]={0},digest[32];if(s.corrupt)data[0]=1;
 tac_save_digest(data,sizeof data,digest);tac_save_hash_text(digest,out);
 if(progress)CHECK(!progress(context,bytes));return 0;
}
int tac_save_volume(unsigned destination,char path[64],char stamp[65]){
 CHECK(destination==1);s.volumeChecks++;if(s.usbLostLater&&s.volumeChecks>1)return -1;
 strcpy(path,"/mnt/usb0");memset(stamp,s.usbChanged?'c':'d',64);stamp[64]=0;return 0;
}
int tac_save_volume_open(unsigned d,char path[64],char stamp[65]){if(tac_save_volume(d,path,stamp))return -1;return allocate(USB);}
static void progress(void* ignored,uint64_t completed,uint64_t total){(void)ignored;CHECK(total==8192&&completed<=total);s.progress++;}
static int run(void){char message[192];int result=tac_save_recover(s.receipt.input.request,s.expected,message,progress,NULL);CHECK(s.closed==s.open);return result;}
int main(int argc,char** argv){
 if(argc>1&&!strcmp(argv[1],"--fail-check"))CHECK(0);
 reset();CHECK(!run());CHECK(s.writes==1&&s.hashes==1&&s.progress==2);CHECK(s.receipt.stage==TAC_SAVE_COMPLETE&&s.receipt.clean&&!s.receipt.mounted);
 reset();s.sameBoot=1;CHECK(!run());CHECK(s.receipt.stage==TAC_SAVE_COMPLETE);
 for(unsigned fault=0;fault<13;fault++){
  reset();switch(fault){case 0:s.locked=1;break;case 1:s.bootError=1;break;case 2:s.sameBoot=s.live=1;break;
   case 3:s.sameBoot=1;s.receipt.pid=0;break;case 4:s.foreignStage=1;break;case 5:s.mounted=1;break;
   case 6:s.symlink=1;break;case 7:s.wrongSize=1;break;case 8:s.corrupt=1;break;case 9:s.readError=1;break;
   case 10:s.movedFile=1;break;case 11:s.movedDir=1;break;case 12:s.activeChanged=1;break;}
  CHECK(run());CHECK(!s.writes&&s.receipt.stage==TAC_SAVE_UNKNOWN);
 }
 reset();s.receiptChanged=1;CHECK(run());CHECK(!s.writes);
 reset();s.expected[0]^=1;CHECK(run());CHECK(!s.hashes&&!s.writes);
 reset();s.syncError=1;CHECK(run());CHECK(!s.writes);
 reset();s.closeError=1;CHECK(run());CHECK(!s.writes);
 reset();s.commitError=1;CHECK(run());CHECK(s.writes==1&&s.receipt.stage==TAC_SAVE_UNKNOWN);
 for(unsigned absentCase=0;absentCase<3;absentCase++){
  reset();if(!absentCase)s.missingBase=1;else if(absentCase==1)s.missingExport=1;else s.missingArchive=1;
  CHECK(!run());CHECK(!s.hashes&&s.writes==1&&s.receipt.stage==TAC_SAVE_REJECTED&&s.receipt.clean&&!s.receipt.mounted);
 }
 reset();s.missingStage=1;CHECK(!run());CHECK(s.receipt.stage==TAC_SAVE_COMPLETE);
 reset();s.missingMount=1;CHECK(!run());CHECK(s.receipt.stage==TAC_SAVE_COMPLETE);
 reset();s.receipt.input.mode=TAC_SAVE_CATALOG;s.receipt.archiveBytes=0;s.receipt.sha256[0]=0;
 CHECK(!run());CHECK(s.receipt.stage==TAC_SAVE_REJECTED&&!s.hashes);
 for(unsigned usb=0;usb<4;usb++){
  reset();s.receipt.input.destination=1;memset(s.receipt.input.volume,'d',64);
  snprintf(s.receipt.output,sizeof s.receipt.output,"/mnt/usb0/TacHen/Saves/%s/save.tar",s.receipt.input.request);
  if(usb==1)s.usbChanged=1;else if(usb==2)s.usbLostLater=1;else if(usb==3){s.usbLostLater=s.missingBase=1;}
  if(!usb){CHECK(!run());CHECK(s.receipt.stage==TAC_SAVE_COMPLETE);}else{CHECK(run());CHECK(!s.writes);}
 }
 puts("Native save recovery I/O: ownership, boot/process/mount proof, exact archive hashing, USB identity, commit and retained failures passed");return 0;
}
