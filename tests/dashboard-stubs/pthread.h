#pragma once
// Single-thread callback fixture; concurrency is not simulated here.
typedef int pthread_mutex_t;
#define PTHREAD_MUTEX_INITIALIZER 0
static inline int pthread_mutex_lock(pthread_mutex_t*p){*p=1;return 0;}
static inline int pthread_mutex_unlock(pthread_mutex_t*p){*p=0;return 0;}
static inline int pthread_mutex_trylock(pthread_mutex_t*p){if(*p)return 1;*p=1;return 0;}
