// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <stdint.h>
#define TAC_DECK_BOOT_VERSION 12
#define TAC_DECK_MAX_PATCHES 10
#define TAC_DECK_BOOT_OFFSET 0x800
#define TAC_DECK_BOOT_MAGIC UINT64_C(0x5441434445434b31)
typedef struct { uint64_t address; uint8_t before[14],after[14]; } TacDeckPatch;
#define TAC_DECK_READ_HISTORY 16
typedef struct { uint64_t address,length; uint32_t sequence,complete; int32_t result; uint32_t reserved; } TacDeckKernelRead;
typedef struct {
 uint64_t magic; uint32_t version,state; char credential[33],reserved[7];
 // 0 prepare, 1 complete patch batch requested, 2 published while stopped,
 // 3 rejected, 4 bootstrap complete. Render heartbeat is a separate readiness.
 uint32_t count,error; uint64_t renderedAt; TacDeckPatch patches[TAC_DECK_MAX_PATCHES];
 // reservedTrace after render: 1=no app, 2=no application root,
 // 3=incompatible root container, 4=overlay hidden, 5=no overlay widget root,
 // 6=visible owned UI2 overlay, 7=managed exception, 8=closed/detached,
 // 9=pending scene activation (0=not checked).
 uint32_t phase,renderPhase,inputPhase,reservedTrace;
 uint64_t kernelReadAddress,kernelReadLength;
 uint32_t kernelReadCount; int32_t kernelReadResult;
 // Bounded input evidence, sampled by the coordinator outside the UI hooks.
 uint32_t inputCalls,inputButtonsSeen; int32_t inputDevice;
 uint32_t inputSkipped,inputRoute,inputReady,inputOpen;
 // Private bootstrap diagnostics: addresses/results only, never read contents.
 uint32_t bootstrapFirmware; int32_t kernelInitResult;
 uint64_t kernelDataBase,kernelAllproc,kernelDmap,kernelPrison,kernelIommu;
 TacDeckKernelRead kernelReads[TAC_DECK_READ_HISTORY];
 int32_t inputFocus;uint32_t inputRequestedRoute;
 uint32_t dashboardError;
 uint32_t cheatsStage,cheatsError,cheatsActions;
 uint32_t dashboardRefreshes,dashboardRefreshError;
 uint32_t dashboardTitleCalls,dashboardTitleDecorated,dashboardOptionCalls,dashboardOptionAdded,dashboardUrlCalls;
 uint32_t dashboardVersionCalls,dashboardVersionDecorated,dashboardVersionError;
 // Retained across coordinator stalls so a later poll can explain a closure.
 uint32_t menuUpdateWaits,menuUpdateExpired;
} TacDeckBoot;
#ifdef __cplusplus
static_assert(sizeof(TacDeckBoot)+TAC_DECK_BOOT_OFFSET<=0x4000,"Bootstrap record must fit its owned mapping");
#else
_Static_assert(sizeof(TacDeckBoot)+TAC_DECK_BOOT_OFFSET<=0x4000,"Bootstrap record must fit its owned mapping");
#endif

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
  case 110:return "application root/visibility methods";
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
  case 132:return "owned overlay scene lifecycle methods";
  case 133:return "owned overlay scene layout/focus methods";
  case 134:return "owned overlay background opacity policy";
  case 135:return "owned overlay front activation passthrough";
  default:return "native bootstrap";
 }
}
