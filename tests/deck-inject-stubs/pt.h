#pragma once
#include <stdint.h>
#include <stddef.h>
#include <sys/types.h>
struct reg {uint64_t r_rip,r_rsp,r_rdi,r_rsi,r_rdx,r_rcx,r_r8,r_r9,r_rax,r_rbp,r_rbx,r_r12,r_r13,r_r14,r_r15;};
int pt_setregs(int,const struct reg*);int pt_continue(pid_t,int);
int pt_wait_signal(pid_t,unsigned,int*);
int pt_stop_info(pid_t,int*,int*,int*,uintptr_t*);
int pt_attach_owned(pid_t,int*);int pt_detach(pid_t,int);
int pt_getregs(int,struct reg*);int pt_copyout(pid_t,uint64_t,void*,size_t);
int pt_copyin(pid_t,const void*,uint64_t,size_t);
intptr_t pt_mmap(pid_t,intptr_t,size_t,int,int,int,off_t);
int pt_munmap(pid_t,intptr_t,size_t);
int pt_mprotect(pid_t,intptr_t,size_t,int);
long pt_call2(pid_t,intptr_t,uintptr_t);
intptr_t kernel_dynlib_dlsym(pid_t,int,const char*);
int kernel_get_vmem_protection(pid_t,uint64_t,size_t);
int kernel_proc_copyout(pid_t,intptr_t,void*,size_t);
int kernel_proc_copyin(pid_t,const void*,intptr_t,size_t);
