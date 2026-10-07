// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-core.h"
typedef struct {int32_t handle;uint32_t connection,used;uint64_t at;} TacDeckController;
typedef struct {
 uint32_t epoch,serial,active,captured;uint64_t deadline,captureAt;
 int32_t owner;uint32_t connection;TacDeckController controllers[8];
} TacDeckRoute;
void tac_deck_route_receive(TacDeck*,TacDeckRoute*,const TacDeckInput*,uint64_t now);
void tac_deck_route_tick(TacDeck*,TacDeckRoute*,uint64_t now);
int tac_deck_route_visible(const TacDeck*,const TacDeckRoute*);
TacDeckFeedback tac_deck_route_feedback(const TacDeck*,const TacDeckRoute*,int ready,uint64_t renderedAt);
