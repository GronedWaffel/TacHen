// SPDX-License-Identifier: GPL-3.0-or-later
#include "deck-layout.h"
#include <string.h>
#include <stdio.h>
const int tac_deck_font_sizes[TAC_DECK_STYLES]={44,32,26,21,17};
const float tac_deck_ink[TAC_DECK_STYLES][4]={
 {0.36f,1.0f,0.77f,1},{0.95f,0.97f,1,1},{0.67f,0.74f,0.79f,1},
 {0.47f,0.54f,0.60f,1},{1,0.76f,0.38f,1}
};
const float tac_deck_background[TAC_DECK_BACKGROUNDS][4]={
 {0.015f,0.025f,0.035f,0.78f}, // game dimmer
 {0.035f,0.055f,0.075f,0.98f}, // deck body
 {0.025f,0.040f,0.055f,1.0f},  // navigation rail
 {0.060f,0.095f,0.115f,1.0f},  // focus card
 {0.080f,0.195f,0.170f,1.0f},  // selection
 {0.36f,1.0f,0.77f,1.0f},     // accent line
 {0.20f,0.29f,0.33f,1.0f}     // quiet divider
};
// Conservative display-cell accounting; CJK/emoji occupy two cells. Native
// UIFont remains responsible for shaping. Input comes from UTF-8 checked frames.
static unsigned glyph(const char* s,unsigned* cells){
 const unsigned char* p=(const unsigned char*)s;unsigned n=1,c=p[0];
 if(c>=0xf0){n=4;c&=7;}else if(c>=0xe0){n=3;c&=15;}else if(c>=0xc0){n=2;c&=31;}
 for(unsigned i=1;i<n;i++)c=(c<<6)|(p[i]&63);
 *cells=(c>=0x1100&&(c<=0x115f||c==0x2329||c==0x232a||
  (c>=0x2e80&&c<=0xa4cf)||(c>=0xac00&&c<=0xd7a3)||(c>=0xf900&&c<=0xfaff)||
  (c>=0xfe10&&c<=0xfe6f)||(c>=0xff01&&c<=0xff60)||(c>=0xffe0&&c<=0xffe6)||c>=0x1f000))?2:1;
 return n;
}
static unsigned cells_left(const char* text){
 unsigned total=0;while(*text){unsigned cells,n=glyph(text,&cells);total+=cells;text+=n;}return total;
}
static void lines(TacDeckLayout* l,unsigned first,unsigned count,unsigned width,const char* input){
 const char* p=input;
 for(unsigned line=0;line<count&&*p;line++){
  while(*p==' ')p++;const char* end=p;const char* space=NULL;unsigned cells=0;
  while(*end){unsigned cell,n=glyph(end,&cell);if(cells+cell>width)break;
   if(*end==' ')space=end;cells+=cell;end+=n;}
  // Prefer word wrapping only when the remaining lines can still hold the
  // received text. Otherwise long words could waste enough space to hide detail.
  if(*end&&line+1<count&&space&&space>p&&cells_left(space)<=width*(count-line-1))end=space;
  size_t length=(size_t)(end-p);while(length&&p[length-1]==' ')length--;
  if(*end&&line+1==count){
   // Leave room for the ellipsis without splitting a code point.
   const char* cut=p;unsigned used=0;
   while(cut<p+length){unsigned cell,n=glyph(cut,&cell);if(used+cell>width-3)break;used+=cell;cut+=n;}
   length=(size_t)(cut-p);memcpy(l->labels[first+line].text,p,length);
   memcpy(l->labels[first+line].text+length,"...",4);
  }else{memcpy(l->labels[first+line].text,p,length);l->labels[first+line].text[length]=0;}
  p=end;
 }
}
static void place(TacDeckLayout* l,unsigned index,float x,float y,unsigned font,unsigned ink){
 l->labels[index].x=x;l->labels[index].y=y;l->labels[index].font=font;l->labels[index].ink=ink;
}
static void panel(TacDeckLayout* l,unsigned index,float x,float y,float width,float height,unsigned ink,int visible){
 l->panels[index]=(TacDeckPanel){x,y,width,height,ink,!!visible};
}
void tac_deck_layout(const TacDeckFrame* f,int open,unsigned selected,TacDeckLayout* l){
 memset(l,0,sizeof *l);
 int menu=open&&(f->flags&1),focus=menu&&selected<f->count&&selected<8;
 unsigned selectedRow=selected<8?selected:0,page=f->page<6?f->page:0;
 panel(l,0,0,0,1920,1080,0,menu);
 panel(l,1,64,52,1792,912,1,menu);
 panel(l,2,64,52,328,912,2,menu);
 panel(l,3,424,205,1380,1,6,menu);
 panel(l,4,1080,250,724,560,3,menu);
 panel(l,5,424,268+selectedRow*66,624,60,4,focus);
 panel(l,6,78,278+page*66,4,40,5,menu);
 panel(l,7,390,80,1,850,6,menu);
 panel(l,8,424,278+selectedRow*66,3,40,5,focus);
 panel(l,9,72,60,1776,112,1,!open&&(f->flags&1)&&f->notice.kind&&f->notice.remainingMs);
 panel(l,10,80,970,1120,44,1,(f->flags&1)&&f->metrics[0]);
 panel(l,11,1400,1004,430,48,1,(f->flags&2)&&f->ip[0]);
 place(l,0,96,78,0,TAC_INK_ACCENT);place(l,1,440,88,1,TAC_INK_TEXT);
 place(l,2,440,146,3,TAC_INK_MUTED);place(l,3,440,178,3,TAC_INK_MUTED);
 place(l,4,96,224,4,TAC_INK_QUIET);
 for(unsigned i=0;i<6;i++)place(l,5+i,96,278+i*66,2,f->page==i?TAC_INK_ACCENT:TAC_INK_MUTED);
 place(l,11,440,224,4,TAC_INK_QUIET);
 for(unsigned i=0;i<8;i++){
  unsigned ink=i<f->count&&(f->rows[i].flags&1)?(i==selected?TAC_INK_ACCENT:TAC_INK_TEXT):TAC_INK_MUTED;
  place(l,12+i,440,278+i*66,2,ink);place(l,20+i,990,284+i*66,4,TAC_INK_ACCENT);
 }
 place(l,28,1110,224,4,TAC_INK_QUIET);
 for(unsigned i=0;i<4;i++)place(l,29+i,1110,278+i*38,2,TAC_INK_TEXT);
 for(unsigned i=0;i<6;i++)place(l,33+i,1110,458+i*32,3,TAC_INK_MUTED);
 place(l,39,1110,724,3,TAC_INK_ACCENT);
 place(l,40,96,934,3,TAC_INK_MUTED);
 place(l,41,1420,1016,3,TAC_INK_ACCENT);
 place(l,42,96,978,3,TAC_INK_TEXT);
 place(l,43,96,76,2,f->notice.kind==2?TAC_INK_ATTENTION:TAC_INK_ACCENT);
 place(l,44,96,122,3,TAC_INK_TEXT);
 if(open&&(f->flags&1)){
  strcpy(l->labels[0].text,"TacHen");
  const char* title=!strncmp(f->title,"TacHen / ",9)?f->title+9:f->title;
  lines(l,1,1,38,title);lines(l,2,2,61,f->subtitle);
  strcpy(l->labels[4].text,"YOUR CONSOLE");
  const char* names[]={"Home","Payloads","Games","Activity","Preferences","Cheats"};
  for(unsigned i=0;i<6;i++)snprintf(l->labels[5+i].text,256,"%s%s",f->page==i?"> ":"  ",names[i]);
  snprintf(l->labels[11].text,256,"ACTIONS  /  %u",f->count);
  for(unsigned i=0;i<f->count&&i<8;i++){
   lines(l,12+i,1,19,f->rows[i].label);
   if(f->rows[i].flags&2)strcpy(l->labels[20+i].text,"ON");
   else if(selected==i)strcpy(l->labels[20+i].text,"<");
  }
  if(selected<f->count&&selected<8){
   const TacDeckRow* row=&f->rows[selected];
   strcpy(l->labels[28].text,"IN FOCUS");lines(l,29,4,25,row->label);lines(l,33,6,32,row->detail);
   strcpy(l->labels[39].text,(row->flags&1)?"X  Select":"Currently unavailable");
   if(!(row->flags&1))l->labels[39].ink=TAC_INK_ATTENTION;
  }else{strcpy(l->labels[28].text,"IN FOCUS");strcpy(l->labels[29].text,"No actions here yet");}
  lines(l,40,1,82,f->footer);
 }
 if(f->flags&1){
  lines(l,42,1,80,f->metrics);
  if(!open&&f->notice.kind&&f->notice.remainingMs){lines(l,43,1,50,f->notice.title);lines(l,44,1,82,f->notice.detail);}
 }
 if(f->flags&2)lines(l,41,1,19,f->ip);
}
