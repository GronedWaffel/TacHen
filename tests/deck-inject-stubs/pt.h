#pragma once
#include <stdint.h>
#include <stddef.h>
#include <sys/types.h>
struct reg {uint64_t r_rip;};
int pt_attach_owned(pid_t,int*);int pt_detach(pid_t,int);
int pt_getregs(int,struct reg*);int pt_copyout(pid_t,uint64_t,void*,size_t);
int pt_copyin(pid_t,const void*,uint64_t,size_t);
intptr_t pt_mmap(pid_t,intptr_t,size_t,int,int,int,off_t);
int pt_munmap(pid_t,intptr_t,size_t);
long pt_call2(pid_t,intptr_t,uintptr_t);
intptr_t kernel_dynlib_dlsym(pid_t,int,const char*);
int kernel_get_vmem_protection(pid_t,uint64_t,size_t);
int kernel_proc_copyout(pid_t,intptr_t,void*,size_t);
int kernel_proc_copyin(pid_t,const void*,intptr_t,size_t);
