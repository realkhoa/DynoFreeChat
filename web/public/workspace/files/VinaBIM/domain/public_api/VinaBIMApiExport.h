#pragma once

// ODA requires OdaCommon.h to precede every other ODA header in a translation
// unit. Keeping that rule at the public API root makes each SDK header
// self-contained for consumers.
#if __has_include("OdaCommon.h")
#include "OdaCommon.h"
#endif
#if __has_include("BimCommon.h")
#include "BimCommon.h"
#endif

// Public import/export marker for the VinaBIM native SDK.
//
// The Host defines VINABIM_DLL while building VinaBIM.exe. SDK consumers do
// not define it and therefore import the same symbols through VinaBIM.lib.
#if defined(VINABIM_STATIC)
#define VINABIM_API
#elif defined(VINABIM_DLL)
#define VINABIM_API __declspec(dllexport)
#else
#define VINABIM_API __declspec(dllimport)
#endif

// Binary (ABI) version of the public SDK. A plugin records the value it was
// built against with VBIM_SDK_DECLARE_ABI_VERSION(); the Host plugin loaders
// refuse a plugin whose value differs and log "rebuild the plugin".
//
// Increment it in the same change whenever a public header changes the binary
// contract: a field added / removed / reordered in a public struct or class,
// a changed function signature, a virtual function added to an interface, an
// enum value renumbered, or a removed export. Adding a new free function, a new
// class, or an enum value at the end does not require a bump.
//
// History: 1 = 2026-09-27, integration SDK (ExternalEvent, change / app
// events, availability, ribbon value controls, pane state, ShowAdvanced) on top
// of the sdk/pick selection API.
// 2 = 2026-10-03, plugin-build SnapKind renumbered to match Core (Grid = 3,
// Perpendicular = 4, Nearest = 5; previously Nearest = 3).
// 3 = 2026-10-16, VBimOptionBarScope / VBimContextualTabScope hold an ownership
// token (layout changed), VBimContextualTabControlHandler removed from the SDK.
#define VBIM_SDK_ABI_VERSION 3

// Name of the exported data symbol that carries a plugin's ABI version.
#define VBIM_SDK_ABI_EXPORT_SYMBOL "VBimSdkAbiVersion"

// Put exactly once in one .cpp of a plugin DLL. Exports a constant (no code),
// so the Host can read it without running the plugin.
#define VBIM_SDK_DECLARE_ABI_VERSION() \
    extern "C" __declspec(dllexport) const int VBimSdkAbiVersion = VBIM_SDK_ABI_VERSION

// Source compatibility for existing command modules. New public declarations
// should use VINABIM_API directly.
#ifndef VINABIMCORE_DLLEXPORT
#define VINABIMCORE_DLLEXPORT VINABIM_API
#endif
