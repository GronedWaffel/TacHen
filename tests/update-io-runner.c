// SPDX-License-Identifier: GPL-3.0-or-later
#include "update-io-test.h"
#include "update-io.h"
#include "check.h"

// A bounded in-memory filesystem lets the production I/O code see short I/O,
// EINTR, failed barriers and invalid file types without touching /data or a PS5.
typedef struct { char path[256];unsigned type;uint8_t *data;size_t size;int synced; } File;
typedef struct { int used,file,flags,locked;size_t position; } Handle;
static File files[32],durable[32];static Handle handles[16];
static unsigned calls,trigger;static const char *fail_op,*fail_path;
static size_t chunk_limit;static int interrupt_read,interrupt_write,zero_write,zero_read;
static int boot_error,boot_short;static struct timeval boot={100,22};
static unsigned fsyncs,renames,writes;
static int fault(const char *op,const char *path){
  if(fail_op&&!strcmp(op,fail_op)&&(!fail_path||strstr(path,fail_path))&&++calls==trigger){errno=EIO;return 1;}return 0;
}
static void inject(const char *op,const char *path,unsigned at){fail_op=op;fail_path=path;trigger=at;calls=0;}
static void clear_faults(void){inject(NULL,NULL,0);chunk_limit=0;interrupt_read=interrupt_write=zero_read=zero_write=0;boot_error=boot_short=0;}
static int find(const char *path){for(int i=0;i<32;i++)if(files[i].type&&!strcmp(path,files[i].path))return i;return -1;}
static int put(const char *path,unsigned type,const void *data,size_t size){
  int i=find(path);if(i<0){for(i=0;i<32&&files[i].type;i++){}CHECK(i<32);}
  File *f=&files[i];free(f->data);memset(f,0,sizeof *f);snprintf(f->path,sizeof f->path,"%s",path);f->type=type;
  if(size){f->data=malloc(size);CHECK(f->data);memcpy(f->data,data,size);}f->size=size;return i;
}
static void copy_files(File *to,const File *from){for(int i=0;i<32;i++){free(to[i].data);to[i]=from[i];to[i].data=NULL;if(from[i].size){to[i].data=malloc(from[i].size);CHECK(to[i].data);memcpy(to[i].data,from[i].data,from[i].size);}}}
static void reset(void){for(int i=0;i<32;i++){free(files[i].data);free(durable[i].data);}memset(files,0,sizeof files);memset(durable,0,sizeof durable);memset(handles,0,sizeof handles);clear_faults();fsyncs=renames=writes=0;boot=(struct timeval){100,22};}
static void crash(void){memset(handles,0,sizeof handles);copy_files(files,durable);clear_faults();}
static int open_count(void){int n=0;for(int i=0;i<16;i++)n+=handles[i].used;return n;}
static Handle *handle(int fd){CHECK(fd>=3&&fd<19&&handles[fd-3].used);return &handles[fd-3];}
int mock_mkdir(const char *p,int mode){CHECK(mode==0700);if(fault("mkdir",p))return -1;if(find(p)>=0){errno=EEXIST;return -1;}put(p,TEST_DIR,NULL,0);return 0;}
int mock_open(const char *p,int flags,...){
  if(fault("open",p))return -1;int i=find(p);if(i<0){if(!(flags&O_CREAT)){errno=ENOENT;return -1;}i=put(p,TEST_REG,NULL,0);}
  if(files[i].type==TEST_LINK&&(flags&O_NOFOLLOW)){errno=EACCES;return -1;}
  if((flags&O_DIRECTORY)&&files[i].type!=TEST_DIR){errno=ENOTDIR;return -1;}
  if(files[i].type==TEST_FIFO&&(flags&(O_RDONLY|O_WRONLY)))CHECK(flags&O_NONBLOCK);
  if(flags&O_TRUNC){CHECK(flags&(O_RDWR|O_WRONLY));free(files[i].data);files[i].data=NULL;files[i].size=0;files[i].synced=0;}
  for(int j=0;j<16;j++)if(!handles[j].used){handles[j]=(Handle){1,i,flags,0,0};return j+3;}errno=EMFILE;return -1;
}
int mock_close(int fd){Handle *h=handle(fd);int rc=fault("close",files[h->file].path)?-1:0;h->used=0;return rc;}
int mock_lstat(const char *p,struct stat *s){if(fault("lstat",p))return -1;int i=find(p);if(i<0){errno=ENOENT;return -1;}*s=(struct stat){files[i].type,(int64_t)files[i].size};return 0;}
int mock_fstat(int fd,struct stat *s){Handle *h=handle(fd);if(fault("fstat",files[h->file].path))return -1;*s=(struct stat){files[h->file].type,(int64_t)files[h->file].size};return 0;}
int mock_flock(int fd,int flags){Handle *h=handle(fd);CHECK(flags==(LOCK_EX|LOCK_NB));if(fault("flock",files[h->file].path))return -1;for(int i=0;i<16;i++)if(handles[i].used&&handles[i].file==h->file&&handles[i].locked){errno=EAGAIN;return -1;}h->locked=1;return 0;}
int mock_fsync(int fd){Handle *h=handle(fd);File *f=&files[h->file];fsyncs++;if(fault("fsync",f->path))return -1;if(f->type==TEST_DIR)copy_files(durable,files);else f->synced=1;return 0;}
int mock_rename(const char *old,const char *next){
  renames++;if(fault("rename",old))return -1;int i=find(old),dest=find(next);CHECK(i>=0);CHECK(files[i].synced);
  if(dest>=0){free(files[dest].data);memset(&files[dest],0,sizeof files[dest]);}snprintf(files[i].path,sizeof files[i].path,"%s",next);return 0;
}
int mock_unlink(const char *p){if(fault("unlink",p))return -1;int i=find(p);if(i<0){errno=ENOENT;return -1;}free(files[i].data);memset(&files[i],0,sizeof files[i]);return 0;}
ssize_t mock_read(int fd,void *p,size_t n){Handle *h=handle(fd);File *f=&files[h->file];CHECK(h->flags&(O_RDONLY|O_RDWR));if(fault("read",f->path))return -1;if(interrupt_read){interrupt_read--;errno=EINTR;return -1;}if(zero_read)return 0;
  if(n>f->size-h->position)n=f->size-h->position;if(chunk_limit&&n>chunk_limit)n=chunk_limit;memcpy(p,f->data+h->position,n);h->position+=n;return (ssize_t)n;}
ssize_t mock_write(int fd,const void *p,size_t n){Handle *h=handle(fd);File *f=&files[h->file];CHECK(h->flags&(O_WRONLY|O_RDWR));writes++;if(fault("write",f->path))return -1;if(interrupt_write){interrupt_write--;errno=EINTR;return -1;}if(zero_write)return 0;if(chunk_limit&&n>chunk_limit)n=chunk_limit;
  if(h->position+n>f->size){f->data=realloc(f->data,h->position+n);CHECK(f->data);f->size=h->position+n;}memcpy(f->data+h->position,p,n);h->position+=n;f->synced=0;return (ssize_t)n;}
int mock_sysctl(const int *mib,unsigned count,void *out,size_t *size,const void *input,size_t length){CHECK(count==2&&mib[0]==CTL_KERN&&mib[1]==KERN_BOOTTIME&&!input&&!length&&*size==sizeof boot);if(boot_error)return -1;memcpy(out,&boot,sizeof boot);*size=sizeof boot-(unsigned)boot_short;return 0;}

static TacUpdateState baseline(void){TacUpdateState s;tac_update_init(&s);int fd=tac_update_lock();CHECK(fd>=0);CHECK(!tac_update_write(&s));CHECK(s.revision==1);CHECK(!mock_close(fd));CHECK(!open_count());return s;}
static void journal(void){
  reset();TacUpdateState s;tac_update_init(&s);int recovered=-1;CHECK(!tac_update_read(&s,&recovered));CHECK(!recovered&&!s.revision);
  int fd=tac_update_lock();CHECK(fd>=0);CHECK(tac_update_lock()<0);CHECK(open_count()==1);CHECK(!mock_close(fd));CHECK(!open_count());
  chunk_limit=19;interrupt_write=2;CHECK(!tac_update_write(&s));CHECK(s.revision==1);interrupt_read=2;TacUpdateState readback;CHECK(!tac_update_read(&readback,&recovered));CHECK(!recovered&&!memcmp(&s,&readback,sizeof s));
  CHECK(!tac_update_write(&s));CHECK(s.revision==2);CHECK(!tac_update_read(&readback,&recovered));CHECK(!memcmp(&s,&readback,sizeof s));CHECK(!open_count());
  crash();CHECK(!tac_update_read(&readback,&recovered));CHECK(!recovered&&readback.revision==2);
  struct {const char *op,*path;unsigned at;} failures[]={
    {"open",".part",1},{"fstat",".part",1},{"write",".part",1},{"write",".part",3},{"fsync",".part",1},{"close",".part",1},
    {"rename",".part",1},{"open",TAC_UPDATE_ROOT,2},{"fsync",TAC_UPDATE_ROOT,2},{"close",TAC_UPDATE_ROOT,2}
  };
  for(unsigned i=0;i<sizeof failures/sizeof failures[0];i++){
    reset();s=baseline();TacUpdateState before=s;chunk_limit=37;inject(failures[i].op,failures[i].path,failures[i].at);
    CHECK(tac_update_write(&s)<0);CHECK(!memcmp(&s,&before,sizeof s));CHECK(!open_count());clear_faults();
    // A failed commit may already be visible. Always reload; never reuse the
    // caller's old revision as proof that nothing happened.
    CHECK(!tac_update_read(&readback,&recovered));CHECK(!recovered);CHECK(readback.revision==1||readback.revision==2);
    crash();CHECK(!tac_update_read(&readback,&recovered));CHECK(!recovered);CHECK(readback.revision==(i==9?2:1));
  }
  reset();s=baseline();zero_write=1;CHECK(tac_update_write(&s)<0);CHECK(s.revision==1);CHECK(!open_count());clear_faults();
  CHECK(!tac_update_write(&s));int slot=find(TAC_UPDATE_ROOT "/selection-0.bin");CHECK(slot>=0);files[slot].data[100]^=1;
  CHECK(!tac_update_read(&readback,&recovered));CHECK(recovered&&readback.revision==1);files[find(TAC_UPDATE_ROOT "/selection-1.bin")].data[0]^=1;CHECK(tac_update_read(&readback,&recovered)<0);CHECK(!open_count());
  reset();s=baseline();put(TAC_UPDATE_ROOT "/selection-0.bin",TEST_REG,&s,sizeof s);CHECK(!tac_update_read(&readback,&recovered));CHECK(recovered&&readback.revision==1);
  reset();s=baseline();zero_read=1;CHECK(tac_update_read(&readback,&recovered)<0);CHECK(!open_count());clear_faults();
  put(TAC_UPDATE_ROOT "/selection-0.bin",TEST_LINK,NULL,0);CHECK(tac_update_read(&readback,&recovered)<0);CHECK(!open_count());
  reset();s=baseline();put(TAC_UPDATE_ROOT "/selection-0.bin.part",TEST_LINK,NULL,0);CHECK(tac_update_write(&s)<0);CHECK(s.revision==1);CHECK(!open_count());
  for(unsigned type=TEST_REG;type<=TEST_FIFO;type++){if(type==TEST_DIR)continue;reset();put(TAC_UPDATE_ROOT,type,NULL,0);CHECK(tac_update_lock()<0);CHECK(!open_count());}
  reset();put(TAC_UPDATE_ROOT "/selection.lock",TEST_FIFO,NULL,0);CHECK(tac_update_lock()<0);CHECK(!open_count());
  reset();s=baseline();put(TAC_UPDATE_ROOT "/selection-0.bin",TEST_FIFO,NULL,0);CHECK(!tac_update_read(&readback,&recovered));CHECK(recovered);CHECK(!open_count());
  puts("journal fault injection passed");
}
static void image_tests(const uint8_t *bytes,size_t size){
  TacUpdateHeader h,saved;CHECK(!tac_update_image(bytes,size,0x13600000,&h));char hash[65],file[256];tac_update_hex(h.payload_hash,hash);snprintf(file,sizeof file,TAC_UPDATE_ROOT "/%s.tachen",hash);
  reset();int lock=tac_update_lock();CHECK(lock>=0);chunk_limit=4093;interrupt_write=3;CHECK(!tac_update_save_image(bytes,size,0x13600000,&saved));CHECK(!memcmp(&saved,&h,sizeof h));unsigned prior_writes=writes;
  interrupt_read=3;uint8_t *copy=NULL;size_t length=0;CHECK(!tac_update_read_image(&h,0x13600000,&copy,&length));CHECK(length==size&&!memcmp(bytes,copy,size));free(copy);
  CHECK(!tac_update_save_image(bytes,size,0x13600000,&saved));CHECK(writes==prior_writes);CHECK(!mock_close(lock));crash();CHECK(!tac_update_read_image(&h,0x13600000,&copy,&length));free(copy);
  files[find(file)].data[size-1]^=1;CHECK(tac_update_save_image(bytes,size,0x13600000,&saved)<0);CHECK(writes==prior_writes);CHECK(files[find(file)].data[size-1]!=(uint8_t)bytes[size-1]);CHECK(!open_count());
  const char *ops[]={"write","fsync","close","rename"};for(unsigned i=0;i<4;i++){
    reset();lock=tac_update_lock();CHECK(lock>=0);TacUpdateHeader untouched;memset(&saved,0x5a,sizeof saved);untouched=saved;inject(ops[i],".part",1);
    CHECK(tac_update_save_image(bytes,size,0x13600000,&saved)<0);CHECK(!memcmp(&saved,&untouched,sizeof saved));CHECK(find(file)<0);CHECK(open_count()==1);clear_faults();mock_close(lock);
  }
  reset();lock=tac_update_lock();CHECK(lock>=0);inject("fsync",TAC_UPDATE_ROOT,2);CHECK(tac_update_save_image(bytes,size,0x13600000,&saved)<0);CHECK(find(file)>=0);clear_faults();CHECK(!tac_update_save_image(bytes,size,0x13600000,&saved));mock_close(lock);
  crash();CHECK(!tac_update_read_image(&h,0x13600000,&copy,&length));free(copy);
  reset();put(file,TEST_LINK,NULL,0);CHECK(tac_update_save_image(bytes,size,0x13600000,&saved)<0);CHECK(!writes&&!open_count());
  reset();put(file,TEST_REG,bytes,size-1);CHECK(tac_update_read_image(&h,0x13600000,&copy,&length)<0);CHECK(!open_count());
  reset();put(file,TEST_REG,bytes,size);zero_read=1;CHECK(tac_update_read_image(&h,0x13600000,&copy,&length)<0);CHECK(!open_count());clear_faults();CHECK(tac_update_read_image(&h,0x14000000,&copy,&length)<0);
  reset();TacUpdateState s=baseline();CHECK(!tac_update_save_image(bytes,size,0x13600000,&saved));
  TacUpdateHeader *keep[]={&s.good,&s.previous,&s.candidate,&s.attempt};for(unsigned i=0;i<4;i++){
    *keep[i]=h;CHECK(tac_update_retire_image(&s,hash,s.revision)<0);CHECK(find(file)>=0);memset(keep[i],0,sizeof h);
  }
  CHECK(tac_update_retire_image(&s,hash,s.revision+1)<0);CHECK(tac_update_retire_image(&s,"../../selection-0.bin",s.revision)<0);CHECK(find(file)>=0);
  inject("unlink",file,1);CHECK(tac_update_retire_image(&s,hash,s.revision)<0);CHECK(find(file)>=0);clear_faults();
  inject("fsync",TAC_UPDATE_ROOT,1);CHECK(tac_update_retire_image(&s,hash,s.revision)<0);CHECK(find(file)<0);clear_faults();
  // Repeating the exact approved removal safely commits an already-absent file.
  CHECK(!tac_update_retire_image(&s,hash,s.revision));crash();CHECK(find(file)<0);CHECK(!open_count());
  put(file,TEST_LINK,NULL,0);CHECK(tac_update_retire_image(&s,hash,s.revision)<0);CHECK(find(file)>=0);put(file,TEST_REG,bytes,size-1);CHECK(tac_update_retire_image(&s,hash,s.revision)<0);CHECK(find(file)>=0);
  put(file,TEST_FIFO,NULL,0);CHECK(tac_update_retire_image(&s,hash,s.revision)<0);CHECK(tac_update_read_image(&h,0x13600000,&copy,&length)<0);CHECK(!open_count());
  puts("image I/O fault injection passed");
}
static void boot_tests(void){reset();int64_t sec=-1,usec=-1;CHECK(!tac_update_boot(&sec,&usec)&&sec==100&&usec==22);boot_error=1;CHECK(tac_update_boot(&sec,&usec)<0);clear_faults();boot_short=1;CHECK(tac_update_boot(&sec,&usec)<0);clear_faults();boot.tv_sec=0;CHECK(tac_update_boot(&sec,&usec)<0);boot.tv_sec=1;boot.tv_usec=-1;CHECK(tac_update_boot(&sec,&usec)<0);boot.tv_usec=1000000;CHECK(tac_update_boot(&sec,&usec)<0);puts("boot identity checks passed");}
int main(int argc,char **argv){CHECK(argc==3);if(!strcmp(argv[1],"journal"))journal();else if(!strcmp(argv[1],"boot"))boot_tests();else{
  FILE *f=fopen(argv[2],"rb");CHECK(f);CHECK(!fseek(f,0,SEEK_END));long size=ftell(f);CHECK(size>256);rewind(f);uint8_t *bytes=malloc((size_t)size);CHECK(bytes);CHECK(fread(bytes,1,(size_t)size,f)==(size_t)size);fclose(f);image_tests(bytes,(size_t)size);free(bytes);
  }reset();return 0;}
