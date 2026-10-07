// SPDX-License-Identifier: GPL-3.0-or-later
#include "package-http.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <fcntl.h>
#include <io.h>
#include <sys/stat.h>
#include <windows.h>
#define CHECK(x) do{if(!(x)){fprintf(stderr,"CHECK failed at %d: %s\n",__LINE__,#x);return 90;}}while(0)
static const char* token="0123456789abcdef0123456789abcdef";
int main(int argc,char** argv){
 if(argc==2&&!strcmp(argv[1],"--fail-check"))CHECK(0);
 if(argc==2&&!strcmp(argv[1],"--parse")){
  _setmode(_fileno(stdin),_O_BINARY);
  _setmode(_fileno(stdout),_O_BINARY);
  char header[8192];size_t bytes=fread(header,1,sizeof header,stdin);TacPackageHttp r;char response[512];
  int rc=tac_package_http_parse(header,bytes,"/0123456789abcdef0123456789abcdef/package.pkg",UINT64_C(193273528320),&r);
  int n=tac_package_http_response(response,sizeof response,&r,UINT64_C(193273528320));CHECK(n>0);
  printf("{\"rc\":%d,\"status\":%u,\"head\":%u,\"start\":%llu,\"length\":%llu}\n",rc,r.status,r.head,(unsigned long long)r.start,(unsigned long long)r.length);
  fwrite(response,1,(size_t)n,stdout);return 0;
 }
 CHECK(argc==2);int fd=_open(argv[1],_O_RDONLY|_O_BINARY);CHECK(fd>=0);struct _stat64 st;CHECK(!_fstat64(fd,&st));
 TacPackageSource* source=NULL;char url[160];CHECK(!tac_package_source_start(&source,fd,token,(uint64_t)st.st_size,url,sizeof url));
 _close(fd);printf("%s\n",url);fflush(stdout);
 char line[40];while(fgets(line,sizeof line,stdin)){
  if(!strcmp(line,"health\n")){printf("%d\n",tac_package_source_healthy(source));fflush(stdout);}
  else break;
 }
 tac_package_source_stop(source);puts("stopped");return 0;
}
