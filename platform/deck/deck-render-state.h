// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
typedef struct { int ready,visible,close;uint64_t heartbeat; } TacDeckRenderState;
static inline TacDeckRenderState tac_deck_render_state(int result,int open,uint32_t sequence,uint64_t now){
 // A valid closed/detached frame proves the UI callback is alive. Waiting for
 // the menu to be visible would deadlock readiness with its opening command.
 return (TacDeckRenderState){result==1,result==1&&open,result==0,result==1&&sequence?now:0};
}
