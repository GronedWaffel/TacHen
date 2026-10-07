// SPDX-License-Identifier: GPL-3.0-or-later
#include "relocate.h"
#include <string.h>
extern "C" int tac_deck_trampoline(const unsigned char* original,uint64_t address,void* memory,size_t capacity){
 RelocatedCode code;if(!BuildTrampoline(original,64,address,(uintptr_t)memory,&code)||code.size>capacity)return 0;
 memcpy(memory,code.bytes,code.size);return 1;
}
