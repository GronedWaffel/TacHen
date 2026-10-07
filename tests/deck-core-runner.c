#include "deck-core.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define CHECK(expr) do { if(!(expr)){fprintf(stderr,"line %d: %s\n",__LINE__,#expr);return 1;} }while(0)
int main(int argc,char** argv){
 CHECK(argc==2);FILE* f=fopen(argv[1],"rb");CHECK(f);unsigned char bytes[2801];size_t length=fread(bytes,1,sizeof bytes,f);fclose(f);
 TacDeckFrame frame;CHECK(tac_deck_decode(bytes,length,&frame));CHECK(frame.count==3);CHECK(!strcmp(frame.rows[1].label,"Payload 二"));
 bytes[12]=5;CHECK(tac_deck_decode(bytes,length,&frame));bytes[12]=6;CHECK(!tac_deck_decode(bytes,length,&frame));bytes[12]=0;
 CHECK(!tac_deck_decode(bytes,length-1,&frame));
 bytes[14]=9;CHECK(!tac_deck_decode(bytes,length,&frame));bytes[14]=3;
 unsigned char original=bytes[500];bytes[500]=0xc0;CHECK(!tac_deck_decode(bytes,length,&frame));bytes[500]=original;
 TacDeck d;tac_deck_init(&d);CHECK(tac_deck_receive(&d,bytes,length,0));
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
 tac_deck_tick(&d,3001);CHECK(!d.open&&!d.valid);
 CHECK(tac_deck_input(&d,0,TAC_CROSS,3002));CHECK(tac_deck_input(&d,0,0,3003));CHECK(!tac_deck_input(&d,0,TAC_CROSS,3004));
 CHECK(tac_deck_receive(&d,bytes,length,4000));frame=d.frame;frame.sequence++;CHECK(tac_deck_receive(&d,&frame,sizeof frame,4001));
 CHECK(!tac_deck_receive(&d,bytes,length,4002));frame.title[0]='X';CHECK(!tac_deck_receive(&d,&frame,sizeof frame,4003));
 puts("Native deck wire, controller ownership, hold/repeat, stale release and action acknowledgement checks passed");return 0;
}
