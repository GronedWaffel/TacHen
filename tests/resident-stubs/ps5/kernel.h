// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <sys/types.h>
#include <stdint.h>
#include <stddef.h>
int kernel_mprotect(pid_t,intptr_t,size_t,int);
