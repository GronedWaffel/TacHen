// SPDX-License-Identifier: GPL-3.0-or-later
#include <stdint.h>
#include <stddef.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <ps5/kernel.h>
// The SDK mmap/mprotect overrides contain inline syscall instructions. A
// resident ShellUI module must use the initialized libkernel gateway instead,
// keeping both the host policy and full-width (>4 GiB) addresses intact.
extern intptr_t __crt_syscall(intptr_t,...);
int __wrap_munmap(void* address,size_t length){
 return (int)__crt_syscall(SYS_munmap,(intptr_t)address,(intptr_t)length);
}
int __wrap_mprotect(void* address,size_t length,int protection){
 return kernel_mprotect((pid_t)__crt_syscall(SYS_getpid),(intptr_t)address,length,protection);
}
void* __wrap_mmap(void* address,size_t length,int protection,int flags,int fd,off_t offset){
 intptr_t mapped=__crt_syscall(SYS_mmap,(intptr_t)address,(intptr_t)length,
  (intptr_t)(protection&~PROT_EXEC),(intptr_t)flags,(intptr_t)fd,(intptr_t)offset);
 if(mapped==(intptr_t)MAP_FAILED)return MAP_FAILED;
 if((protection&PROT_EXEC)&&__wrap_mprotect((void*)mapped,length,protection)){
  __wrap_munmap((void*)mapped,length);errno=EPERM;return MAP_FAILED;
 }
 return (void*)mapped;
}
