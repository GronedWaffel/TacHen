// Assertions in native regression runners must execute even under -O/NDEBUG.
#pragma once
#include <stdio.h>
#include <stdlib.h>
#define CHECK(condition) do { if(!(condition)) { fprintf(stderr,"CHECK failed at %s:%d: %s\n",__FILE__,__LINE__,#condition);exit(90); } } while(0)
