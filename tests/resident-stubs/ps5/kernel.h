// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <sys/types.h>
#include <stdint.h>
#include <stddef.h>
int kernel_mprotect(pid_t,intptr_t,size_t,int);
extern uintptr_t KERNEL_ADDRESS_DATA_BASE,KERNEL_ADDRESS_ALLPROC,KERNEL_ADDRESS_DMAP_BASE,KERNEL_ADDRESS_PRISON0,KERNEL_ADDRESS_IOMMU_SOFTC;
unsigned int kernel_get_fw_version(void);
