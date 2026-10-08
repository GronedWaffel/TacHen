// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-layout.h"
#include "mono-api.h"
typedef struct {
 uint32_t prepareError;
 TacMono mono;void* domain;void* label;void* widget;void* font;void* color;void* panel;
 void* findScene;void* getRoot;void* append;void* remove;void* labelCtor;void* fontCtor;void* colorCtor;
 void* text;void* name;void* x;void* y;void* width;void* height;void* textColor;void* labelFont;
 void* panelCtor;void* panelWidth;void* panelHeight;void* panelColor;void* panelVisible;
 TacDeckLayout painted;
 uint64_t attachedLabels,cleanupAt;uint16_t attachedPanels;
 uint32_t root,labels[TAC_DECK_LABELS],fonts[TAC_DECK_STYLES],colors[TAC_DECK_INKS];uint64_t checkedAt;uint32_t sequence,metricsSequence,noticeSequence;
 uint32_t panels[TAC_DECK_PANELS],backgrounds[TAC_DECK_BACKGROUNDS];
 uint16_t flags;uint8_t selected,open,initialized,failed,noticeVisible,paintedValid;
} TacDeckView;
// Resolve all required metadata before publishing hooks. Fail closed on an
// unfamiliar managed ABI rather than treating firmware offsets as UI metadata.
int tac_deck_view_prepare(TacDeckView* view,void** update,void** input);
// UI thread only. No files, sockets, sleeps, credential changes or kernel calls.
int tac_deck_view_render(TacDeckView* view,const TacDeckFrame* frame,int open,unsigned selected,uint64_t now);
