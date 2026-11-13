// VBimSdk.h
//
// Umbrella header of the VinaBIM integration SDK: one include that gives a
// plugin DLL every public App <-> DLL integration API (application / document
// facades, commands, events, ExternalEvent, selection, ribbon, dockable panes,
// dialogs, progress).
//
// It only includes the real headers below. It declares no types, namespaces or
// aliases of its own, so including a single header directly remains exactly
// equivalent.
//
// Deliberately NOT included:
//   - domain/public_api/modeling/**   removed historical BIM-object wrappers; out of SDK
//                                      scope (plugins use ODA BimRv directly:
//                                      OdBmVWall / OdBmSWall, OdBmTransaction, ...).
//   - ui/VBimResizableDialog.h         MFC helper (pulls <afxwin.h>); include it
//                                      explicitly in plugins that build MFC dialogs.
//   - **/internal/**                   Host-only bridges, not part of the SDK.
//
// Mapping from Revit add-in API names: docs/sdk-API/VBIMSDK_REVIT_MAPPING.md.
//
#pragma once

#include "VinaBIMApiExport.h"

// Application and document
#include "app/VBimUIApplication.h"
#include "app/VBimUIDocument.h"

// Project & Element Properties
#include "properties/VBimProjectProperty.h"
#include "properties/VBimProjectProperties.h"
#include "properties/VBimElementProperties.h"
#include "properties/VBimPropertiesPaneScope.h"

// Commands (plugin commands are ODA OdEdCommand objects)
#include "command/VBimCommand.h"
#include "command/Availability/IVBimCommandAvailability.h"

// Option Bar and Project commands
#include "optionbar/OptionBarTypes.h"
#include "optionbar/VBimOptionBarScope.h"
#include "command/project/VBimProjectExecutionContext.h"
#include "command/project/VBimProjectCommand.h"

// Editor helpers
#include "editor/VBimEditorApi.h"
#include "editor/VBimDimInteraction.h"
#include "editor/VBimPlacementPreview.h"

// Events and modeless entry
#include "events/VBimEventManager.h"
#include "events/ExternalEvent/VBimExternalEvent.h"

// Selection (sdk/pick)
#include "selection/VBimSelectionTypes.h"
#include "selection/IVBimSelectionFilter.h"
#include "selection/IVBimPickerService.h"
#include "selection/VBimSelection.h"
#include "selection/VBimSelectionService.h"
#include "selection/VBimReferenceExtractor.h"

// Ribbon
#include "ribbon/VBimRibbonConstants.h"
#include "ribbon/VBimRibbonTypes.h"
#include "ribbon/VBimRibbonGdi.h"
#include "ribbon/VBimRibbonPluginApi.h"
#include "ribbon/RibbonControl.h"
#include "ribbon/VBimContextualTabScope.h"

// UI services
#include "ui/VBimDockablePaneRegistry.h"
#include "ui/VBimProgressService.h"
#include "ui/VBimTaskDialogService.h"

// Undo / Redo
#include "undo/VBimUndoApi.h"

// Networking & JSON
#include "net/VBimHttp.h"
#include "json/VBimJson.h"
#include "net/VBimNetworkHelper.h"

// ---------------------------------------------------------------------------
// Convenience macros for recording undo actions in commands and free functions
// ---------------------------------------------------------------------------
#define VBIM_RECORD_UNDO(action) \
    do { \
        if (auto* _pDoc = VBimUIApplication::Instance().ActiveUIDocument()) { \
            _pDoc->RecordUndoAction(action); \
        } \
    } while (0)

#define VBIM_RECORD_UNDO_DB(pDb, action) \
    do { \
        VBimUIDocument::RecordUndoActionForDatabase((pDb), (action)); \
    } while (0)

#define VBIM_RECORD_CREATED(ids, name) \
    do { \
        if (auto* _pDoc = VBimUIApplication::Instance().ActiveUIDocument()) { \
            _pDoc->RecordCreated(ids, name); \
        } \
    } while (0)

#define VBIM_RECORD_MOVED(ids, offset, name) \
    do { \
        if (auto* _pDoc = VBimUIApplication::Instance().ActiveUIDocument()) { \
            _pDoc->RecordMoved(ids, offset, name); \
        } \
    } while (0)

#define VBIM_RECORD_ROTATED(id, center, axis, angle, name) \
    do { \
        if (auto* _pDoc = VBimUIApplication::Instance().ActiveUIDocument()) { \
            _pDoc->RecordRotated(id, center, axis, angle, name); \
        } \
    } while (0)

#define VBIM_RECORD_ERASED(ids, name) \
    do { \
        if (auto* _pDoc = VBimUIApplication::Instance().ActiveUIDocument()) { \
            _pDoc->RecordErased(ids, name); \
        } \
    } while (0)

#define VBIM_RECORD_MATRIX(ids, matrix, name) \
    do { \
        if (auto* _pDoc = VBimUIApplication::Instance().ActiveUIDocument()) { \
            _pDoc->RecordMatrixTransformed(ids, matrix, name); \
        } \
    } while (0)

#define VBIM_BEGIN_COMPOSITE(name) \
    do { \
        if (auto* _pDoc = VBimUIApplication::Instance().ActiveUIDocument()) { \
            _pDoc->BeginCompositeUndo(name); \
        } \
    } while (0)

#define VBIM_END_COMPOSITE() \
    do { \
        if (auto* _pDoc = VBimUIApplication::Instance().ActiveUIDocument()) { \
            _pDoc->EndCompositeUndo(); \
        } \
    } while (0)

