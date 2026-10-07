// SPDX-License-Identifier: GPL-3.0-or-later
#include "deck-core.h"
#include <string.h>
static int text_valid(const char* text,size_t n){
 const unsigned char* p=(const unsigned char*)text;size_t i=0;
 while(i<n&&p[i]){
  unsigned c=p[i++],need=0,cp;
  if(c<32||c==127)return 0;
  if(c<128)continue;
  if(c>=0xc2&&c<=0xdf){need=1;cp=c&31;}
  else if(c>=0xe0&&c<=0xef){need=2;cp=c&15;}
  else if(c>=0xf0&&c<=0xf4){need=3;cp=c&7;}else return 0;
  if(i+need>=n)return 0;
  for(unsigned j=0;j<need;j++){unsigned b=p[i++];if((b&0xc0)!=0x80)return 0;cp=(cp<<6)|(b&63);}
  if((need==1&&cp<0x80)||(need==2&&cp<0x800)||(need==3&&cp<0x10000)||
     (cp>=0xd800&&cp<=0xdfff)||cp>0x10ffff)return 0;
 }
 return i<n;
}
int tac_deck_decode(const void* bytes,size_t length,TacDeckFrame* out){
 if(!bytes||!out||length!=sizeof(*out))return 0;
 TacDeckFrame f;memcpy(&f,bytes,sizeof f);
 if(f.magic!=TAC_DECK_MAGIC||f.version!=5||(f.flags&~7u)||!f.sequence||f.page>=6||f.count>8||!f.metricsSequence||!text_valid(f.metrics,sizeof f.metrics)||
   !text_valid(f.title,sizeof f.title)||!text_valid(f.subtitle,sizeof f.subtitle)||
   !text_valid(f.footer,sizeof f.footer)||!text_valid(f.ip,sizeof f.ip))return 0;
 if(!f.notice.sequence||f.notice.kind>2||f.notice.remainingMs>9000||f.notice.count>999||
    !text_valid(f.notice.title,sizeof f.notice.title)||!text_valid(f.notice.detail,sizeof f.notice.detail)||
    (!f.notice.kind&&(f.notice.remainingMs||f.notice.count||f.notice.title[0]||f.notice.detail[0]))||
    (f.notice.kind&&(!f.notice.remainingMs||!f.notice.count||!f.notice.title[0])))return 0;
 for(unsigned i=0;i<f.count;i++){
  const TacDeckRow* row=&f.rows[i];
  for(unsigned j=0;j<32;j++)if(!((row->token[j]>='0'&&row->token[j]<='9')||(row->token[j]>='a'&&row->token[j]<='f')))return 0;
  if((row->flags&~3u)||!text_valid(row->label,sizeof row->label)||!text_valid(row->detail,sizeof row->detail))return 0;
 }
 if(f.reserved||f.input.reserved||f.input.active>2||f.input.captured>1||f.input.count>128||f.input.connection>255||
  (f.input.active==1&&(!f.input.epoch||!f.input.deadline))||
  (f.input.captured&&(f.input.active!=1||f.input.owner<0||!f.input.captureAt||f.input.captureAt>=f.input.deadline))||
  (f.input.count&&(!f.input.serial||f.input.active!=1)))return 0;
 for(unsigned i=0;i<f.input.count;i++)if(f.input.events[i].handle<0||f.input.events[i].connection>255||!f.input.events[i].at)return 0;
 *out=f;return 1;
}
void tac_deck_init(TacDeck* d){memset(d,0,sizeof(*d));}
int tac_deck_receive(TacDeck* d,const void* bytes,size_t length,uint64_t now){
 TacDeckFrame f;if(!tac_deck_decode(bytes,length,&f))return 0;
 if(d->valid&&(int32_t)(f.sequence-d->frame.sequence)<0)return 0;
 if(d->valid&&f.sequence==d->frame.sequence&&memcmp(&f,&d->frame,offsetof(TacDeckFrame,metricsSequence)))return 0;
 if(d->valid&&((int32_t)(f.metricsSequence-d->frame.metricsSequence)<0||
    (f.metricsSequence==d->frame.metricsSequence&&memcmp(f.metrics,d->frame.metrics,sizeof f.metrics))))return 0;
 if(d->frame.notice.sequence){
  if((int32_t)(f.notice.sequence-d->frame.notice.sequence)<0)return 0;
  if(f.notice.sequence==d->frame.notice.sequence&&memcmp(&f.notice.kind,&d->frame.notice.kind,sizeof(f.notice)-offsetof(TacDeckNotice,kind)))return 0;
 }
 uint64_t expires=now+f.notice.remainingMs;if(expires<now)return 0;
 if(f.notice.sequence!=d->frame.notice.sequence)d->noticeDeadline=expires;
 else if(expires<d->noticeDeadline)d->noticeDeadline=expires;
 if(!d->valid||f.page!=d->frame.page||strcmp(f.title,d->frame.title))d->selected=0;
 if(d->selected>=f.count)d->selected=f.count?f.count-1:0;
 d->frame=f;d->received=now;d->valid=1;return 1;
}
void tac_deck_tick(TacDeck* d,uint64_t now){
 if(d->valid&&(now<d->received||now-d->received>TAC_DECK_STALE_MS||!(d->frame.flags&1))){
  if(d->open)d->drain[d->owner]=1;d->open=0;d->valid=0;
 }
}
uint32_t tac_deck_notice_remaining(const TacDeck* d,uint64_t now){
 if(!d->valid||!(d->frame.flags&1)||!d->frame.notice.kind||now<d->received||now-d->received>TAC_DECK_STALE_MS||now>=d->noticeDeadline)return 0;
 uint64_t remaining=d->noticeDeadline-now;return (uint32_t)(remaining>9000?9000:remaining);
}
void tac_deck_present(TacDeck* d,uint32_t sequence,int open,unsigned selected){
 if(!d->valid||sequence!=d->frame.sequence)return;
 d->presentedSequence=sequence;d->presentedOpen=!!open;d->presentedSelected=(uint8_t)selected;
}
static void action(TacDeck* d,unsigned kind){
 if(d->pending)return;
 if(++d->serial==0){d->valid=0;d->open=0;return;} // no request ID reuse
 d->event=(TacDeckEvent){kind,d->frame.sequence,d->selected,d->serial};d->pending=1;
}
int tac_deck_input_at(TacDeck* d,unsigned device,uint32_t buttons,uint64_t now,uint64_t receivedNow){
 if(device>=8||now>receivedNow||receivedNow-now>400)return 0;tac_deck_tick(d,receivedNow);
 uint32_t pressed=buttons&~d->previous[device];d->previous[device]=buttons;
 const uint32_t chord=TAC_L3|TAC_R3;
 if((buttons&chord)!=chord){d->chordActive[device]=0;d->chordLatched[device]=0;}
 else if(!d->chordLatched[device]&&(!d->open||d->owner==device)){
  if(!d->chordActive[device]){d->chordActive[device]=1;d->chordAt[device]=now;}
  if(now>=d->chordAt[device]&&now-d->chordAt[device]>=350){
   d->chordLatched[device]=1;
   if(d->valid){d->open=!d->open;d->owner=device;d->drain[device]=1;d->repeatDirection=0;}
  }
 }
 if(d->drain[device]){if(!buttons)d->drain[device]=0;return 1;}
 if(!d->open)return 0;if(d->owner!=device)return 1;
 // The worker may receive a replacement frame between two render ticks.
 // Never activate a row whose text/highlight the user has not actually seen.
 if(d->presentedSequence!=d->frame.sequence||!d->presentedOpen||d->presentedSelected!=d->selected)return 1;
 if(pressed&TAC_CIRCLE){
  if(d->frame.page==0&&!(d->frame.flags&4)&&!d->pending){d->open=0;d->drain[device]=1;}
  else action(d,TAC_DECK_BACK);return 1;
 }
 if(d->pending)return 1;
 if(pressed&TAC_R1)action(d,TAC_DECK_NEXT);
 else if(pressed&TAC_L1)action(d,TAC_DECK_PREVIOUS);
 else if(pressed&TAC_CROSS){if(d->frame.count&&(d->frame.rows[d->selected].flags&1))action(d,TAC_DECK_SELECT);}
 else {
  unsigned direction=buttons&(TAC_UP|TAC_DOWN);
  if(direction==TAC_UP||direction==TAC_DOWN){
   if(direction!=d->repeatDirection||now>=d->repeatAt){
    if(d->frame.count)d->selected=(d->selected+(direction==TAC_DOWN?1:d->frame.count-1))%d->frame.count;
    d->repeatAt=now+(direction!=d->repeatDirection?350:120);
   }
  }
  d->repeatDirection=direction;
 }
 return 1;
}
int tac_deck_input(TacDeck* d,unsigned device,uint32_t buttons,uint64_t now){return tac_deck_input_at(d,device,buttons,now,now);}
int tac_deck_event(const TacDeck* d,TacDeckEvent* event){if(!d->pending)return 0;*event=d->event;return 1;}
void tac_deck_ack(TacDeck* d,uint32_t serial){if(d->pending&&d->event.serial==serial)d->pending=0;}
