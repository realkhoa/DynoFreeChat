// VBimEventDispatch.h
//
// Internal — NOT part of the public SDK surface.
// Used only by VBimEventBridge.cpp to push events into VBimEventManager.
// Do not include in SDK-developer-facing headers.
//
#pragma once

#include "../VBimEventManager.h"  // VBimEventType, VBimEventArgs

// Fires an event to all registered handlers matching `type`.
// Snapshot-before-iterate: safe when a handler calls Unsubscribe() during dispatch.
// Must be called from the UI thread.
void vbimEventFire(VBimEventType type, const VBimEventArgs& args);
