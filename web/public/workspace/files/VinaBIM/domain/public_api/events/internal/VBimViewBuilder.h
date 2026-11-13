// VBimViewBuilder.h
//
// Internal — NOT part of the public SDK surface.
// Constructs VBimView instances from ODA database objects.
// Only included from VBimEventBridge.cpp and VBimUIDocument.cpp.
//
#pragma once
#include "domain/public_api/events/VBimEventManager.h"
#include "Database/Entities/BmDBView.h"

class OdBmDatabase;

// Build a VBimView from an open OdBmDBViewPtr.
//
// Returns an invalid VBimView (IsValid() == false) when db is null or pDbView is null.
// Reads viewId, drawingId, stableViewHandle, viewName, and viewType from pDbView.
// viewType is derived from OdBmDBView::getViewType() via buildViewPipelineContext().
//
VBimView MakeVBimView(OdBmDatabase* db, const OdBmDBViewPtr& pDbView);

// Returns a default-constructed invalid VBimView (IsValid() == false).
//
VBimView MakeEmptyVBimView();
