// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-core.h"
#include "mono-api.h"
#include "deck-bootstrap.h"
// Optional dashboard hooks; a metadata mismatch never rejects the main menu.
int tac_dashboard_prepare(TacMono*,void*,void* targets[3],void* replacements[3]);
unsigned tac_dashboard_prepare_error(void);
void tac_dashboard_originals(void* trampolines[3]);
void tac_dashboard_receive(const TacDashboardFrame*);
void tac_dashboard_feedback(TacDeckFeedback*);
int tac_dashboard_ack(uint32_t);

void tac_dashboard_bind(volatile TacDeckBoot*);

void tac_dashboard_tick(int idle);

int tac_dashboard_version_prepare(void**,void**);
void tac_dashboard_version_original(void*);
