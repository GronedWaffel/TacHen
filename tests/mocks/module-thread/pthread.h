#ifndef TAC_TEST_PTHREAD_H
#define TAC_TEST_PTHREAD_H
#include <stddef.h>
typedef int pthread_t;
typedef struct {size_t stack;int detached;} pthread_attr_t;
#define PTHREAD_CREATE_DETACHED 1
int pthread_attr_init(pthread_attr_t *);
int pthread_attr_setstacksize(pthread_attr_t *,size_t);
int pthread_attr_setdetachstate(pthread_attr_t *,int);
int pthread_attr_destroy(pthread_attr_t *);
int pthread_create(pthread_t *,const pthread_attr_t *,void *(*)(void *),void *);
#endif
