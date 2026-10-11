// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "package-core.h"
int tac_package_directory(void);
int tac_package_open_source(const char* upload,char* path,size_t capacity);
int tac_package_request_load(TacPackageRequest* request);
int tac_package_request_save(TacPackageRequest* request);
int tac_package_receipt_load(const char* request,TacPackageReceipt* receipt);
int tac_package_receipt_save(TacPackageReceipt* receipt);
int tac_package_boot(TacPackageRequest* request,int compare);
uint64_t tac_package_millis(void);
