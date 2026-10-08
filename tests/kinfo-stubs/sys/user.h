#ifndef TACHEN_TEST_KINFO
#define TACHEN_TEST_KINFO
#include <stdint.h>
#define COMMLEN 19
struct kinfo_proc{int ki_structsize,ki_pid;uint64_t ki_runtime;struct{int64_t tv_sec,tv_usec;}ki_start;char ki_comm[20];char reserved[1036];};
#endif
