// Host-only declarations for the read-only process-current regression runner.
#pragma once
#include <stdint.h>
#include <stddef.h>
extern const intptr_t KERNEL_ADDRESS_ALLPROC;
extern const int64_t KERNEL_OFFSET_PROC_P_PID;
int32_t kernel_copyout(intptr_t address,void *destination,size_t length);
intptr_t kernel_get_proc(int pid);
