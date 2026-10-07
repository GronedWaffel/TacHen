// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stddef.h>
#include <stdint.h>
typedef struct {unsigned status,head;uint64_t start,length;} TacPackageHttp;
// Complete, bounded HTTP/1.x headers only; one range and no request body.
int tac_package_http_parse(const char* header,size_t bytes,const char* target,uint64_t size,TacPackageHttp* out);
int tac_package_http_response(char* buffer,size_t capacity,const TacPackageHttp* request,uint64_t size);
typedef struct TacPackageSource TacPackageSource;
// The source owns a duplicated descriptor; only the exact request URL is served.
int tac_package_source_start(TacPackageSource** source,int fd,const char* request,uint64_t bytes,char* url,size_t capacity);
int tac_package_source_healthy(TacPackageSource* source);
void tac_package_source_stop(TacPackageSource* source);
