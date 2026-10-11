// Exercises production callbacks with managed-object fixtures, not a console ABI emulator.
#include "../platform/deck/dashboard.c"
#include <assert.h>
#define PTR(x) ((void*)(uintptr_t)(x))
typedef struct{int length;uint16_t text[128];} Str;
typedef struct{void*type;Str*title,*name;void*array;} Obj;
static Str strings[100];static unsigned allocated,rootsUsed,handlesUsed,created,resolved,passed,originalCalled;static void* handles[1000];
static Str* str(const char*s){Str*r=&strings[allocated++];r->length=(int)strlen(s);for(int i=0;i<r->length;i++)r->text[i]=(unsigned char)s[i];return r;}
static int len(void*s){return ((Str*)s)->length;}static const uint16_t* chars(void*s){return ((Str*)s)->text;}
static uint32_t pin(void*p,int pinned){assert(pinned);handles[++handlesUsed]=p;rootsUsed++;return handlesUsed;}
static void unpin(uint32_t h){assert(handles[h]);handles[h]=NULL;rootsUsed--;}
static void* target(uint32_t h){return handles[h];}static void* type(void*p){return ((Obj*)p)->type;}
static void* field(void*d,void*f,void*p){(void)d;return f==PTR(1)?(void*)((Obj*)p)->title:((Obj*)p)->array;}
static void* newstr(void*d,const char*s){(void)d;return str(s);}
static int registry(long key,int*value){(void)key;originalCalled++;if(value)*value=77;return -78;}
int kernel_dynlib_handle(int p,const char*n,uint32_t*h){(void)p;(void)n;*h=1;return 0;}
uintptr_t kernel_dynlib_dlsym(int p,uint32_t h,const char*n){(void)p;(void)h;(void)n;return 1;}
static void* newobj(void*d,void*c){(void)d;assert(c==PTR(40));return PTR(41);}
static void json(void*object,void*array,void*id,void*label,void*url,void*action,void*message,void*submenu,uint8_t enable){
 char text[96];(void)object;assert(array==PTR(50));assert(ascii(id,text,sizeof text));
 if(strcmp(text,"tachen.cheats")){originalCalled++;return;}
 assert(ascii(label,text,sizeof text)&&!strcmp(text,"TacHen Cheats"));
 assert(ascii(url,text,sizeof text)&&!strcmp(text,"tachen://cheats/PPSA00001"));
 assert(!action&&!message&&!submenu&&enable==1);created++;
}
static char displayed[96];
static void display(void*object,void*text){assert(object);assert(ascii(text,displayed,sizeof displayed));}
static int url(void*a,void*b,void*c){(void)a;(void)b;(void)c;passed++;return 0;}
static void* methods(void*c,void**i){if(c==PTR(30)&&!*i){*i=PTR(1);return PTR(3);}return NULL;}
static void* parent(void*c){(void)c;return NULL;}static const char* methodname(void*f){(void)f;return "Resolve";}
static uint32_t flags(void*f,uint32_t*x){(void)f;(void)x;return 0;}static void* sig(void*f){return f;}
static uint32_t count(void*f){(void)f;return 1;}static void* ret(void*f){(void)f;return PTR(1);}
static void* param(void*f,void**i){(void)f;(void)i;return PTR(0x1c);}static int typenum(void*t){return (int)(uintptr_t)t;}
static void* call(void*f,void*object,void**args,void**ex){
 *ex=NULL;
 if(f==PTR(1)){assert(object==PTR(41)&&*(uint8_t*)args[0]==1);return NULL;}
 assert(f==PTR(3)&&!args[0]);resolved++;return NULL;
}
int main(void){
 TacMono api={.mono_gchandle_new=pin,.mono_gchandle_free=unpin,.mono_gchandle_get_target=target,.mono_object_get_class=type,
 .mono_object_new=newobj,.mono_field_get_value_object=field,.mono_string_new=newstr,.mono_runtime_invoke=call,.mono_class_get_methods=methods,.mono_class_get_parent=parent,
 .mono_method_get_name=methodname,.mono_method_get_flags=flags,.mono_method_signature=sig,.mono_signature_get_param_count=count,
 .mono_signature_get_return_type=ret,.mono_signature_get_params=param,.mono_type_get_type=typenum};
 TacDeckBoot evidence={0};tac_dashboard_bind(&evidence);m=&api;string_length=len;string_chars=chars;createJson=PTR(2);
 void*trampolines[]={registry,json,url};tac_dashboard_originals(trampolines);
 Obj game={0};int value=0;
 assert(read_registry(0x7802c916L,&value)==-78&&value==77);
 TacDashboardFrame frame={.enabled=1,.epoch=1};tac_dashboard_receive(&frame);
 assert(read_registry(0x7802c916L,&value)==0&&value==1&&rootsUsed==0);
 assert(read_registry(42,&value)==-78&&value==77);
 assert(read_registry(0x7802c916L,NULL)==-78);
 frame.enabled=0;tac_dashboard_receive(&frame);assert(read_registry(0x7802c916L,&value)==-78&&value==77);
 add_json(PTR(0xdeadbeef),PTR(50),str("MENU_ID_CHECK_PATCH"),NULL,str("pspatchcheck:check-for-update?titleid=PPSA00001"),NULL,NULL,NULL,1);assert(created==1&&rootsUsed==0);add_json(NULL,PTR(50),str("MENU_ID_CHECK_PATCH"),NULL,str("pspatchcheck:check-for-update?titleid=PS5M00001"),NULL,NULL,NULL,1);assert(created==1);
 unsigned preserved=originalCalled;
 add_json(&game,PTR(50),str("MENU_ID_INFO"),NULL,NULL,NULL,NULL,NULL,1);
 assert(created==1&&originalCalled==preserved+1&&rootsUsed==0);
 // Opening a fresh Options menu creates its own row; no stale global dedupe.
 add_json(PTR(0xdeadbeef),PTR(50),str("MENU_ID_CHECK_PATCH"),NULL,str("pspatchcheck:check-for-update?titleid=PPSA00001"),NULL,NULL,NULL,1);
 assert(created==2&&originalCalled==preserved+2&&rootsUsed==0);
 char parsed[10];assert(title_from_url(str("pspatchcheck:check-for-update?titleid=PPSA00001&source=home"),parsed));
 assert(!title_from_url(str("pspatchcheck:check-for-update?titleid=PPSA00001extra"),parsed));
 assert(!title_from_url(str("https://example.test/?titleid=PPSA00001"),parsed));
 assert(evidence.dashboardOptionAdded==2&&evidence.dashboardTitleDecorated==1);
 Obj promise={.type=PTR(30)};assert(intercept_url(NULL,str("https://example.test"),&promise)==0&&passed==1);
 assert(intercept_url(NULL,str("tachen://cheats/PPSA00001/extra"),&promise)==0&&passed==2);
 assert(intercept_url(NULL,str("tachen://cheats/PPSA00001"),&promise)==1&&resolved==1);
 TacDeckFeedback feedback={0};tac_dashboard_feedback(&feedback);assert(feedback.dashboardSerial==1&&!strcmp(feedback.dashboardTitle,"PPSA00001"));
 assert(!tac_dashboard_ack(2)&&tac_dashboard_ack(1)&&!tac_dashboard_ack(1));feedback=(TacDeckFeedback){0};tac_dashboard_feedback(&feedback);assert(!feedback.dashboardSerial);
 frame.enabled=1;frame.epoch=2;frame.count=0;tac_dashboard_receive(&frame);assert(!rootsUsed);
 frame.count=1;strcpy(frame.records[0].title,"PPSA00001");strcpy(frame.records[0].version,"01.002.000");tac_dashboard_receive(&frame);textOriginal=display;
 version_text(&game,str("PPSA00001"));assert(!strcmp(displayed,"PPSA00001 | v01.002.000")&&!rootsUsed);
 version_text(&game,str("Other text"));assert(!strcmp(displayed,"Other text"));
 version_text(&game,str("PPSA99999"));assert(!strcmp(displayed,"PPSA99999"));
 frame.enabled=0;tac_dashboard_receive(&frame);version_text(&game,str("PPSA00001"));assert(!strcmp(displayed,"PPSA00001"));
 assert(evidence.dashboardVersionDecorated==1);
 puts("Dashboard originals, Unicode, settings, cache epochs, action routing and acknowledgements passed");return 0;
}
