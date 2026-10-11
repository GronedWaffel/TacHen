#include "download-core.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
typedef struct {int available,read_error,write_error,cancel,written,reads;uint64_t progress;} Fake;
static int cancelled(void *p){return ((Fake*)p)->cancel;}
static int read_data(void *p,void *out,size_t size){Fake *f=p;f->reads++;if(f->read_error)return -1;int n=f->available>17?17:f->available;assert((size_t)n<=size);memset(out,'x',(size_t)n);f->available-=n;return n;}
static int write_data(void *p,const void *data,size_t n){Fake *f=p;(void)data;if(f->write_error)return -1;f->written+=(int)n;return 0;}
static void progress(void *p,uint64_t n,uint64_t total){(void)total;((Fake*)p)->progress=n;}
static int run(Fake *f,TacDownloadHeaders *h,uint64_t limit){TacDownloadStream io={f,cancelled,read_data,write_data,progress};return tac_download_stream(&io,h,limit);}
static int headers(const char *s,TacDownloadHeaders *h){return tac_download_headers(s,strlen(s),h);}
int main(void){
 uint64_t budget=0;const uint64_t mib=UINT64_C(1024)*1024;
 // A small unknown-length file must work on a disk smaller than the 1 TiB cap.
 assert(!tac_download_space(4096,64*mib/4096,65536,&budget)&&budget==4*mib);
 assert(tac_download_space(4096,64*mib/4096,100*mib,&budget)==-1&&budget==0);
 // Recheck after competing writes: stop before consuming the reserve.
 assert(!tac_download_space(4096,(16*mib+65536)/4096,65536,&budget)&&budget==65536);
 assert(tac_download_space(4096,16*mib/4096,1,&budget)==-1);
 assert(tac_download_space(4096,UINT64_MAX,1,&budget)==-1);
 assert(tac_download_space(0,100,1,&budget)==-1);
 TacDownloadHeaders h;
 assert(!headers("HTTP/1.1 200 OK\r\nContent-Length: 51\r\nContent-Type: application/octet-stream\r\n\r\n",&h));
 assert(h.has_length&&h.length==51);Fake f={.available=51};assert(run(&f,&h,100)==TAC_DL_OK&&f.written==51&&f.progress==51);
 f=(Fake){.available=35};assert(run(&f,&h,100)==TAC_DL_TRUNCATED);
 f=(Fake){.available=68};assert(run(&f,&h,100)==TAC_DL_TRUNCATED&&f.written==51);
 f=(Fake){.available=51};assert(run(&f,&h,40)==TAC_DL_LIMIT&&f.reads==0);
 assert(!headers("Transfer-Encoding: chunked\r\n",&h));f=(Fake){.available=68};assert(run(&f,&h,51)==TAC_DL_LIMIT&&f.written==51);
 f=(Fake){.available=51};assert(run(&f,&h,51)==TAC_DL_OK);
 f=(Fake){.available=51,.cancel=1};assert(run(&f,&h,100)==TAC_DL_CANCELLED&&f.reads==0);
 f=(Fake){.available=51,.read_error=1};assert(run(&f,&h,100)==TAC_DL_READ);
 f=(Fake){.available=51,.write_error=1};assert(run(&f,&h,100)==TAC_DL_WRITE);
 f=(Fake){0};assert(run(&f,&h,100)==TAC_DL_EMPTY);
 const char *invalid[]={"Content-Length: 12\r\nContent-Length: 12\r\n", "Content-Length: 12\r\nTransfer-Encoding: chunked\r\n", "Content-Length: 18446744073709551616\r\n", "Content-Length: -1\r\n", "Content-Encoding: gzip\r\n", "Transfer-Encoding: gzip, chunked\r\n", "Location: https://a/b\r\nLocation: https://b/c\r\n", "Location: https://a/evil\\b\r\n", "Location: https://a/evil space\r\n", "Folded\r\n header: value\r\n"};
 for(size_t i=0;i<sizeof invalid/sizeof invalid[0];i++)assert(headers(invalid[i],&h)==-1);
 assert(!headers("location: /next?token=a%20b\r\n",&h));assert(!strcmp(h.location,"/next?token=a%20b"));
 puts("download core: stream bounds, cancellation, truncation and header validation passed");return 0;
}
