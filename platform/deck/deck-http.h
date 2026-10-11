// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-core.h"
// Bounded loopback-only transport, called exclusively by the background worker.
// Returns HTTP status, or -1 for an unconfirmed request. Never auto-generates a
// new action identity after an interrupted POST.
static inline int tac_deck_http_has_frame(int status){return status==200||status==202;}
static inline int tac_deck_http_acknowledges(int status){return status==200||(status>=400&&status<600);}
int tac_deck_http(uint16_t port,const char credential[33],const TacDeckEvent* event,const TacDeckFeedback*,TacDeckFrame* frame);

int tac_cheats_http(uint16_t,const char[33],const TacDeckEvent*,const TacDeckFeedback*,TacDeckFrame*);
