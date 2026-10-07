// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-core.h"
#define TAC_DECK_LABELS 45
#define TAC_DECK_STYLES 5
#define TAC_DECK_PANELS 12
#define TAC_DECK_BACKGROUNDS 7
enum { TAC_INK_ACCENT, TAC_INK_TEXT, TAC_INK_MUTED, TAC_INK_QUIET, TAC_INK_ATTENTION };
typedef struct { float x,y; unsigned font,ink; char text[256]; } TacDeckText;
typedef struct { float x,y,width,height; unsigned ink,visible; } TacDeckPanel;
typedef struct { TacDeckText labels[TAC_DECK_LABELS]; TacDeckPanel panels[TAC_DECK_PANELS]; } TacDeckLayout;
extern const int tac_deck_font_sizes[TAC_DECK_STYLES];
extern const float tac_deck_ink[TAC_DECK_STYLES][4];
extern const float tac_deck_background[TAC_DECK_BACKGROUNDS][4];
// Pure presentation of an already validated frame. No managed calls, network,
// filesystem, allocations or clock reads. Native rendering and previews share it.
void tac_deck_layout(const TacDeckFrame*,int open,unsigned selected,TacDeckLayout*);
