#include "deck-core.h"
#include "deck-route.h"
#include "deck-http.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define CHECK(expr) do { if(!(expr)){fprintf(stderr,"line %d: %s\n",__LINE__,#expr);return 1;} }while(0)
static void feed(TacDeck *d,TacDeckRoute *r,TacDeckInput *input,uint64_t at,uint32_t raw,int handle){
 input->serial++;input->count=1;input->deadline=at+300;input->events[0]=(TacDeckPad){raw,handle,3,input->serial,at};
 d->received=at;tac_deck_route_receive(d,r,input,at);
}
int main(int argc,char** argv){
 CHECK(argc==2);FILE* f=fopen(argv[1],"rb");CHECK(f);unsigned char bytes[sizeof(TacDeckFrame)+1];size_t length=fread(bytes,1,sizeof bytes,f);fclose(f);
 TacDeckFrame frame;CHECK(tac_deck_decode(bytes,length,&frame));CHECK(frame.count==3);CHECK(!strcmp(frame.rows[1].label,"Payload 二"));
 // Focus changes hide game measurements immediately, without hiding IP/notices
 // or mutating the original packet. Equal numeric samples still redraw.
 TacDeckFrame metrics=frame;strcpy(metrics.metrics,"FPS 60");metrics.metricsSequence=41;metrics.flags|=2;strcpy(metrics.ip,"192.168.0.2");
 tac_deck_metrics_focus(&metrics,0);CHECK(!metrics.metrics[0]&&metrics.metricsSequence==82&&(metrics.flags&2)&&metrics.ip[0]);
 metrics=frame;strcpy(metrics.metrics,"FPS 60");metrics.metricsSequence=41;tac_deck_metrics_focus(&metrics,1);CHECK(!strcmp(metrics.metrics,"FPS 60")&&metrics.metricsSequence==83);
 for(int focus=-2;focus<0;focus++){strcpy(metrics.metrics,"FPS 60");tac_deck_metrics_focus(&metrics,focus);CHECK(!metrics.metrics[0]);}
 TacDeckFrame metadata=frame;metadata.dashboard.enabled=1;metadata.dashboard.count=1;metadata.dashboard.epoch=1;
 strcpy(metadata.dashboard.records[0].title,"PPSA00001");strcpy(metadata.dashboard.records[0].version,"01.010.002");
 CHECK(tac_deck_decode(&metadata,sizeof metadata,&metadata));metadata.dashboard.records[0].reserved=1;CHECK(!tac_deck_decode(&metadata,sizeof metadata,&metadata));
 metadata=frame;metadata.dashboard.count=33;CHECK(!tac_deck_decode(&metadata,sizeof metadata,&metadata));
 TacDeckFrame keyboard=frame;keyboard.count=1;keyboard.flags=1|4|128;strcpy(keyboard.rows[0].label,"abcdefghijklmnopqrstuvwxyz0123456789");
 TacDeck kd;tac_deck_init(&kd);CHECK(tac_deck_receive(&kd,&keyboard,sizeof keyboard,0));kd.open=1;
 tac_deck_present(&kd,kd.frame.sequence,1,0);tac_deck_input(&kd,0,TAC_DOWN,1);CHECK(kd.selected==10);
 tac_deck_present(&kd,kd.frame.sequence,1,10);tac_deck_input(&kd,0,0,2);tac_deck_input(&kd,0,TAC_LEFT,3);CHECK(kd.selected==9);
 kd.selected=39;tac_deck_present(&kd,kd.frame.sequence,1,39);tac_deck_input(&kd,0,0,4);tac_deck_input(&kd,0,TAC_CROSS,5);CHECK(kd.pending&&kd.event.row==39);
 keyboard.sequence++;CHECK(tac_deck_receive(&kd,&keyboard,sizeof keyboard,6));CHECK(kd.selected==39);
 keyboard.flags|=32;CHECK(!tac_deck_decode(&keyboard,sizeof keyboard,&keyboard));
 TacDeckFrame legacy=frame;legacy.version=5;CHECK(!tac_deck_decode(&legacy,sizeof legacy,&legacy));
 TacDeckFrame badAccent=frame;badAccent.flags|=24;CHECK(!tac_deck_decode(&badAccent,sizeof badAccent,&badAccent));
 TacDeck nested;tac_deck_init(&nested);TacDeckFrame nestedFrame=frame;nestedFrame.flags|=4;
 CHECK(tac_deck_receive(&nested,&nestedFrame,sizeof nestedFrame,0));nested.open=1;
 tac_deck_present(&nested,nested.frame.sequence,1,0);tac_deck_input(&nested,0,TAC_CIRCLE,1);
 CHECK(nested.open&&nested.pending&&nested.event.kind==TAC_DECK_BACK);
 tac_deck_ack(&nested,nested.event.serial);tac_deck_input(&nested,0,0,2);
 nestedFrame.flags&=~4u;nestedFrame.sequence++;CHECK(tac_deck_receive(&nested,&nestedFrame,sizeof nestedFrame,3));
 tac_deck_present(&nested,nested.frame.sequence,1,0);tac_deck_input(&nested,0,TAC_CIRCLE,4);
 CHECK(!nested.open&&!nested.pending); // Only the Home root closes on Circle.
 TacDeckFrame invalid=frame;invalid.input.active=3;CHECK(!tac_deck_decode(&invalid,sizeof invalid,&invalid));
 invalid=frame;invalid.input.captured=1;CHECK(!tac_deck_decode(&invalid,sizeof invalid,&invalid));
 invalid=frame;invalid.input.count=129;CHECK(!tac_deck_decode(&invalid,sizeof invalid,&invalid));
 bytes[12]=5;CHECK(tac_deck_decode(bytes,length,&frame));bytes[12]=6;CHECK(!tac_deck_decode(bytes,length,&frame));bytes[12]=0;
 CHECK(!tac_deck_decode(bytes,length-1,&frame));
 bytes[14]=9;CHECK(!tac_deck_decode(bytes,length,&frame));bytes[14]=3;
 unsigned char original=bytes[500];bytes[500]=0xc0;CHECK(!tac_deck_decode(bytes,length,&frame));bytes[500]=original;
 TacDeck d;tac_deck_init(&d);CHECK(tac_deck_receive(&d,bytes,length,0));
 // Slow actions keep fresh frames and their original pending identity. The
 // stale-frame fail-safe still closes the overlay when heartbeats actually stop.
 TacDeck busy=d;busy.open=1;busy.pending=1;busy.event.serial=9;
 for(unsigned t=100;t<=10000;t+=100){
  CHECK(tac_deck_http_has_frame(202));CHECK(!tac_deck_http_acknowledges(202));
  CHECK(tac_deck_receive(&busy,bytes,length,t));tac_deck_tick(&busy,t);
  CHECK(busy.open&&busy.pending&&busy.event.serial==9);
 }
 CHECK(tac_deck_http_acknowledges(200));tac_deck_ack(&busy,9);CHECK(!busy.pending&&busy.open);
 tac_deck_tick(&busy,10000+TAC_DECK_STALE_MS+1);CHECK(busy.open&&busy.valid&&tac_deck_stalled(&busy,13001));
 busy.selected=1;tac_deck_present(&busy,busy.frame.sequence,1,1);
 tac_deck_input(&busy,0,TAC_CROSS,13002);CHECK(!busy.pending); // no stale install submission
 tac_deck_input(&busy,0,TAC_DOWN,13003);CHECK(busy.selected==1);
 CHECK(tac_deck_receive(&busy,bytes,length,14000));CHECK(busy.open&&busy.selected==1&&!tac_deck_stalled(&busy,14000));
 busy.pending=1;busy.event.serial=10;
 tac_deck_input(&busy,0,TAC_CIRCLE,18000);CHECK(!busy.open&&busy.pending&&busy.event.serial==10); // local exit, receipt still pending
 CHECK(tac_deck_receive(&busy,bytes,length,18001));CHECK(!busy.open); // reconnect never reopens after user exit
 busy.open=1;tac_deck_tick(&busy,18001+TAC_DECK_DISCONNECTED_MS+1);CHECK(!busy.open&&!busy.valid);
 CHECK(!tac_deck_input(&d,0,TAC_CROSS,1));CHECK(!d.open);tac_deck_input(&d,0,0,2);
 CHECK(!tac_deck_input(&d,0,TAC_L3|TAC_R3,10));CHECK(tac_deck_input(&d,0,TAC_L3|TAC_R3,360));CHECK(d.open);
 for(unsigned t=361;t<700;t++)tac_deck_input(&d,0,TAC_L3|TAC_R3,t);CHECK(d.open);
 tac_deck_input(&d,0,0,700);CHECK(tac_deck_input(&d,1,TAC_CROSS,701));CHECK(!d.pending);
 tac_deck_input(&d,0,TAC_CROSS,702);CHECK(!d.pending);tac_deck_input(&d,0,0,703);
 tac_deck_present(&d,d.frame.sequence,1,d.selected);
 tac_deck_input(&d,0,TAC_DOWN,710);CHECK(d.selected==1);
 tac_deck_present(&d,d.frame.sequence,1,d.selected);
 tac_deck_input(&d,0,TAC_DOWN,800);CHECK(d.selected==1);
 tac_deck_input(&d,0,TAC_DOWN,1060);CHECK(d.selected==2);
 tac_deck_present(&d,d.frame.sequence,1,d.selected);
 tac_deck_input(&d,0,0,1061);tac_deck_input(&d,0,TAC_CROSS,1062);CHECK(d.pending);
 TacDeckEvent e;CHECK(tac_deck_event(&d,&e));CHECK(e.kind==TAC_DECK_SELECT&&e.row==2&&e.serial==1);
 tac_deck_input(&d,0,0,1063);tac_deck_input(&d,0,TAC_CROSS,1064);CHECK(d.serial==1);
 tac_deck_ack(&d,99);CHECK(d.pending);tac_deck_ack(&d,1);CHECK(!d.pending);
 tac_deck_input(&d,0,TAC_CROSS,1065);CHECK(!d.pending); // held X never repeats
 tac_deck_input(&d,0,0,1066);tac_deck_input(&d,0,TAC_R1,1067);CHECK(d.event.kind==TAC_DECK_NEXT);
 tac_deck_tick(&d,3001);CHECK(d.open&&d.valid&&tac_deck_stalled(&d,3001));
 // Disabling a frame still immediately releases controls, even during grace.
 d.frame.flags&=~1u;tac_deck_tick(&d,3001);CHECK(!d.open&&!d.valid);
 CHECK(tac_deck_input(&d,0,TAC_CROSS,3002));CHECK(tac_deck_input(&d,0,0,3003));CHECK(!tac_deck_input(&d,0,TAC_CROSS,3004));
 CHECK(tac_deck_receive(&d,bytes,length,4000));frame=d.frame;frame.sequence++;CHECK(tac_deck_receive(&d,&frame,sizeof frame,4001));
 CHECK(!tac_deck_receive(&d,bytes,length,4002));frame.title[0]='X';CHECK(!tac_deck_receive(&d,&frame,sizeof frame,4003));
 frame=d.frame;frame.metricsSequence++;strcpy(frame.metrics,"FPS 60");
 CHECK(tac_deck_receive(&d,&frame,sizeof frame,4004));CHECK(d.frame.sequence==frame.sequence);
 frame.metrics[4]='3';CHECK(!tac_deck_receive(&d,&frame,sizeof frame,4005));
 frame.metricsSequence++;CHECK(tac_deck_receive(&d,&frame,sizeof frame,4006));
 frame.metricsSequence-=2;CHECK(!tac_deck_receive(&d,&frame,sizeof frame,4007));
 frame=d.frame;memset(frame.metrics,'x',sizeof frame.metrics);CHECK(!tac_deck_decode(&frame,sizeof frame,&frame));
 frame=d.frame;frame.notice.sequence++;frame.notice.kind=2;frame.notice.count=1;frame.notice.remainingMs=9000;
 strcpy(frame.notice.title,"Work needs attention");strcpy(frame.notice.detail,"Review Activity");uint32_t menuSequence=d.frame.sequence;
 CHECK(tac_deck_receive(&d,&frame,sizeof frame,4100));CHECK(d.frame.sequence==menuSequence);CHECK(d.noticeDeadline==13100);
 CHECK(tac_deck_receive(&d,&frame,sizeof frame,4200));CHECK(d.noticeDeadline==13100); // Same message cannot renew its lifetime.
 frame.notice.detail[0]='X';CHECK(!tac_deck_receive(&d,&frame,sizeof frame,4201));frame=d.frame;
 frame.notice.remainingMs=9001;CHECK(!tac_deck_decode(&frame,sizeof frame,&invalid));frame=d.frame;
 frame.notice.sequence--;CHECK(!tac_deck_receive(&d,&frame,sizeof frame,4202));frame=d.frame;
 frame.notice.remainingMs=1;CHECK(tac_deck_receive(&d,&frame,sizeof frame,4300));CHECK(tac_deck_notice_remaining(&d,4300)==1);
 CHECK(!tac_deck_notice_remaining(&d,4302));frame.notice.remainingMs=9000;
 CHECK(tac_deck_receive(&d,&frame,sizeof frame,4303));CHECK(!tac_deck_notice_remaining(&d,4303));
 tac_deck_tick(&d,8000);CHECK(!d.valid);CHECK(tac_deck_receive(&d,&frame,sizeof frame,8001));CHECK(!tac_deck_notice_remaining(&d,8001));
 tac_deck_init(&d);CHECK(tac_deck_receive(&d,bytes,length,1000));TacDeckRoute route={0};
 TacDeckInput input={.epoch=3,.active=1,.owner=-1};
 feed(&d,&route,&input,1000,6,17);feed(&d,&route,&input,1200,6,17);feed(&d,&route,&input,1360,6,17);
 CHECK(d.open&&!tac_deck_route_visible(&d,&route)&&!d.pending);
 TacDeckFeedback feedback=tac_deck_route_feedback(&d,&route,1,1360);CHECK(feedback.open&&feedback.owner==17&&feedback.connection==3);
 feed(&d,&route,&input,1370,0x4000,17);CHECK(!d.pending);
 input.captured=1;input.captureAt=1390;input.owner=17;input.connection=3;
 feed(&d,&route,&input,1380,0x4000,17);CHECK(!d.pending); // Event was collected before capture was granted.
 feed(&d,&route,&input,1400,0,17);CHECK(tac_deck_route_visible(&d,&route));tac_deck_present(&d,d.frame.sequence,1,d.selected);
 feed(&d,&route,&input,1410,0x4000,18);CHECK(!d.pending); // Another player never controls the owned menu.
 feed(&d,&route,&input,1420,0x4000,17);CHECK(d.pending&&d.event.kind==TAC_DECK_SELECT);tac_deck_ack(&d,d.event.serial);
 feed(&d,&route,&input,1430,0,17);feed(&d,&route,&input,1440,0x2000,17);CHECK(!d.open);
 uint32_t oldSerial=route.serial;tac_deck_route_receive(&d,&route,&input,1441);CHECK(route.serial==oldSerial&&!d.open);
 tac_deck_route_tick(&d,&route,1800);CHECK(route.active==2&&!d.open);
 input.epoch++;input.captured=0;input.captureAt=0;feed(&d,&route,&input,1900,6,17);feed(&d,&route,&input,2250,6,17);CHECK(d.open);
 input.serial++;input.events[0].connection=4;input.events[0].at=2251;input.deadline=2500;
 tac_deck_route_receive(&d,&route,&input,2251);CHECK(!d.open); // Reconnected handle cannot inherit ownership.
 input.serial++;input.events[0].at=1900;tac_deck_route_receive(&d,&route,&input,2252);CHECK(route.active==2);
 input.active=0;input.count=0;input.captured=0;tac_deck_route_receive(&d,&route,&input,2253);CHECK(!route.active&&!d.open);
 // A failed/uncertain game bridge must not disable a verified dashboard.
 tac_deck_init(&d);CHECK(tac_deck_receive(&d,bytes,length,3000));memset(&route,0,sizeof route);
 input=(TacDeckInput){.epoch=10,.active=2,.captured=1,.count=1,.serial=8,.deadline=4000};
 tac_deck_route_focus(&input,0);CHECK(!input.active&&!input.count&&!input.captured&&!input.deadline&&!input.serial);
 tac_deck_route_receive(&d,&route,&input,3000);
 tac_deck_input(&d,0,TAC_L3|TAC_R3,3000);
 input.epoch++;tac_deck_route_receive(&d,&route,&input,3200);
 tac_deck_input(&d,0,TAC_L3|TAC_R3,3350);CHECK(d.open&&tac_deck_route_visible(&d,&route));
 input.epoch++;tac_deck_route_receive(&d,&route,&input,3351);CHECK(d.open);
 feedback=tac_deck_route_feedback(&d,&route,1,3351);CHECK(!feedback.open&&feedback.owner==-1&&feedback.menuOpen);
 // A foreground game cannot inherit dashboard navigation without capture.
 tac_deck_route_focus(&input,1);CHECK(input.active==2);
 tac_deck_route_receive(&d,&route,&input,3352);CHECK(!d.open&&!tac_deck_route_visible(&d,&route));
 CHECK(!tac_deck_route_feedback(&d,&route,1,3352).menuOpen);
 input=(TacDeckInput){.active=1,.captured=1,.count=1,.serial=9,.deadline=4000};
 tac_deck_route_focus(&input,1);CHECK(input.active==1&&input.captured&&input.count==1&&input.serial==9);
 tac_deck_route_focus(&input,-1);CHECK(input.active==2&&!input.captured&&!input.count);
 input.active=0;tac_deck_route_focus(&input,-2);CHECK(input.active==0);
 input.active=1;tac_deck_route_focus(&input,-2);CHECK(input.active==1);
 // Home tiles use four columns; horizontal motion stays local and vertical
 // motion reaches the same column in the other row without dispatching jobs.
 tac_deck_init(&d);frame.flags=1|32;frame.count=8;frame.sequence++;frame.page=0;
 for(unsigned i=3;i<8;i++)frame.rows[i]=frame.rows[0];
 CHECK(tac_deck_receive(&d,&frame,sizeof frame,6000));d.open=1;
 tac_deck_present(&d,d.frame.sequence,1,0);tac_deck_input(&d,0,TAC_RIGHT,6001);CHECK(d.selected==1&&!d.pending);
 tac_deck_input(&d,0,0,6002);tac_deck_present(&d,d.frame.sequence,1,1);
 tac_deck_input(&d,0,TAC_DOWN,6003);CHECK(d.selected==5&&!d.pending);
 tac_deck_input(&d,0,0,6004);tac_deck_present(&d,d.frame.sequence,1,5);
 tac_deck_input(&d,0,TAC_LEFT,6005);CHECK(d.selected==4);
 // Browser: two independent columns and a horizontal action bar, with no tab jumps.
 frame.flags=1|4|256;frame.count=8;frame.sequence++;strcpy(frame.title,"File browser");
 for(unsigned i=0;i<24;i++){strcpy(frame.browser.entries[i].label,"file");frame.browser.entries[i].flags=1;}
 tac_deck_init(&d);CHECK(tac_deck_receive(&d,&frame,sizeof frame,7000));d.open=1;
 tac_deck_present(&d,d.frame.sequence,1,0);tac_deck_input(&d,0,TAC_R1,7001);CHECK(d.selected==12&&!d.pending&&d.browserPane==1);
 tac_deck_input(&d,0,0,7002);tac_deck_present(&d,d.frame.sequence,1,12);tac_deck_input(&d,0,TAC_UP,7003);CHECK(d.selected==28);
 tac_deck_input(&d,0,0,7004);tac_deck_present(&d,d.frame.sequence,1,28);tac_deck_input(&d,0,TAC_CROSS,7005);CHECK(d.pending&&d.event.row==60);
 uint32_t pendingRow=d.event.row;tac_deck_input(&d,0,TAC_CIRCLE,7006);CHECK(d.event.row==pendingRow);
 tac_deck_ack(&d,d.event.serial);tac_deck_input(&d,0,0,7007);tac_deck_input(&d,0,TAC_LEFT,7008);CHECK(d.selected==27);
 TacDeckFrame malformed=frame;malformed.browser.entries[0].flags=8;CHECK(!tac_deck_decode(&malformed,sizeof malformed,&malformed));
 malformed=frame;malformed.flags|=128;CHECK(!tac_deck_decode(&malformed,sizeof malformed,&malformed));
 malformed=frame;strcpy(malformed.browser.paths[0],"changed without sequence");CHECK(!tac_deck_receive(&d,&malformed,sizeof malformed,7010));
 puts("Native deck wire, controller ownership, browser navigation, hold/repeat, stale release and action acknowledgement checks passed");return 0;
}
