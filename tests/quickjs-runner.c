/* SPDX-License-Identifier: GPL-3.0-or-later
 * Off-console engine smoke test. It provides no PS5 APIs and cannot load payloads. */
#include "quickjs.h"
#include <stdio.h>
#include <stdlib.h>
static JSValue print_line(JSContext* ctx,JSValueConst self,int argc,JSValueConst* argv){
  (void)self;for(int i=0;i<argc;i++){const char* text=JS_ToCString(ctx,argv[i]);if(text){puts(text);JS_FreeCString(ctx,text);}}return JS_UNDEFINED;
}
static void exception(JSContext* ctx){JSValue e=JS_GetException(ctx);const char* text=JS_ToCString(ctx,e);fprintf(stderr,"%s\n",text?text:"QuickJS exception");if(text)JS_FreeCString(ctx,text);JS_FreeValue(ctx,e);}
int main(int argc,char** argv){
  if(argc!=2)return 2;FILE* file=fopen(argv[1],"rb");if(!file)return 2;
  fseek(file,0,SEEK_END);long size=ftell(file);rewind(file);if(size<0||size>16*1024*1024)return 2;
  char* source=malloc(size+1);if(!source)return 2;size_t count=fread(source,1,size,file);fclose(file);source[count]=0;
  JSRuntime* rt=JS_NewRuntime();if(!rt)return 2;JS_SetMemoryLimit(rt,48*1024*1024);JSContext* ctx=JS_NewContext(rt);if(!ctx)return 2;
  JSValue global=JS_GetGlobalObject(ctx);JS_SetPropertyStr(ctx,global,"print",JS_NewCFunction(ctx,print_line,"print",1));
  JSValue result=JS_Eval(ctx,source,count,argv[1],JS_EVAL_TYPE_GLOBAL);free(source);
  int failed=JS_IsException(result);if(failed)exception(ctx);JS_FreeValue(ctx,result);
  for(int i=0;!failed&&i<10000;i++){JSContext* job;int n=JS_ExecutePendingJob(rt,&job);if(n<0){exception(job);failed=1;break;}if(!n)break;}
  JSValue done=JS_GetPropertyStr(ctx,global,"testPassed");if(!JS_ToBool(ctx,done))failed=1;JS_FreeValue(ctx,done);
  JS_FreeValue(ctx,global);JS_FreeContext(ctx);JS_FreeRuntime(rt);return failed?1:0;
}
