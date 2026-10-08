#include "process-info.h"
#include "check.h"
#include <errno.h>
#include <string.h>
#include <stdio.h>
static unsigned char bytes[2200];static size_t required,returned;static int fail_query,fail_read,reads;
int sysctl(const int* mib,unsigned count,void* out,size_t* size,const void* value,size_t n){
 (void)value;(void)n;CHECK(count==4&&mib[3]==58);
 if(!out){if(fail_query){errno=ESRCH;return -1;}*size=required;return 0;}
 reads++;if(fail_read||*size<returned){errno=ENOMEM;return -1;}
 memcpy(out,bytes,returned);*size=returned;return 0;
}
static void reset(size_t n){
 memset(bytes,0,sizeof bytes);struct kinfo_proc info={0};info.ki_structsize=(int)n;info.ki_pid=58;info.ki_start.tv_sec=1234;info.ki_start.tv_usec=56;info.ki_runtime=789;strcpy(info.ki_comm,"SceShellUI");memcpy(bytes,&info,sizeof info);
 required=returned=n;fail_query=fail_read=reads=0;
}
int main(int argc,char** argv){
 (void)argv;if(argc>1)CHECK(0);CHECK(sizeof(struct kinfo_proc)==1088);struct kinfo_proc info;
 reset(1096);CHECK(!tac_process_info(58,&info));CHECK(info.ki_pid==58&&info.ki_structsize==1096&&info.ki_start.tv_sec==1234&&info.ki_runtime==789&&!strcmp(info.ki_comm,"SceShellUI"));
 reset(1088);CHECK(!tac_process_info(58,&info));
 reset(1096);required=70000;CHECK(tac_process_info(58,&info)<0&&reads==0);
 reset(1096);required=4;CHECK(tac_process_info(58,&info)<0&&reads==0);
 reset(1096);returned=24;CHECK(tac_process_info(58,&info)<0&&info.ki_pid==0);
 reset(1096);((struct kinfo_proc*)bytes)->ki_pid=59;CHECK(tac_process_info(58,&info)<0&&errno==ESRCH&&info.ki_pid==0);
 reset(1096);((struct kinfo_proc*)bytes)->ki_structsize=1088;CHECK(tac_process_info(58,&info)<0&&info.ki_pid==0);
 reset(1096);returned=2192;required=2192;CHECK(tac_process_info(58,&info)<0&&info.ki_pid==0);
 reset(1096);fail_read=1;CHECK(tac_process_info(58,&info)<0&&errno==ENOMEM&&info.ki_pid==0);
 reset(1096);fail_query=1;CHECK(tac_process_info(58,&info)<0&&errno==ESRCH&&reads==0);
 CHECK(tac_process_info(0,&info)<0&&errno==EINVAL);
 puts("Process record size and identity checks passed");return 0;
}
