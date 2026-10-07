// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-core.h"
#include "mono-api.h"
typedef struct {
 TacMono mono;void* domain;void* label;void* widget;void* font;void* color;
 void* findScene;void* getRoot;void* append;void* remove;void* labelCtor;void* fontCtor;void* colorCtor;
 void* text;void* name;void* x;void* y;void* width;void* height;void* textColor;void* labelFont;
 uint32_t root,labels[20],fonts[3],colors[3];uint64_t checkedAt;uint32_t sequence;
 uint8_t selected,open,ipVisible,initialized,failed;
} TacDeckView;
// Resolve all required metadata before publishing hooks. Fail closed on an
// unfamiliar managed ABI rather than treating firmware offsets as UI metadata.
int tac_deck_view_prepare(TacDeckView* view,void** update,void** input);
// UI thread only. No files, sockets, sleeps, credential changes or kernel calls.
int tac_deck_view_render(TacDeckView* view,const TacDeckFrame* frame,int open,unsigned selected,uint64_t now);
