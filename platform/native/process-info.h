// SPDX-License-Identifier: GPL-3.0-or-later
#ifndef TACHEN_PROCESS_INFO_H
#define TACHEN_PROCESS_INFO_H
#include <sys/types.h>
#include <sys/user.h>
int tac_process_info(pid_t pid,struct kinfo_proc* out);
#endif
