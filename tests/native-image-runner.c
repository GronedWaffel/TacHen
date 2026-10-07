// SPDX-License-Identifier: GPL-3.0-or-later
#include "elf-image.h"
#include "sha256.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char **argv){
  if(argc==2&&!strcmp(argv[1],"--hash-test")){
    SHA256_CTX c;unsigned char hash[32];sha256_init(&c);sha256_update(&c,(const unsigned char*)"abc",3);sha256_final(&c,hash);
    for(int i=0;i<32;i++)printf("%02x",hash[i]);puts("");return 0;
  }
  if(argc<2)return 2;FILE *f=fopen(argv[1],"rb");if(!f)return 3;
  fseek(f,0,SEEK_END);long size=ftell(f);rewind(f);if(size<0||size>128*1024*1024){fclose(f);return 4;}
  unsigned char *data=malloc(size?size:1);if(!data){fclose(f);return 5;}
  if(fread(data,1,size,f)!=(size_t)size){free(data);fclose(f);return 6;}fclose(f);
  TacElfImage image;char error[192];int result=tac_elf_inspect(data,size,&image,error,sizeof error);
  if(result){printf("{\"accepted\":false,\"reason\":\"%s\"}\n",error);free(data);return 0;}
  if(argc>2&&!strcmp(argv[2],"--inspect-only")){
    printf("{\"accepted\":true,\"tables\":%u}\n",image.relocation_tables);free(data);return 0;
  }
  size_t bytes=(size_t)(image.highest-image.lowest);void *mirror=malloc(bytes);
  if(!mirror){free(data);return 7;}
  result=tac_elf_materialize(data,size,&image,image.lowest+0x400000,mirror,bytes);
  if(result){puts("{\"accepted\":false,\"reason\":\"Materialization failed\"}");}
  else {SHA256_CTX c;unsigned char digest[32];sha256_init(&c);sha256_update(&c,mirror,bytes);sha256_final(&c,digest);
    printf("{\"accepted\":true,\"bytes\":%zu,\"lowest\":%llu,\"sha256\":\"",bytes,(unsigned long long)image.lowest);
    for(unsigned i=0;i<32;i++)printf("%02x",digest[i]);puts("\"}");}
  free(mirror);free(data);return 0;
}
