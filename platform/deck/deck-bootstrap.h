// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#define TAC_DECK_BOOT_OFFSET 0x800
#define TAC_DECK_BOOT_MAGIC UINT64_C(0x5441434445434b31)
typedef struct { uint64_t address; uint8_t before[14],after[14]; } TacDeckPatch;
typedef struct {
 uint64_t magic; uint32_t version,state; char credential[33],reserved[7];
 // 0 prepare, 1 complete patch batch requested, 2 published while stopped,
 // 3 rejected, 4 bootstrap complete. Render heartbeat is a separate readiness.
 uint32_t count,error; uint64_t renderedAt; TacDeckPatch patches[2];
} TacDeckBoot;

// Numeric errors cross the process boundary; no managed pointers are exposed.
static inline const char* tac_deck_prepare_error(uint32_t error){
 switch(error){
  case 101:return "Mono exports";
  case 102:return "Mono root domain";
  case 103:return "Mono thread attachment";
  case 104:return "PUI/Core/AppSystem assemblies";
  case 105:return "PUI/Core/AppSystem classes";
  case 106:return "Panel inherits Widget";
  case 107:return "Update/GetData signatures";
  case 108:return "GamePadData layout";
  case 109:return "UIFont/UIColor layout";
  case 110:return "findScene";
  case 111:return "getRoot";
  case 112:return "append";
  case 113:return "remove";
  case 114:return "labelCtor";
  case 115:return "fontCtor";
  case 116:return "colorCtor";
  case 117:return "text";
  case 118:return "name";
  case 119:return "x";
  case 120:return "y";
  case 121:return "width";
  case 122:return "height";
  case 123:return "textColor";
  case 124:return "labelFont";
  case 125:return "panelCtor";
  case 126:return "panelWidth";
  case 127:return "panelHeight";
  case 128:return "panelColor";
  case 129:return "panelVisible";
  case 130:return "Panel color parameter identity";
  case 131:return "Update/GetData compilation";
  default:return "native bootstrap";
 }
}
