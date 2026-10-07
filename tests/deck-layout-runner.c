// SPDX-License-Identifier: GPL-3.0-or-later
#include "deck-layout.h"
#include <stdio.h>
#include <stdlib.h>
static void quoted(const char* s){
 putchar('"');for(const unsigned char* p=(const unsigned char*)s;*p;p++){
  if(*p=='"'||*p=='\\')putchar('\\');
  if(*p<32)printf("\\u%04x",*p);else putchar(*p);
 }putchar('"');
}
int main(int argc,char** argv){
 if(argc!=4&&argc!=5)return 1;FILE* file=fopen(argv[1],"rb");if(!file)return 2;
 unsigned char bytes[sizeof(TacDeckFrame)];size_t got=fread(bytes,1,sizeof bytes,file);
 int tail=fgetc(file);fclose(file);TacDeckFrame frame;
 if(got!=sizeof bytes||tail!=EOF||!tac_deck_decode(bytes,got,&frame))return 3;
 TacDeckLayout layout;tac_deck_layout(&frame,atoi(argv[2]),(unsigned)strtoul(argv[3],NULL,10),&layout);
 if(argc==5){
  putchar('[');for(unsigned i=0;i<TAC_DECK_PANELS;i++){
   const TacDeckPanel* p=&layout.panels[i];const float* c=tac_deck_background[p->ink];
   printf("%s{\"x\":%.0f,\"y\":%.0f,\"width\":%.0f,\"height\":%.0f,\"visible\":%u,\"color\":[%.3f,%.3f,%.3f,%.3f]}",
    i?",":"",p->x,p->y,p->width,p->height,p->visible,c[0],c[1],c[2],c[3]);
  }puts("]");return 0;
 }
 putchar('[');for(unsigned i=0;i<TAC_DECK_LABELS;i++){
  const TacDeckText* item=&layout.labels[i];const float* color=tac_deck_ink[item->ink];
  printf("%s{\"x\":%.0f,\"y\":%.0f,\"size\":%d,\"ink\":%u,\"color\":[%.3f,%.3f,%.3f,%.3f],\"text\":",i?",":"",item->x,item->y,
   tac_deck_font_sizes[item->font],item->ink,color[0],color[1],color[2],color[3]);quoted(item->text);putchar('}');
 }puts("]");return 0;
}
