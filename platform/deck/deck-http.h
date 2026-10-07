// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-core.h"
// Bounded loopback-only transport, called exclusively by the background worker.
// Returns HTTP status, or -1 for an unconfirmed request. Never auto-generates a
// new action identity after an interrupted POST.
int tac_deck_http(uint16_t port,const char credential[33],const TacDeckEvent* event,TacDeckFrame* frame);
