// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#include <stddef.h>
#define TAC_DECK_MAGIC 0x54414344u
#define TAC_DECK_ROWS 8
#define TAC_DECK_STALE_MS 3000u
typedef struct { char token[32], label[96], detail[160]; uint32_t flags; } TacDeckRow;
typedef struct {uint32_t buttons;int32_t handle;uint32_t connection,sequence;uint64_t at;} TacDeckPad;
typedef struct {
 uint32_t epoch,serial,active,captured;int32_t owner;uint32_t connection,count,reserved;
 uint64_t deadline,captureAt;TacDeckPad events[128];
} TacDeckInput;
typedef struct {uint32_t epoch,serial,open;int32_t owner;uint32_t connection,ready;uint64_t renderedAt;} TacDeckFeedback;
typedef struct {
 uint32_t magic; uint16_t version,flags; uint32_t sequence; uint16_t page,count;
 char title[64],subtitle[160],footer[160],ip[64]; TacDeckRow rows[TAC_DECK_ROWS];
 uint32_t metricsSequence; char metrics[192];
 uint32_t reserved;TacDeckInput input;
} TacDeckFrame;
_Static_assert(sizeof(TacDeckFrame)==6120,"Deck wire size");
_Static_assert(offsetof(TacDeckFrame,input)==3000,"Independent game input offset");
_Static_assert(offsetof(TacDeckFrame,metricsSequence)==2800,"Independent telemetry sequence offset");
_Static_assert(offsetof(TacDeckFrame,rows)==464,"Deck row offset");
typedef struct { uint32_t kind,sequence,row,serial; } TacDeckEvent;
enum { TAC_DECK_SELECT=1,TAC_DECK_NEXT=2,TAC_DECK_PREVIOUS=3,TAC_DECK_BACK=4 };
enum { TAC_LEFT=1,TAC_UP=2,TAC_RIGHT=4,TAC_DOWN=8,TAC_CIRCLE=64,TAC_CROSS=128,
 TAC_L1=1024,TAC_R1=2048,TAC_L3=16384,TAC_R3=32768 };
typedef struct {
 TacDeckFrame frame; uint64_t received,chordAt[8],repeatAt; uint32_t previous[8],serial;
 uint8_t chordActive[8],chordLatched[8],drain[8],open,valid,selected,owner,pending;
 uint32_t repeatDirection,presentedSequence;uint8_t presentedOpen,presentedSelected;TacDeckEvent event;
} TacDeck;
int tac_deck_decode(const void* bytes,size_t length,TacDeckFrame* frame);
void tac_deck_init(TacDeck* deck);
int tac_deck_receive(TacDeck* deck,const void* bytes,size_t length,uint64_t now);
void tac_deck_tick(TacDeck* deck,uint64_t now);
void tac_deck_present(TacDeck* deck,uint32_t sequence,int open,unsigned selected);
// Return 1 when the renderer owns this sample; caller clears all controller
// fields, including analog values and button edges, before returning it.
int tac_deck_input(TacDeck* deck,unsigned device,uint32_t buttons,uint64_t now);
int tac_deck_input_at(TacDeck*,unsigned,uint32_t,uint64_t sampleAt,uint64_t now);
int tac_deck_event(const TacDeck* deck,TacDeckEvent* event);
void tac_deck_ack(TacDeck* deck,uint32_t serial);
