#include "../platform/deck/cheats-window.c"
#include <assert.h>
#define P(x) ((void*)(uintptr_t)(x))
typedef struct{int n;uint16_t t[128];} S;
static S str(const char*s){S v={.n=(int)strlen(s)};for(int i=0;i<v.n;i++)v.t[i]=s[i];return v;}
static int length(void*p){return ((S*)p)->n;}static const uint16_t*chars(void*p){return ((S*)p)->t;}
static int originals,unloads,freed,httpStatus=200;static unsigned requestedSerial,deliveredSerial;static TacDeckFrame response;
static uint8_t nativeActive;
static void*unbox(void*p){return p;}
static void*invoke(void*f,void*o,void**a,void**e){(void)a;*e=NULL;if(f==P(2))return &nativeActive;assert(f==P(1));return o;}
static void original(void*a,void*b,void*c){(void)a;(void)b;(void)c;originals++;}
static void unload(void*a){(void)a;unloads++;}
static void*target(uint32_t h){return P(h);}static void unpin(uint32_t h){assert(h);freed++;}
int kernel_dynlib_handle(int p,const char*n,uint32_t*h){(void)p;(void)n;(void)h;return -1;}
uintptr_t kernel_dynlib_dlsym(int p,uint32_t h,const char*n){(void)p;(void)h;(void)n;return 0;}
void tac_dashboard_feedback(TacDeckFeedback*f){f->dashboardSerial=requestedSerial;strcpy(f->dashboardTitle,"PPSA00001");}
int tac_dashboard_ack(uint32_t s){assert(s);return 1;}
int tac_cheats_http(uint16_t p,const char*c,const TacDeckEvent*e,const TacDeckFeedback*f,TacDeckFrame*out){(void)c;(void)e;assert(p==8780);deliveredSerial=f->dashboardSerial;*out=response;return httpStatus;}
int main(void){
 TacDeckFrame f={.sequence=9,.count=2};strcpy(f.subtitle,"A & B <game>");strcpy(f.rows[0].label,"\"Cheat\" <tag>");strcpy(f.rows[0].detail,"a'b & c");f.rows[0].flags=3;strcpy(f.rows[1].label,"Unavailable");
 memset(f.rows[0].token,'a',32);memset(f.rows[1].token,'b',32);
 char out[4096];assert(make_xml(&f,out,sizeof out));assert(strstr(out,"A &amp; B &lt;game&gt;"));assert(strstr(out,"&quot;Cheat&quot; &lt;tag&gt;"));assert(strstr(out,"a&apos;b &amp; c"));assert(strstr(out,"<button id=\"tachen.cheat.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\""));assert(strstr(out,"<label id=\"tachen.cheat.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\""));assert(!make_xml(&f,out,20));
 TacMono api={.mono_string_length=length,.mono_string_chars=chars,.mono_runtime_invoke=invoke,.mono_object_unbox=unbox,.mono_gchandle_get_target=target,.mono_gchandle_free=unpin};m=&api;getId=P(1);pressOriginal=original;unloadOriginal=unload;active=1;shown=f;
 S other=str("normal.setting");press(NULL,&other,NULL);assert(originals==1&&!actionPending);
 S stale=str("tachen.cheat.cccccccccccccccccccccccccccccccc");press(NULL,&stale,NULL);assert(!actionPending&&originals==1);
 S disabled=str("tachen.cheat.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");press(NULL,&disabled,NULL);assert(!actionPending);
 S valid=str("tachen.cheat.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");press(NULL,&valid,NULL);assert(actionPending&&action.row==0&&action.sequence==9);unsigned first=action.serial;press(NULL,&valid,NULL);assert(action.serial==first);
 installed=1;requestSerial=1;requestedSerial=2;httpStatus=-1;tac_cheats_poll("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");assert(actionPending&&action.serial==first&&deliveredSerial==0);
 httpStatus=200;response=f;tac_cheats_poll("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");assert(!actionPending&&deliveredSerial==0);
 // Sequence/telemetry changes leave the native page and highlight untouched.
 response=f;response.sequence=10;response.metricsSequence=99;
 requestedSerial=0;refresh=0;tac_cheats_poll("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
 assert(shown.sequence==10&&!refresh&&same_page(&f,&shown));
 press(NULL,&valid,NULL);assert(actionPending&&action.sequence==10);httpStatus=409;
 tac_cheats_poll("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");assert(!actionPending);
 // Real content changes preserve the CURRENT focused row, even when rows move.
 TacDeckFrame before=f,after=f;before.rows[1].flags=1;after=before;
 strcpy(after.rows[0].detail,"Changed status");assert(!same_page(&before,&after));
 after.rows[0]=before.rows[1];after.rows[1]=before.rows[0];
 assert(focus_row(&before,&after,"tachen.cheat.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")==0);
 // Removed/disabled focus falls to a selectable row, never a status label.
 after.rows[0].flags=0;assert(focus_row(&before,&after,"tachen.cheat.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")==1);
 after.rows[1].flags=0;assert(focus_row(&before,&after,"tachen.cheat.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")==2);
 // Superseded action tokens cannot activate another row at the same index.
 shown=f;memset(shown.rows[0].token,'d',32);press(NULL,&valid,NULL);assert(!actionPending);
 appRoot=10;managerRoot=11;unloaded(P(12));assert(active&&freed==0&&unloads==1);unloaded(P(10));assert(!active&&freed==2&&unloads==2&&!appRoot&&!managerRoot);
 // Actual UIManager closure must release the chord even when ShellUI skips
 // our application unload callback. An initially pending transition is allowed.
 active=1;appRoot=10;managerRoot=11;getActive=P(2);nativeActive=0;managerSeen=0;managerDeadline=now()+10000;checkAt=0;refresh=0;
 tac_cheats_tick();assert(active&&freed==2);
 nativeActive=1;checkAt=0;tac_cheats_tick();assert(active&&managerSeen&&freed==2);
 nativeActive=0;checkAt=0;tac_cheats_tick();assert(!tac_cheats_active()&&!appRoot&&!managerRoot&&freed==4);
 puts("Native cheats: escaped XML, disabled/stale row isolation, retry identity, independent native close passed");return 0;
}
