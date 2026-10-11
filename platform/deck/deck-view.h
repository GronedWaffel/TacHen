// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "deck-layout.h"
#include "mono-api.h"
#include "deck-motion.h"
typedef struct {
 uint32_t prepareError,sceneStatus;volatile uint32_t* prepareTrace;
 TacMono mono;void* domain;void* label;void* widget;void* font;void* color;void* panel;
 void* getApplication;void* findScene;void* sceneClass;void* sceneVisible;void* getRoot;void* append;void* remove;void* labelCtor;void* fontCtor;void* colorCtor;
 void* containerClass;void* sceneCtor;void* addScene;void* removeScene;void* sceneOverlay;
 void* sceneFocusable;void* sceneFrontable;void* sceneWidth;void* sceneHeight;void* sceneBackground;
 void* scenePassFrontActive;void* gameLayerFocused;
 void* sceneBackgroundControl;void* sceneBackgroundLimit;
 uint32_t parentScene,overlayScene,sceneManualMode;uint8_t sceneAttached;
 void* text;void* name;void* x;void* y;void* width;void* height;void* textColor;void* labelFont;
 void* panelCtor;void* panelWidth;void* panelHeight;void* panelColor;void* panelVisible;
 TacDeckLayout painted;
 TacDeckMotion motion;uint8_t animate,moving;
 uint64_t attachedLabels,cleanupAt,openingAt;uint32_t attachedPanels;
 uint32_t root,labels[TAC_DECK_LABELS],fonts[TAC_DECK_STYLES],colors[TAC_DECK_INKS];uint64_t checkedAt;uint32_t sequence,metricsSequence,noticeSequence;
 uint32_t panels[TAC_DECK_PANELS],backgrounds[TAC_DECK_BACKGROUNDS];
 uint16_t flags;uint8_t selected,open,initialized,failed,noticeVisible,paintedValid,hud;
} TacDeckView;
// Resolve all required metadata before publishing hooks. Fail closed on an
// unfamiliar managed ABI rather than treating firmware offsets as UI metadata.
int tac_deck_view_prepare(TacDeckView* view,void** update,void** input,volatile uint32_t* trace);
// UI thread only. No files, sockets, sleeps, credential changes or kernel calls.
// 0 unavailable, 1 ready (including closed/detached), 2 waiting for scene visibility.
int tac_deck_view_render(TacDeckView* view,const TacDeckFrame* frame,int open,unsigned selected,uint64_t now);
// UI thread only: 0 ShellUI foreground, 1 full-screen game, -1 unknown,
// -2 method unavailable (retain the existing input route).
int tac_deck_view_game_focus(TacDeckView* view);
