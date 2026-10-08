#include <stddef.h>
#define CTL_KERN 1
#define KERN_PROC 14
#define KERN_PROC_PID 1
int sysctl(const int*,unsigned,void*,size_t*,const void*,size_t);
