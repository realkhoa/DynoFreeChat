// VBimSdkSampleCommand.h
//
// SAMPLE — NOT COMPILED INTO PRODUCTION BUILD.
//
// Demonstrates a minimal ODA command that uses the VinaBIM Public SDK facade:
//   VBimUIApplication → VBimUIDocument → VBimSelectionService → VBimTaskDialogService
//
// How to register this command for local testing (add to Commands.cpp temporarily):
//
//   #include "domain/sdk_samples/VBimSdkSampleCommand.h"
//   static OdStaticRxObject<VBimSdkSampleCommand> g_sdkSampleCmd;
//   // in rxInitCmds():   odedRegCmds()->addCommand(&g_sdkSampleCmd);
//   // in rxUninitCmds(): odedRegCmds()->removeCmd(&g_sdkSampleCmd);
//
// Then type "VBIMSDK_PICK" in the command line to run.
//
#pragma once

#include "Ed/EdCommandStack.h"              // OdEdCommand, OdEdCommandContext

// VBimSdkSampleCommand — "VBIMSDK_PICK"
//
// Prompts the user to pick one BIM element, then shows a task dialog
// reporting whether the pick succeeded. Does not modify the database.
//
class VBimSdkSampleCommand : public OdEdCommand
{
public:
    const OdString groupName() const override { return globalName(); }
    const OdString globalName() const override { return L"VBIMSDK_PICK"; }
    void execute(OdEdCommandContext* pCmdCtx) override;
};

// VBimSdkEventsSampleCommand — "VBIMSDK_EVENTS"
//
// Runtime check for the SDK integration events and external events.
//
// First run: subscribes to every VBimEventType, registers an external event
// handler and raises it twice from a worker thread; each callback appends a
// line to an in-memory log. The first cancellable DocumentClosing is cancelled
// once, so the first close of a document's last frame is expected to be kept
// open. Dialogs are only logged, never overridden.
//
// Second run: prints the log to the command line, unsubscribes and
// unregisters everything. Does not modify the database. UI thread only.
//
class VBimSdkEventsSampleCommand : public OdEdCommand
{
public:
    const OdString groupName() const override { return globalName(); }
    const OdString globalName() const override { return L"VBIMSDK_EVENTS"; }

    // Toggles recording: starts it when idle, otherwise prints the log to
    // pCmdCtx->userIO() and stops. Recording state is process-wide and lives
    // until the second run; no database access.
    void execute(OdEdCommandContext* pCmdCtx) override;
};

// VBimSdkSelectSampleCommand — "VBIMSDK_SELECT"
//
// Runtime check of the SDK selection API: PickObjects (with a counting
// IVBimSelectionFilter), TrySetElementIds, PickElementsByRectangle,
// PickSubentity and TryShowElements, in that order. Esc skips the remaining
// picks. Prints one result line with every OdResult. Read only.
//
class VBimSdkSelectSampleCommand : public OdEdCommand
{
public:
    const OdString groupName() const override { return globalName(); }
    const OdString globalName() const override { return L"VBIMSDK_SELECT"; }

    // Runs the picks through the active document's VBimSelectionService and
    // reports the results to pCmdCtx->userIO(). No database write.
    void execute(OdEdCommandContext* pCmdCtx) override;
};

// VBimSdkViewsSampleCommand — "VBIMSDK_VIEWS"
//
// Runtime check of the SDK view API: lists GetOpenUIViews, calls ZoomToFit,
// shows that RequestViewChange is refused inside a command (eNotApplicable),
// then raises an external event that activates the next open view once the
// command has ended. Camera / view state only.
//
class VBimSdkViewsSampleCommand : public OdEdCommand
{
public:
    const OdString groupName() const override { return globalName(); }
    const OdString globalName() const override { return L"VBIMSDK_VIEWS"; }

    // Prints the open views and the OdResult of each call to pCmdCtx->userIO().
    void execute(OdEdCommandContext* pCmdCtx) override;
};

// VBimSdkUiSampleCommand — "VBIMSDK_UI"
//
// Runtime check of the SDK UI API: attaches an availability check to
// VBIMSDK_SELECT, then opens a ShowAdvanced task dialog whose command links
// show the sample dockable pane (RegisterPane + ShowPane), toggle it between
// docked and floating (GetState / SetState), or queue VBIMSDK_VIEWS with
// RequestPostCommand. Prints the results. No database write.
//
class VBimSdkUiSampleCommand : public OdEdCommand
{
public:
    const OdString groupName() const override { return globalName(); }
    const OdString globalName() const override { return L"VBIMSDK_UI"; }

    // Shows the dialog, runs the chosen action and reports to pCmdCtx->userIO().
    void execute(OdEdCommandContext* pCmdCtx) override;
};

// VBimSdkSelfTestSampleCommand — "VBIMSDK_SELFTEST"
//
// Non-interactive check of the integration SDK; prints one PASS / FAIL line
// per check to the command line (Debug builds also copy them to
// debug_VinaBIM_<NN>.txt). Needs an open model; makes no database, selection
// or camera change.
//
// Part 1 runs inside the command (events, dialog override, availability,
// post command, views, TryShowElements input checks, pane state, ribbon
// handler registration) and raises an external event twice from a worker.
// That event runs after the command ended and queues the command again with
// RequestPostCommand; the second run is part 2 and reports the ExternalEvent,
// post-command and Idling evidence.
//
class VBimSdkSelfTestSampleCommand : public OdEdCommand
{
public:
    const OdString groupName() const override { return globalName(); }
    const OdString globalName() const override { return L"VBIMSDK_SELFTEST"; }

    // Runs part 1, or part 2 when the external event of a previous part 1 has
    // already executed. UI thread only.
    void execute(OdEdCommandContext* pCmdCtx) override;
};

// VBimSdkPlaceSampleCommand — "VBIMSDK_PLACE" (Debug builds only)
//
// Structural column placement written the way a plugin DLL would write it: only
// domain/public_api + ODA. Exercises the placement API in one command:
//   - BeginTypeSelection: column types in the Properties Type Selector;
//   - vbimCreateSymbolGhost / vbimDrawSymbolGhost: family ghost at the cursor;
//   - vbimDrawListeningDimension: length and angle from the last placed column;
//   - contextual tab "Place Column": keyed Level combo (SetRibbonComboKeyedItems,
//     IVBimRibbonComboKeyHandler), Offset box (SetRibbonControlText), rotation
//     radio (SetRibbonControlChecked), Finish / Cancel (ButtonKind::CommandInput);
//   - VBimSnapScope, vbimRefreshAfterModelChange, vbimNotifyEntityPlaced.
//
class VBimSdkPlaceSampleCommand : public OdEdCommand
{
public:
    const OdString groupName() const override { return globalName(); }
    const OdString globalName() const override { return L"VBIMSDK_PLACE"; }

    // Places structural columns at clicked points until Enter, Esc, Finish or
    // Cancel; each column is one OdBmTransaction (one Undo step). The options
    // only change command state; no Host UI writes the database. Every plugin
    // handler is removed and the ghost released on every exit path. UI thread only.
    void execute(OdEdCommandContext* pCmdCtx) override;
};

#ifdef _DEBUG
#include <memory>
namespace VbimRibbon { class IRibbonTabProvider; }

// Creates the Debug-only provider of the contextual tab used by VBIMSDK_PLACE
// (Level combo, Offset box, rotation radio, Finish / Cancel). Registered by
// RibbonHostApi::LoadAll; hidden until the command shows it.
std::unique_ptr<VbimRibbon::IRibbonTabProvider> CreateVBimSdkPlaceRibbonProvider();
#endif
