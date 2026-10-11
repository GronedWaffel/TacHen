// SPDX-License-Identifier: GPL-3.0-or-later
// The launcher never retries native dispatch in one boot. The selected runtime
// must independently confirm its complete configured startup before promotion.
#include "update-io.h"
#include "elfldr.h"
#include "kstuff-probe.h"
#include <ps5/kernel.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
extern const unsigned char tachen_fallback_start[],tachen_fallback_end[];
static void notify(const char *text){extern int sceKernelSendNotificationRequest(int,const void*,size_t,int);unsigned char message[0xc30]={0};int target=-1;memcpy(message+0x10,&target,sizeof target);message[0x2c]=1;snprintf((char*)message+0x2d,1024,"%s",text);snprintf((char*)message+0x42d,1024,"cxml://psnotification/tex_icon_system");sceKernelSendNotificationRequest(0,message,sizeof message,0);}
int main(void){
  int lock=tac_update_lock();if(lock<0){notify("TacHen launcher: update selection is busy or unavailable.");return 1;}
  int server=open("/data/tachen/server.lock",O_CREAT|O_RDWR|O_NOFOLLOW,0600);struct stat st;
  if(server<0||fstat(server,&st)||!S_ISREG(st.st_mode)||flock(server,LOCK_EX|LOCK_NB)){if(server>=0)close(server);close(lock);notify("TacHen is already running, or its workspace is unavailable.");return 1;}
  // The durable per-boot attempt below closes the interval between releasing
  // this lock and the child acquiring it. Never carry a locked descriptor into spawn.
  close(server);
  TacUpdateState state;int recovered=0;int64_t sec,usec;uint32_t fw=kernel_get_fw_version();
  TacUpdateHeader fallback;size_t fallback_size=(size_t)(tachen_fallback_end-tachen_fallback_start);
  if(tac_update_read(&state,&recovered)||recovered||tac_update_boot(&sec,&usec)||
     tac_update_save_image(tachen_fallback_start,fallback_size,fw,&fallback)){
    close(lock);notify("TacHen launcher: saved selection or bundled fallback could not be verified. Nothing launched.");return 1;
  }
#ifdef TACHEN_BUNDLED_RUNTIME
  int planned=tac_update_plan_bundled(&state,sec,usec,&fallback);
  if(planned==-2){close(lock);notify("TacHen bundled test: a different update is pending. Discard or finish that update first.");return 1;}
#else
  int planned=tac_update_plan(&state,sec,usec,&fallback);
#endif
  if(planned){close(lock);notify("TacHen already has a launch attempt in this boot. Restart before another attempt.");return 1;}
  uint8_t *image=NULL;size_t size=0;
  if(tac_update_read_image(&state.attempt,fw,&image,&size)){
#ifdef TACHEN_BUNDLED_RUNTIME
    close(lock);notify("TacHen bundled test: embedded build could not be read. Nothing launched.");return 1;
#else
    TacUpdateHeader good=state.good;
    if(tac_update_header(&good,sizeof good,&good)||tac_update_read_image(&good,fw,&image,&size)){
      good=fallback;if(tac_update_read_image(&good,fw,&image,&size)){close(lock);notify("TacHen launcher: no verified fallback image is readable.");return 1;}
    }
    if(tac_update_fallback(&state,&good)){free(image);close(lock);return 1;}
#endif
  }
  const SnipersFirmwareProfile *profile=snipers_firmware_profile(fw);uint64_t base=KERNEL_ADDRESS_DATA_BASE;
  TacKstuffSnapshot first=tac_kstuff_read(base,profile),second=tac_kstuff_read(base,profile);
  if(!tac_kstuff_snapshot_equal(&first,&second)||!tac_kstuff_injection_ready(base,&second)){free(image);close(lock);notify("TacHen launcher: kernel state is not ready for payload dispatch.");return 1;}
  if(tac_update_write(&state)){free(image);close(lock);notify("TacHen launcher: could not save the launch intent. Nothing launched.");return 1;}
#ifdef TACHEN_BUNDLED_RUNTIME
  char source[65],message[128];tac_update_hex(state.attempt.source_hash,source);
  snprintf(message,sizeof message,"TacHen loading bundled build %.12s",source);notify(message);
#endif
  int pid=elfldr_spawn("/data/tachen",-1,image+sizeof(TacUpdateHeader),"TacHen",size-sizeof(TacUpdateHeader));free(image);
  if(pid<=0){close(lock);notify("TacHen launch was not confirmed. Restart before trying again.");return 1;}
  state.pid=pid;int saved=tac_update_write(&state);close(lock);
  if(saved){notify("TacHen launched, but its update receipt could not be saved. Update confirmation is held.");return 1;}
  if(state.attempt_kind==TAC_BOOT_ROLLBACK)notify("TacHen recovered to a previous build. Review Updates on your phone.");
  return 0;
}
