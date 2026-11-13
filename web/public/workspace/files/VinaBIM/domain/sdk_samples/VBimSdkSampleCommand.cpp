// VBimSdkSampleCommand.cpp
//
// SAMPLE — NOT COMPILED INTO PRODUCTION BUILD.
//
// Required includes for an SDK-facade command:
//
//   pch.h                                     — MFC + ODA precompiled header
//   domain/sdk_samples/VBimSdkSampleCommand.h — own header
//   ExBimCommandContext.h                      — OdBmCommandContextPtr, OdBmDatabase*
//   domain/public_api/app/VBimUIApplication.h — VBimUIApplication singleton
//   domain/public_api/app/VBimUIDocument.h    — VBimUIDocument proxy
//   domain/public_api/selection/VBimSelectionService.h
//   domain/public_api/ui/VBimTaskDialogService.h
//
// NOTE: pch.h must be the very first include in every .cpp.

#include "pch.h"
#include "domain/sdk_samples/VBimSdkSampleCommand.h"

#include "ExBimCommandContext.h"   // OdBmCommandContextPtr, ->database()

#include "domain/public_api/app/VBimUIApplication.h"
#include "domain/public_api/app/VBimUIDocument.h"
#include "domain/public_api/selection/VBimSelectionService.h"
#include "domain/public_api/ui/VBimTaskDialogService.h"
#include "domain/public_api/events/VBimEventManager.h"
#include "domain/public_api/ui/VBimDockablePaneRegistry.h"
#include "domain/public_api/VBimSdk.h"
#include "Database/BmTransaction.h"
#include "Database/Compatibility/BmFilteredElementCollector.h"
#include "Database/Entities/BmDBView.h"
#include "Essential/Entities/BmLevel.h"
#include "Family/Entities/BmFamilyInstance.h"
#include "Family/Entities/BmFamilySymbol.h"
#include "Gi/GiDrawableImpl.h"
#include "Gi/GiWorldDraw.h"
#include "Gi/GiViewportDraw.h"
#include "Gs/Gs.h"
#include "Gs/GsModel.h"
#include "StaticRxObject.h"
#ifdef _DEBUG
#include "Host/ui/ribbon/RibbonDefinition.h"
#endif
#include <cwchar>

#include <atomic>
#include <thread>
#include <vector>

void VBimSdkSampleCommand::execute(OdEdCommandContext* pCmdCtx)
{
    // ── 1. Standard ODA command-context guard ──────────────────────────────
    if (!pCmdCtx)
        return;

    OdBmCommandContextPtr pDbCmdCtx(pCmdCtx);
    OdBmDatabase* pDb = pDbCmdCtx->database();
    if (!pDb)
        return;

    // ── 2. Obtain the SDK application facade ──────────────────────────────
   // VBimUIApplication& app = VBimUIApplication::Instance();

    //VBimUIDocument* uiDoc = app.ActiveUIDocument();
    //if (!uiDoc)
    //{
    //    // No document open — show error and exit.
    //    VBimTaskDialogService dlg;
    //    dlg.ShowError(L"VinaBIM SDK Sample", L"No active document.");
    //    return;
    //}

    // Refresh lai Project Browser de thay schedule moi tạo
    VBimUIApplication& app = VBimUIApplication::Instance();
    VBimUIDocument* uiDoc = app.ActiveUIDocument();
    if (!uiDoc)
    {
      ODA_TRACE1("VBimSdkSampleCommand: ActiveUIDocument is %ls\n", L"NULL");
    }
    else {
      ODA_TRACE1("VBimSdkSampleCommand: ActiveUIDocument is %ls\n", L"OK");
    }

    // uiDoc->GetDatabase() returns the same pointer as pDb when the command
    // context and the active UI document refer to the same file.
    // Always prefer the ODA command-context database inside execute() for
    // read/write operations; use GetDatabase() only for informational queries.

    // ── 3. Interactive element selection via SDK facade ────────────────────
   // VBimSelectionService* sel = uiDoc->SelectionService();
   // if (!sel)
   //     return;

   // OdBmObjectId pickedId;
   // //const bool picked = sel->PickObject(L"Select a BIM element: ", pickedId);

   // // ── 4. Report result via task dialog ──────────────────────────────────
   // VBimTaskDialogService taskDlg;

   ///* if (picked && !pickedId.isNull())
   // {
   //     taskDlg.ShowInfo(
   //         L"VinaBIM SDK Sample",
   //         L"Element selected.\n"
   //         L"Use pickedId with ODA APIs to query element properties.");
   // }
   // else
   // {
   //     taskDlg.ShowWarning(
   //         L"VinaBIM SDK Sample",
   //         L"No element selected (ESC or empty pick).");
   // }*/

   // // ── 5. Optional: point pick via SDK facade ─────────────────────────────
   // // OdGePoint3d pt;
   // // const bool gotPt = sel->PickPoint(L"Pick a point: ", pt);
   // // if (gotPt)
   // //     taskDlg.ShowInfo(L"VinaBIM SDK Sample", L"Point picked in active view.");

   // // ── 6. Optional: query current selection ──────────────────────────────
   // // OdBmObjectIdArray ids = sel->GetElementIds();
   // // // ids contains current PickFirst pre-selection.

}


// ── VBIMSDK_EVENTS ─────────────────────────────────────────────────────────

namespace {

struct EventsSampleState
{
    bool                            active = false;
    std::vector<VBimEventHandlerId> subscriptions;
    VBimExternalEventId             externalId = 0;
    std::vector<OdString>           lines;
    int                             idleTicks = 0;
    bool                            closingCancelled = false;
    DWORD                           uiThreadId = 0;
    std::atomic<int>                raiseResults[2] = { { -1 }, { -1 } };
};

EventsSampleState& SampleState()
{
    static EventsSampleState s_state;
    return s_state;
}

void AddLine(const OdString& line)
{
    SampleState().lines.push_back(line);
}

OdString TypeName(VBimEventType type)
{
    switch (type)
    {
    case VBimEventType::DocumentOpened:         return L"DocumentOpened";
    case VBimEventType::DocumentClosing:        return L"DocumentClosing";
    case VBimEventType::DocumentClosed:         return L"DocumentClosed";
    case VBimEventType::SelectionChanged:       return L"SelectionChanged";
    case VBimEventType::ViewActivating:         return L"ViewActivating";
    case VBimEventType::ViewActivated:          return L"ViewActivated";
    case VBimEventType::DocumentCreated:        return L"DocumentCreated";
    case VBimEventType::DocumentSaving:         return L"DocumentSaving";
    case VBimEventType::DocumentSaved:          return L"DocumentSaved";
    case VBimEventType::DocumentChanged:        return L"DocumentChanged";
    case VBimEventType::ApplicationInitialized: return L"ApplicationInitialized";
    case VBimEventType::ApplicationClosing:     return L"ApplicationClosing";
    case VBimEventType::Idling:                 return L"Idling";
    case VBimEventType::DialogBoxShowing:       return L"DialogBoxShowing";
    }
    return L"?";
}

// Builds the log line for one event; cancels the first cancellable close.
void OnSampleEvent(VBimEventType type, const VBimEventArgs& args)
{
    EventsSampleState& s = SampleState();
    if (type == VBimEventType::Idling)
    {
        ++s.idleTicks;
        return;
    }

    OdString detail;
    if (const auto* doc = dynamic_cast<const VBimDocumentEventArgs*>(&args))
        detail = doc->GetDocumentPath();
    else if (const auto* chg = dynamic_cast<const VBimDocumentChangedEventArgs*>(&args))
        detail.format(L"added=%d modified=%d erased=%d",
            (int)chg->AddedIds().size(), (int)chg->ModifiedIds().size(), (int)chg->ErasedIds().size());
    else if (const auto* sel = dynamic_cast<const VBimSelectionChangedEventArgs*>(&args))
        detail.format(L"count=%d", (int)sel->GetSelectedObjectIds().size());
    else if (const auto* dlg = dynamic_cast<const VBimDialogBoxShowingEventArgs*>(&args))
        detail = dlg->GetCaption();
    else if (const auto* closing = dynamic_cast<const VBimDocumentClosingEventArgs*>(&args))
    {
        const bool cancelNow = closing->IsCancellable() && !s.closingCancelled;
        if (cancelNow)
        {
            closing->SetCancel(true);
            s.closingCancelled = true;
        }
        detail.format(L"cancellable=%d cancelled=%d", closing->IsCancellable() ? 1 : 0, cancelNow ? 1 : 0);
    }

    OdString line;
    line.format(L"[%d] %ls %ls", (int)s.lines.size() + 1, TypeName(type).c_str(), detail.c_str());
    AddLine(line);
}

class SampleExternalHandler : public IVBimExternalEventHandler
{
public:
    void Execute(VBimUIApplication& /*app*/) override
    {
        EventsSampleState& s = SampleState();
        OdString line;
        line.format(L"[%d] ExternalEvent.Execute uiThread=%d raise1=%d raise2=%d",
            (int)s.lines.size() + 1,
            ::GetCurrentThreadId() == s.uiThreadId ? 1 : 0,
            s.raiseResults[0].load(), s.raiseResults[1].load());
        AddLine(line);
    }
};

SampleExternalHandler& ExternalHandler()
{
    static SampleExternalHandler s_handler;
    return s_handler;
}

void StartRecording(OdEdCommandContext* pCmdCtx)
{
    EventsSampleState& s = SampleState();
    VBimUIApplication& app = VBimUIApplication::Instance();
    VBimEventManager* events = app.EventManager();

    s.lines.clear();
    s.idleTicks = 0;
    s.closingCancelled = false;
    s.uiThreadId = ::GetCurrentThreadId();
    for (int t = (int)VBimEventType::DocumentOpened; t <= (int)VBimEventType::DialogBoxShowing; ++t)
    {
        const VBimEventType type = (VBimEventType)t;
        s.subscriptions.push_back(events->Subscribe(type,
            [type](const VBimEventArgs& args) { OnSampleEvent(type, args); }));
    }

    s.externalId = app.RegisterExternalEvent(&ExternalHandler());
    s.raiseResults[0] = -1;
    s.raiseResults[1] = -1;
    // Raised twice from a worker while this command is still running: the Host
    // must run Execute() once, on the UI thread, after the command ended.
    const VBimExternalEventId id = s.externalId;
    std::thread([id]() {
        EventsSampleState& st = SampleState();
        st.raiseResults[0] = (int)VBimUIApplication::Instance().RaiseExternalEvent(id);
        st.raiseResults[1] = (int)VBimUIApplication::Instance().RaiseExternalEvent(id);
    }).join();

    s.active = true;
    CString started;
    started.LoadString(IDS_VBIMSDK_EVENTS_STARTED);
    pCmdCtx->userIO()->putString(OdString((LPCTSTR)started));
}

void StopRecording(OdEdCommandContext* pCmdCtx)
{
    EventsSampleState& s = SampleState();
    VBimUIApplication& app = VBimUIApplication::Instance();
    for (VBimEventHandlerId id : s.subscriptions)
        app.EventManager()->Unsubscribe(id);
    s.subscriptions.clear();
    app.UnregisterExternalEvent(s.externalId);
    s.externalId = 0;
    s.active = false;

    // The command line shows only the last line; Debug builds also copy the
    // log to %APPDATA%\VinaBIM\debug_VinaBIM_<NN>.txt. Release writes nothing.
    for (const OdString& line : s.lines)
    {
        pCmdCtx->userIO()->putString(line);
        LOG_DEBUG(CString(L"[VBIMSDK_EVENTS] ") + line.c_str());
    }
    CString format;
    format.LoadString(IDS_VBIMSDK_EVENTS_STOPPED_FMT);
    CString summary;
    summary.Format(format, (int)s.lines.size(), s.idleTicks);
    pCmdCtx->userIO()->putString(OdString((LPCTSTR)summary));
    LOG_DEBUG(CString(L"[VBIMSDK_EVENTS] ") + summary);
}

} // namespace

void VBimSdkEventsSampleCommand::execute(OdEdCommandContext* pCmdCtx)
{
    if (!pCmdCtx)
        return;
    if (SampleState().active)
        StopRecording(pCmdCtx);
    else
        StartRecording(pCmdCtx);
}

// ── Shared helpers for the integration samples ─────────────────────────────

namespace {

OdString LoadOd(UINT id)
{
    CString text;
    text.LoadString(id);
    return OdString((LPCTSTR)text);
}

void PutFormatted(OdEdCommandContext* pCmdCtx, const CString& text)
{
    pCmdCtx->userIO()->putString(OdString((LPCTSTR)text));
}

} // namespace

// ── VBIMSDK_SELECT ─────────────────────────────────────────────────────────

namespace {

// Accepts everything and counts how often the Host consulted it.
class CountingSelectionFilter : public IVBimSelectionFilter
{
public:
    int calls = 0;

    bool AllowElement(const OdBmObjectId& /*id*/) override
    {
        ++calls;
        return true;
    }

    bool AllowReference(const VBimReference& /*reference*/, const OdGePoint3d& /*position*/) override
    {
        ++calls;
        return true;
    }
};

} // namespace

void VBimSdkSelectSampleCommand::execute(OdEdCommandContext* pCmdCtx)
{
    if (!pCmdCtx)
        return;
    VBimUIDocument* doc = VBimUIApplication::Instance().ActiveUIDocument();
    VBimSelectionService* sel = doc ? doc->SelectionService() : nullptr;
    if (!sel)
        return;

    CountingSelectionFilter filter;
    OdBmObjectIdArray picked;
    const bool rPick = sel->PickObjects(VBimObjectType::Element,
        LoadOd(IDS_VBIMSDK_SEL_PICK_OBJECTS), picked, &filter);

    bool rRect = false;
    bool rFace = false;
    OdResult rShow = eNotApplicable;
    OdBmObjectIdArray boxed;
    int subentType = -1;
    if (rPick)
    {
        sel->SetElementIds(picked);
        rRect = sel->PickElementsByRectangle(LoadOd(IDS_VBIMSDK_SEL_PICK_RECT), boxed, &filter);
    }
    if (rRect)
    {
        VBimReference reference;
        rFace = sel->PickObject(VBimObjectType::Face, LoadOd(IDS_VBIMSDK_SEL_PICK_FACE), reference, &filter);
        if (rFace)
            subentType = static_cast<int>(reference.subentType);
    }
    if (!picked.isEmpty())
        rShow = doc->TryShowElements(picked);

    CString format;
    format.LoadString(IDS_VBIMSDK_SEL_RESULT_FMT);
    CString text;
    text.Format(format, static_cast<int>(rPick), static_cast<int>(picked.size()), filter.calls,
        static_cast<int>(rRect), static_cast<int>(boxed.size()),
        static_cast<int>(rFace), subentType, static_cast<int>(rShow));
    PutFormatted(pCmdCtx, text);
}

// ── VBIMSDK_VIEWS ──────────────────────────────────────────────────────────

namespace {

// Activates target once the command that raised the event has ended; view
// changes are refused while a command runs.
class NextViewHandler : public IVBimExternalEventHandler
{
public:
    OdBmObjectId target;

    void Execute(VBimUIApplication& app) override
    {
        VBimUIDocument* doc = app.ActiveUIDocument();
        if (doc && !target.isNull())
            doc->RequestViewChange(target);
        target = OdBmObjectId();
    }
};

NextViewHandler     s_nextView;
VBimExternalEventId s_nextViewEventId = 0;

} // namespace

void VBimSdkViewsSampleCommand::execute(OdEdCommandContext* pCmdCtx)
{
    if (!pCmdCtx)
        return;
    VBimUIApplication& app = VBimUIApplication::Instance();
    VBimUIDocument* doc = app.ActiveUIDocument();
    if (!doc)
        return;

    OdArray<VBimView> views;
    doc->GetOpenUIViews(views);
    CString itemFormat;
    itemFormat.LoadString(IDS_VBIMSDK_VIEWS_ITEM_FMT);
    for (const VBimView& view : views)
    {
        CString line;
        line.Format(itemFormat, view.viewName.c_str());
        PutFormatted(pCmdCtx, line);
    }

    const OdResult rZoom = doc->ZoomToFit();

    const VBimView active = doc->ActiveView();
    OdBmObjectId next = active.viewId;
    for (const VBimView& view : views)
    {
        if (view.viewId != active.viewId)
        {
            next = view.viewId;
            break;
        }
    }
    const OdResult rInside = doc->RequestViewChange(next);
    if (!next.isNull())
    {
        if (s_nextViewEventId == 0)
            s_nextViewEventId = app.RegisterExternalEvent(&s_nextView);
        s_nextView.target = next;
        app.RaiseExternalEvent(s_nextViewEventId);
    }

    CString format;
    format.LoadString(IDS_VBIMSDK_VIEWS_RESULT_FMT);
    CString text;
    text.Format(format, static_cast<int>(views.size()), static_cast<int>(rZoom),
        static_cast<int>(rInside), static_cast<int>(eNotApplicable));
    PutFormatted(pCmdCtx, text);
}

// ── VBIMSDK_UI ─────────────────────────────────────────────────────────────

namespace {

const wchar_t* const kSamplePaneId = L"VinaBIM.SdkSamplePane";

// VBIMSDK_SELECT needs an active view to pick in.
class SelectSampleAvailability : public IVBimCommandAvailability
{
public:
    bool IsCommandAvailable(VBimUIApplication& app) const override
    {
        VBimUIDocument* doc = app.ActiveUIDocument();
        return doc && doc->ActiveView().IsValid();
    }
};

// Minimal pane content: one static text child sized to the shell.
class SamplePaneProvider : public IVBimDockablePaneProvider
{
public:
    void* CreateNativeWindow(void* parentWindow) override
    {
        const HWND hParent = static_cast<HWND>(parentWindow);
        RECT rc = {};
        ::GetClientRect(hParent, &rc);
        CString text;
        text.LoadString(IDS_VBIMSDK_UI_PANE_TEXT);
        return ::CreateWindowExW(0, L"STATIC", text, WS_CHILD | WS_VISIBLE | SS_LEFT,
            0, 0, rc.right - rc.left, rc.bottom - rc.top, hParent, nullptr,
            AfxGetInstanceHandle(), nullptr);
    }
};

SelectSampleAvailability s_selectAvailability;
SamplePaneProvider       s_paneProvider;

OdResult ShowSamplePane(VBimDockablePaneRegistry* panes)
{
    const OdString id(kSamplePaneId);
    if (!panes->GetPane(id).IsValid())
    {
        VBimDockablePaneDescriptor desc;
        desc.id              = id;
        desc.title           = LoadOd(IDS_VBIMSDK_UI_PANE_TITLE);
        desc.defaultDockSide = L"Right";
        if (!panes->RegisterPane(desc, &s_paneProvider))
            return eNotApplicable;
    }
    return panes->ShowPane(id) ? eOk : eNotApplicable;
}

OdResult ToggleSamplePaneFloating(VBimDockablePaneRegistry* panes)
{
    VBimPaneState state;
    const OdResult res = panes->GetState(OdString(kSamplePaneId), state);
    if (res != eOk)
        return res;
    state.floating = !state.floating;
    return panes->SetState(OdString(kSamplePaneId), state);
}

} // namespace

void VBimSdkUiSampleCommand::execute(OdEdCommandContext* pCmdCtx)
{
    if (!pCmdCtx)
        return;
    VBimUIApplication& app = VBimUIApplication::Instance();
    app.SetCommandAvailability(L"VBIMSDK_SELECT", &s_selectAvailability);

    VBimTaskDialogOptions options;
    options.title            = LoadOd(IDS_VBIMSDK_UI_TITLE);
    options.mainInstruction  = LoadOd(IDS_VBIMSDK_UI_INSTRUCTION);
    options.content          = LoadOd(IDS_VBIMSDK_UI_CONTENT);
    options.expandedContent  = LoadOd(IDS_VBIMSDK_UI_EXPANDED);
    options.footer           = LoadOd(IDS_VBIMSDK_UI_FOOTER);
    options.verificationText = LoadOd(IDS_VBIMSDK_UI_VERIFY);
    options.commandLinks[0]  = LoadOd(IDS_VBIMSDK_UI_LINK_PANE);
    options.commandLinks[1]  = LoadOd(IDS_VBIMSDK_UI_LINK_FLOAT);
    options.commandLinks[2]  = LoadOd(IDS_VBIMSDK_UI_LINK_POST);
    options.commonButtons    = kVBimTaskDialogCancel;
    options.icon             = VBimTaskDialogIcon::Information;

    VBimTaskDialogResponse response;
    const OdResult rDialog = app.TaskDialogService()->ShowAdvanced(options, response);

    OdResult rAction = eOk;
    switch (response.result)
    {
    case VBimTaskDialogResult::CommandLink1:
        rAction = ShowSamplePane(app.DockablePaneRegistry());
        break;
    case VBimTaskDialogResult::CommandLink2:
        rAction = ToggleSamplePaneFloating(app.DockablePaneRegistry());
        break;
    case VBimTaskDialogResult::CommandLink3:
        rAction = app.RequestPostCommand(L"VBIMSDK_VIEWS");
        break;
    default:
        break;
    }

    CString format;
    format.LoadString(IDS_VBIMSDK_UI_RESULT_FMT);
    CString text;
    text.Format(format, static_cast<int>(rDialog), static_cast<int>(response.result),
        response.verificationChecked ? 1 : 0, static_cast<int>(rAction),
        app.IsCommandAvailable(L"VBIMSDK_SELECT") ? 1 : 0);
    PutFormatted(pCmdCtx, text);
}

// ── VBIMSDK_SELFTEST ───────────────────────────────────────────────────────

namespace {

const wchar_t* const kSelfTestCommand = L"VBIMSDK_SELFTEST";
const wchar_t* const kSelfTestPaneId  = L"VinaBIM.SdkSelfTestPane";

// Results of one self-test run. Part 1 fills it inside the command; the
// external event and Idling handlers add evidence after the command ended;
// part 2 (the same command, re-run through RequestPostCommand) reports it.
struct SelfTestState
{
    bool                phase2Pending   = false;
    VBimExternalEventId eventId         = 0;
    VBimEventHandlerId  idlingHandlerId = 0;
    std::atomic<int>    raiseResults[2] = { { -1 }, { -1 } };
    int                 executeCount    = 0;
    bool                executeOnUiThread = false;
    int                 postFromEventResult = -1;
    int                 idleTicks       = 0;
    DWORD               uiThreadId      = 0;
};

SelfTestState& SelfTest()
{
    static SelfTestState s_state;
    return s_state;
}

class SelfTestReporter
{
public:
    explicit SelfTestReporter(OdEdCommandContext* pCmdCtx) : m_pCmdCtx(pCmdCtx) {}

    void Check(const wchar_t* name, bool ok, const OdString& detail = OdString::kEmpty)
    {
        ok ? ++passed : ++failed;
        OdString line;
        line.format(L"%ls %ls %ls", ok ? L"PASS" : L"FAIL", name, detail.c_str());
        m_pCmdCtx->userIO()->putString(line);
        LOG_DEBUG(CString(L"[VBIMSDK_SELFTEST] ") + line.c_str());
    }

    int passed = 0;
    int failed = 0;

private:
    OdEdCommandContext* m_pCmdCtx;
};

OdString ResultText(int value)
{
    OdString text;
    text.format(L"(OdResult %d)", value);
    return text;
}

class SelfTestExternalHandler : public IVBimExternalEventHandler
{
public:
    void Execute(VBimUIApplication& app) override
    {
        SelfTestState& s = SelfTest();
        ++s.executeCount;
        s.executeOnUiThread = ::GetCurrentThreadId() == s.uiThreadId;
        // Part 2 is queued from here so it runs strictly after this callback.
        s.postFromEventResult = static_cast<int>(app.RequestPostCommand(kSelfTestCommand));
    }
};

SelfTestExternalHandler& SelfTestHandler()
{
    static SelfTestExternalHandler s_handler;
    return s_handler;
}

class SelfTestUnavailable : public IVBimCommandAvailability
{
public:
    bool IsCommandAvailable(VBimUIApplication& /*app*/) const override { return false; }
};

// Never shown by the self-test, so it never creates a window.
class SelfTestPaneProvider : public IVBimDockablePaneProvider
{
public:
    void* CreateNativeWindow(void* /*parentWindow*/) override { return nullptr; }
};

class NullRibbonHandler : public VBimRibbon::IVBimRibbonControlHandler
{
public:
    void OnValueChanged(const OdString& /*controlId*/, const OdString& /*value*/) override {}
};

void RunSelfTestPart1(OdEdCommandContext* pCmdCtx)
{
    VBimUIApplication& app = VBimUIApplication::Instance();
    SelfTestState& s = SelfTest();
    SelfTestReporter r(pCmdCtx);
    s.uiThreadId = ::GetCurrentThreadId();

    // Events
    VBimEventManager* events = app.EventManager();
    const VBimEventHandlerId probe = events->Subscribe(VBimEventType::DocumentChanged,
        [](const VBimEventArgs&) {});
    r.Check(L"Events.Subscribe", probe != 0);
    events->Unsubscribe(probe);
    r.Check(L"Events.SubscribeNullRejected",
        events->Subscribe(VBimEventType::Idling, std::function<void(const VBimEventArgs&)>()) == 0);

    // DialogBoxShowing override: ShowAdvanced must return without showing a dialog.
    const VBimEventHandlerId dialogProbe = events->Subscribe(VBimEventType::DialogBoxShowing,
        [](const VBimEventArgs& args) {
            if (const auto* dlg = dynamic_cast<const VBimDialogBoxShowingEventArgs*>(&args))
                dlg->OverrideResult(IDOK);
        });
    VBimTaskDialogOptions dialogOptions;
    dialogOptions.mainInstruction = kSelfTestCommand;
    VBimTaskDialogResponse dialogResponse;
    const OdResult rDialog = app.TaskDialogService()->ShowAdvanced(dialogOptions, dialogResponse);
    events->Unsubscribe(dialogProbe);
    r.Check(L"Dialog.ShowAdvancedOverridden",
        rDialog == eOk && dialogResponse.result == VBimTaskDialogResult::Ok, ResultText(rDialog));
    VBimTaskDialogOptions emptyOptions;
    r.Check(L"Dialog.ShowAdvancedEmptyRejected",
        app.TaskDialogService()->ShowAdvanced(emptyOptions, dialogResponse) == eInvalidInput);

    // Availability and post command
    static SelfTestUnavailable s_unavailable;
    r.Check(L"Availability.UnknownCommandRejected",
        app.SetCommandAvailability(L"VBIMSDK_NO_SUCH_COMMAND", &s_unavailable) == eInvalidInput);
    app.SetCommandAvailability(kSelfTestCommand, &s_unavailable);
    const bool hiddenWhenUnavailable = !app.IsCommandAvailable(kSelfTestCommand);
    app.SetCommandAvailability(kSelfTestCommand, nullptr);
    r.Check(L"Availability.CheckApplied", hiddenWhenUnavailable);
    r.Check(L"Availability.CheckRemoved", app.IsCommandAvailable(kSelfTestCommand));
    r.Check(L"PostCommand.RefusedWhileBusy", !app.CanPostCommand(kSelfTestCommand));
    r.Check(L"PostCommand.RequestUnknownRejected",
        app.RequestPostCommand(L"VBIMSDK_NO_SUCH_COMMAND") == eInvalidInput);

    // Document / view (read only; no selection or camera change)
    VBimUIDocument* doc = app.ActiveUIDocument();
    if (doc)
    {
        OdArray<VBimView> views;
        const OdResult rViews = doc->GetOpenUIViews(views);
        r.Check(L"View.GetOpenUIViews", rViews == eOk && !views.isEmpty(), ResultText(rViews));
        r.Check(L"View.RequestViewChangeRefusedInCommand",
            doc->RequestViewChange(doc->ActiveView().viewId) == eNotApplicable);
        r.Check(L"Selection.TryShowElementsEmptyRejected",
            doc->TryShowElements(OdBmObjectIdArray()) == eInvalidInput);
        OdBmObjectIdArray nullIds;
        nullIds.append(OdBmObjectId());
        r.Check(L"Selection.TryShowElementsNullIdRejected",
            doc->TryShowElements(nullIds) == eInvalidInput);
    }
    else
    {
        r.Check(L"Document.Active", false, L"open a model and run the self-test again");
    }

    // Dockable pane state (registered but never shown: no window is created)
    VBimDockablePaneRegistry* panes = app.DockablePaneRegistry();
    VBimPaneState paneState;
    r.Check(L"Pane.GetStateUnknownRejected",
        panes->GetState(L"VinaBIM.NoSuchPane", paneState) == eInvalidInput);
    static SelfTestPaneProvider s_paneProvider;
    if (!panes->GetPane(kSelfTestPaneId).IsValid())
    {
        VBimDockablePaneDescriptor desc;
        desc.id              = kSelfTestPaneId;
        desc.title           = LoadOd(IDS_VBIMSDK_SELFTEST_PANE_TITLE);
        desc.defaultDockSide = L"Right";
        panes->RegisterPane(desc, &s_paneProvider);
    }
    VBimPaneState wanted;
    wanted.title    = LoadOd(IDS_VBIMSDK_SELFTEST_PANE_TITLE);
    wanted.side     = VBimDockSide::Left;
    wanted.floating = false;
    const OdResult rSet = panes->SetState(kSelfTestPaneId, wanted);
    const OdResult rGet = panes->GetState(kSelfTestPaneId, paneState);
    r.Check(L"Pane.SetGetStateRoundTrip",
        rSet == eOk && rGet == eOk && paneState.side == VBimDockSide::Left && !paneState.floating);

    // Ribbon value-control handler registration
    static NullRibbonHandler s_ribbonHandler;
    r.Check(L"Ribbon.HandlerEmptyIdRejected",
        app.RegisterRibbonControlHandler(OdString::kEmpty, &s_ribbonHandler) == eInvalidInput);
    r.Check(L"Ribbon.HandlerRegisterRemove",
        app.RegisterRibbonControlHandler(L"SDKSELFTEST_CONTROL", &s_ribbonHandler) == eOk
        && app.RegisterRibbonControlHandler(L"SDKSELFTEST_CONTROL", nullptr) == eOk);

    // ExternalEvent: evidence for part 2
    r.Check(L"ExternalEvent.UnknownIdRejected", app.RaiseExternalEvent(0) == eNotApplicable);
    if (s.eventId == 0)
        s.eventId = app.RegisterExternalEvent(&SelfTestHandler());
    r.Check(L"ExternalEvent.Register", s.eventId != 0);
    r.Check(L"ExternalEvent.DuplicateRejected", app.RegisterExternalEvent(&SelfTestHandler()) == 0);
    s.executeCount = 0;
    s.executeOnUiThread = false;
    s.postFromEventResult = -1;
    s.idleTicks = 0;
    s.raiseResults[0] = -1;
    s.raiseResults[1] = -1;
    // Part 1 re-runs when part 2 never came (re-invoked early, or the raise
    // failed); drop the earlier Idling handler so it does not outlive the test.
    if (s.idlingHandlerId != 0)
    {
        events->Unsubscribe(s.idlingHandlerId);
        s.idlingHandlerId = 0;
    }
    s.idlingHandlerId = events->Subscribe(VBimEventType::Idling,
        [](const VBimEventArgs&) { ++SelfTest().idleTicks; });
    const VBimExternalEventId id = s.eventId;
    std::thread([id]() {
        SelfTestState& st = SelfTest();
        st.raiseResults[0] = static_cast<int>(VBimUIApplication::Instance().RaiseExternalEvent(id));
        st.raiseResults[1] = static_cast<int>(VBimUIApplication::Instance().RaiseExternalEvent(id));
    }).join();
    s.phase2Pending = true;

    CString format;
    format.LoadString(IDS_VBIMSDK_SELFTEST_PHASE1_FMT);
    CString summary;
    summary.Format(format, r.passed, r.failed);
    PutFormatted(pCmdCtx, summary);
}

void RunSelfTestPart2(OdEdCommandContext* pCmdCtx)
{
    VBimUIApplication& app = VBimUIApplication::Instance();
    SelfTestState& s = SelfTest();
    SelfTestReporter r(pCmdCtx);
    s.phase2Pending = false;
    app.EventManager()->Unsubscribe(s.idlingHandlerId);
    s.idlingHandlerId = 0;

    OdString raised;
    raised.format(L"(raise1=%d raise2=%d)", s.raiseResults[0].load(), s.raiseResults[1].load());
    r.Check(L"ExternalEvent.RaiseFromWorker",
        s.raiseResults[0].load() == eOk && s.raiseResults[1].load() == eOk, raised);
    OdString count;
    count.format(L"(Execute ran %d times)", s.executeCount);
    r.Check(L"ExternalEvent.ExecutedOnceAfterCommand", s.executeCount == 1, count);
    r.Check(L"ExternalEvent.ExecutedOnUiThread", s.executeOnUiThread);
    r.Check(L"PostCommand.RequestFromExternalEvent", s.postFromEventResult == eOk,
        ResultText(s.postFromEventResult));
    OdString ticks;
    ticks.format(L"(%d idle ticks)", s.idleTicks);
    r.Check(L"Events.IdlingDelivered", s.idleTicks > 0, ticks);

    CString format;
    format.LoadString(IDS_VBIMSDK_SELFTEST_PHASE2_FMT);
    CString summary;
    summary.Format(format, r.passed, r.failed);
    PutFormatted(pCmdCtx, summary);
}

} // namespace

void VBimSdkSelfTestSampleCommand::execute(OdEdCommandContext* pCmdCtx)
{
    if (!pCmdCtx)
        return;
    if (SelfTest().phase2Pending && SelfTest().executeCount > 0)
        RunSelfTestPart2(pCmdCtx);
    else
        RunSelfTestPart1(pCmdCtx);
}

// ---------------------------------------------------------------------------
// VBIMSDK_PLACE — placement API sample (public_api + ODA only)
// ---------------------------------------------------------------------------
namespace {

const wchar_t* const kPlaceContext  = L"VinaBIM.SdkPlaceSample";
const wchar_t* const kPlaceLevel    = L"VBIMSDK_PLACE_LEVEL";
const wchar_t* const kPlaceOffset   = L"VBIMSDK_PLACE_OFFSET";
const wchar_t* const kPlaceRotation = L"VBIMSDK_PLACE_ROTATION";
const wchar_t* const kPlaceRot0     = L"VBIMSDK_PLACE_ROT_0";
const wchar_t* const kPlaceRot90    = L"VBIMSDK_PLACE_ROT_90";
const wchar_t* const kPlaceFinish   = L"Finish";
const wchar_t* const kPlaceCancel   = L"Cancel";
constexpr double kPlaceMmPerFoot    = 304.8;
constexpr double kPlaceHalfPi       = 1.57079632679489661923;

struct PlaceState
{
    OdBmDatabasePtr   pDb;
    OdBmObjectId      symbol;
    OdBmObjectId      level;
    double            levelElevation = 0.0;
    double            offsetFeet = 0.0;
    double            rotation = 0.0;
    VBimSymbolGhostId ghost = 0;
    OdBm::StructuralType::Enum structuralType = OdBm::StructuralType::Column;
    bool              hasCursor = false;
    OdGePoint3d       cursor;
    bool              hasLast = false;
    OdGePoint3d       last;
};

OdString HandleKey(const OdBmObjectId& id)
{
    return OdString().format(L"%llu", static_cast<unsigned long long>(static_cast<OdUInt64>(id)));
}

OdGePoint3d OnLevel(const PlaceState& state, OdGePoint3d point)
{
    point.z = state.levelElevation + state.offsetFeet;
    return point;
}

OdGeMatrix3d GhostPlacement(const PlaceState& state)
{
    return OdGeMatrix3d::translation(state.cursor.asVector())
        * OdGeMatrix3d::rotation(state.rotation, OdGeVector3d::kZAxis);
}

void SetLevel(PlaceState& state, const OdBmObjectId& level)
{
    const OdBmLevelPtr pLevel = OdBmLevel::cast(level.openObject());
    if (pLevel.isNull())
        return;
    state.level = level;
    state.levelElevation = pLevel->getElevation();
}

void RebuildGhost(PlaceState& state)
{
    vbimReleaseSymbolGhost(state.ghost);
    state.ghost = 0;
    vbimCreateSymbolGhost(state.symbol, state.ghost);
}

// Ghost at the cursor (world draw) and listening dimension from the last
// column (viewport draw, constant pixel size). Owns the command state.
class PlacePreviewDrawable : public OdGiDrawableImpl<>
{
public:
    PlaceState m_state;

    OdUInt32 subSetAttributes(OdGiDrawableTraits* /*pTraits*/) const override
    {
        return m_state.hasCursor ? kDrawableRegenDraw : kDrawableIsInvisible;
    }

    bool subWorldDraw(OdGiWorldDraw* pWd) const override
    {
        if (m_state.hasCursor)
            vbimDrawSymbolGhost(m_state.ghost, pWd, GhostPlacement(m_state));
        return false;  // also run subViewportDraw for the dimension
    }

    void subViewportDraw(OdGiViewportDraw* pVd) const override
    {
        if (!m_state.hasCursor || !m_state.hasLast)
            return;
        OdBmDatabasePtr pDb = m_state.pDb;  // non-const copy: the formatter is not const
        vbimDrawListeningDimension(pVd, m_state.last, m_state.cursor, pDb.get());
    }
};

// Point tracker that owns the preview drawable and a direct GS model for it
// (the ExTrackers GraphTrackerBase pattern of the ODA samples).
class PlaceTracker : public OdEdPointTracker
{
public:
    OdStaticRxObject<PlacePreviewDrawable> m_drawable;
    OdGsModelPtr m_pModel;

    PlaceState& State() { return m_drawable.m_state; }

    void setValue(const OdGePoint3d& point) override
    {
        PlaceState& state = State();
        state.cursor = OnLevel(state, point);
        state.hasCursor = true;
        OdGePoint3d minimum, maximum;
        if (vbimSymbolGhostExtents(state.ghost, GhostPlacement(state), minimum, maximum))
            vbimSetVbimSnapScopePreviewBounds(minimum, maximum, true);
        if (!m_pModel.isNull())
            m_pModel->onModified(&m_drawable, static_cast<OdGiDrawable*>(nullptr));
    }

    int addDrawables(OdGsView* pView) override
    {
        if (!pView || !pView->device())
            return 0;
        if (m_pModel.isNull())
        {
            m_pModel = pView->device()->createModel();
            if (!m_pModel.isNull())
            {
                m_pModel->setRenderType(OdGsModel::kDirect);
                m_pModel->setEnableViewExtentsCalculation(false);
            }
        }
        pView->add(&m_drawable, m_pModel.get());
        return 1;
    }

    // OdGsView::erase reports whether the drawable was attached; nothing to do either way.
    void removeDrawables(OdGsView* pView) override
    {
        if (pView)
            pView->erase(&m_drawable);
    }
};

class PlaceTypeHandler : public IVBimTypeSelectorHandler
{
public:
    explicit PlaceTypeHandler(PlaceState& state) : m_state(state) {}

    void OnTypeChanged(const OdBmObjectId& typeId) override
    {
        m_state.symbol = typeId;
        RebuildGhost(m_state);
        vbimRefreshActiveJigPreview();
    }

private:
    PlaceState& m_state;
};

// Offset box (millimetres) and rotation radio group.
class PlaceValueHandler : public VBimRibbon::IVBimRibbonControlHandler
{
public:
    explicit PlaceValueHandler(PlaceState& state) : m_state(state) {}

    void OnValueChanged(const OdString& controlId, const OdString& value) override
    {
        if (controlId == kPlaceOffset)
            m_state.offsetFeet = std::wcstod(value.c_str(), nullptr) / kPlaceMmPerFoot;
        else if (controlId == kPlaceRotation)
            m_state.rotation = value == kPlaceRot90 ? kPlaceHalfPi : 0.0;
        vbimRefreshActiveJigPreview();
    }

private:
    PlaceState& m_state;
};

// Level combo: the key is the level handle, so equal names stay distinct.
class PlaceLevelHandler : public VBimRibbon::IVBimRibbonComboKeyHandler
{
public:
    PlaceLevelHandler(PlaceState& state, const OdBmObjectIdArray& levels) : m_state(state), m_levels(levels) {}

    void OnComboKeyChanged(const OdString& /*controlId*/, const OdString& key) override
    {
        for (const OdBmObjectId& level : m_levels)
        {
            if (HandleKey(level) == key)
            {
                SetLevel(m_state, level);
                break;
            }
        }
        vbimRefreshActiveJigPreview();
    }

private:
    PlaceState& m_state;
    const OdBmObjectIdArray& m_levels;
};

// Removes every handler this command attached and releases its ghost, on every
// exit path (Finish, Esc, Cancel, error).
class PlaceUiScope
{
public:
    PlaceUiScope(PlaceState& state, PlaceValueHandler* pValues, PlaceLevelHandler* pLevels) : m_state(state)
    {
        VBimUIApplication& app = VBimUIApplication::Instance();
        app.RegisterRibbonControlHandler(kPlaceOffset, pValues);
        app.RegisterRibbonControlHandler(kPlaceRotation, pValues);
        app.RegisterRibbonComboKeyHandler(kPlaceLevel, pLevels);
    }

    ~PlaceUiScope()
    {
        VBimUIApplication& app = VBimUIApplication::Instance();
        app.RegisterRibbonControlHandler(kPlaceOffset, nullptr);
        app.RegisterRibbonControlHandler(kPlaceRotation, nullptr);
        app.RegisterRibbonComboKeyHandler(kPlaceLevel, nullptr);
        app.EndTypeSelection();
        app.ShowContextualTab(kPlaceContext, false);
        vbimReleaseSymbolGhost(m_state.ghost);
        m_state.ghost = 0;
    }

    PlaceUiScope(const PlaceUiScope&) = delete;
    PlaceUiScope& operator=(const PlaceUiScope&) = delete;

private:
    PlaceState& m_state;
};

// Family symbols (types) of a category loaded in the model.
OdBmObjectIdArray CollectSymbols(OdBmDatabasePtr pDb, OdBm::BuiltInCategory::Enum category)
{
    OdBmObjectIdArray ids;
    try
    {
        const OdBmElementPtrArray symbols = OdBmFilteredElementCollector(pDb)
            .ofClass(OdBmFamilySymbol::desc())
            .ofCategory(category)
            .whereElementIsElementType()
            .collect();
        for (const OdBmElementPtr& symbol : symbols)
        {
            if (!symbol.isNull())
                ids.push_back(symbol->objectId());
        }
    }
    catch (const OdError& err)
    {
        LOG(err.description().c_str());
    }
    return ids;
}

// Debug-only evidence: which placement step returned what (rule 73).
void LogPlaceStep(const wchar_t* step, OdResult res)
{
    LOG_DEBUG(CString(OdString().format(L"[VBIMSDK_PLACE] %ls -> OdResult %d", step, static_cast<int>(res)).c_str()));
}

// Activates the symbol in its own committed transaction, as the ODA sample
// BmFamilyInstanceCmd does before creating the instance in a second one.
bool ActivateSymbol(PlaceState& state)
{
    OdBmTransaction transaction(state.pDb.get());
    transaction.start();
    try
    {
        OdBmFamilySymbolPtr pSymbol = OdBmFamilySymbol::cast(state.symbol.openObject());
        const OdResult res = pSymbol.isNull() ? eInvalidInput : pSymbol->activate();
        LogPlaceStep(L"activate", res);
        if (res == eAlreadyActive)
        {
            // A symbol already used in the model reports eAlreadyActive; nothing changed.
            transaction.rollback();
            return true;
        }
        if (res != eOk)
        {
            transaction.rollback();
            return false;
        }
        transaction.commit();
        return true;
    }
    catch (const OdError& err)
    {
        transaction.rollback();
        LOG_DEBUG(CString(L"[VBIMSDK_PLACE] activate threw: ") + err.description().c_str());
        LOG(err.description().c_str());
        return false;
    }
}

// One column per call, in its own transaction (one Undo step).
bool PlaceColumn(PlaceState& state, const OdGePoint3d& location, OdBmObjectId& placedId)
{
    if (!ActivateSymbol(state))
        return false;
    OdBmTransaction transaction(state.pDb.get());
    transaction.start();
    try
    {
        OdBmFamilyInstancePtr pInstance = OdBmFamilyInstance::createObject();
        OdResult res = state.pDb->addElement(pInstance, placedId);
        LogPlaceStep(L"addElement", res);
        if (res == eOk)
        {
            res = pInstance->set(location, state.symbol, state.structuralType, state.level);
            LogPlaceStep(L"set", res);
        }
        if (res == eOk && state.rotation != 0.0)
        {
            res = pInstance->setRotation(state.rotation, OdGeVector3d::kZAxis, location);
            LogPlaceStep(L"setRotation", res);
        }
        if (res != eOk)
        {
            transaction.rollback();
            return false;
        }
        transaction.commit();
        return true;
    }
    catch (const OdError& err)
    {
        transaction.rollback();
        LOG_DEBUG(CString(L"[VBIMSDK_PLACE] placement threw: ") + err.description().c_str());
        LOG(err.description().c_str());
        return false;
    }
}

} // namespace

void VBimSdkPlaceSampleCommand::execute(OdEdCommandContext* pCmdCtx)
{
    OdBmCommandContextPtr pDbCmdCtx(pCmdCtx);
    OdSmartPtr<OdBmUserIO> pIO = pDbCmdCtx->userIO();
    OdStaticRxObject<PlaceTracker> tracker;
    PlaceState& state = tracker.State();
    state.pDb = pDbCmdCtx->database();
    if (state.pDb.isNull() || pIO.isNull())
        return;

    // Every loaded column type: structural first, architectural columns otherwise.
    // (ElementTrackingData returned nothing on a model with loaded column types.)
    OdBmObjectIdArray symbols = CollectSymbols(state.pDb, OdBm::BuiltInCategory::OST_StructuralColumns);
    if (symbols.isEmpty())
    {
        symbols = CollectSymbols(state.pDb, OdBm::BuiltInCategory::OST_Columns);
        state.structuralType = OdBm::StructuralType::NonStructural;
    }
    if (symbols.isEmpty())
    {
        pIO->putString(LoadOd(IDS_VBIMSDK_PLACE_NO_SYMBOL));
        return;
    }

    OdBmObjectIdArray levels;
    std::vector<OdString> levelKeys;
    std::vector<OdString> levelNames;
    for (const OdBmElementPtr& level : OdBmFilteredElementCollector(state.pDb).ofClass(OdBmLevel::desc()).collect())
    {
        if (level.isNull())
            continue;
        levels.push_back(level->objectId());
        levelKeys.push_back(HandleKey(level->objectId()));
        levelNames.push_back(level->getElementName());
    }
    if (levels.isEmpty())
    {
        pIO->putString(LoadOd(IDS_VBIMSDK_PLACE_NO_LEVEL));
        return;
    }

    // Level of the active plan view, else the first level.
    OdBmObjectId startLevel = levels.first();
    if (VBimUIDocument* pUiDoc = VBimUIApplication::Instance().ActiveUIDocument())
    {
        const VBimView view = pUiDoc->ActiveView();
        const OdBmDBViewPtr pView = view.IsValid() ? OdBmDBView::cast(view.viewId.openObject()) : OdBmDBViewPtr();
        if (!pView.isNull() && levels.contains(pView->getGenElemId()))
            startLevel = pView->getGenElemId();
    }
    SetLevel(state, startLevel);
    state.symbol = symbols.first();

    PlaceTypeHandler typeHandler(state);
    PlaceValueHandler valueHandler(state);
    PlaceLevelHandler levelHandler(state, levels);
    PlaceUiScope uiScope(state, &valueHandler, &levelHandler);

    VBimUIApplication& app = VBimUIApplication::Instance();
    const OdResult typeResult = app.BeginTypeSelection(symbols, state.symbol, &typeHandler);
    const OdResult tabResult = app.ShowContextualTab(kPlaceContext, true);
    const OdResult levelResult = app.SetRibbonComboKeyedItems(kPlaceLevel, levelKeys, levelNames, HandleKey(state.level));
    app.SetRibbonControlEnabled(kPlaceLevel, levels.size() > 1);
    const OdResult offsetResult = app.SetRibbonControlText(kPlaceOffset, L"0");
    const OdResult rotationResult = app.SetRibbonControlChecked(kPlaceRot0, true);
    const OdResult ghostResult = vbimCreateSymbolGhost(state.symbol, state.ghost);
    CString status;
    status.Format(LoadOd(IDS_VBIMSDK_PLACE_API_FMT).c_str(), static_cast<int>(typeResult), static_cast<int>(tabResult),
        static_cast<int>(levelResult), static_cast<int>(offsetResult), static_cast<int>(rotationResult),
        static_cast<int>(ghostResult));
    pIO->putString(OdString((LPCTSTR)status));

    for (;;)
    {
        OdGePoint3d point;
        try
        {
            VBimSnapScope scope;
            vbimSetVbimSnapScopeTemporaryDimensionsSuppressed(state.hasLast);
            point = pIO->getPoint(LoadOd(IDS_VBIMSDK_PLACE_PROMPT), OdEd::kInpThrowEmpty | OdEd::kInpThrowOther, nullptr,
                OdString::kEmpty, &tracker);
        }
        // OdEdOtherInput and OdEdEmptyInput both derive from OdEdCancel: catch the
        // typed text first, then Enter / Esc together.
        catch (const OdEdOtherInput& other)
        {
            if (other.string().iCompare(kPlaceFinish) == 0 || other.string().iCompare(kPlaceCancel) == 0)
                break;
            continue;
        }
        catch (const OdEdCancel&)
        {
            break;
        }

        const OdGePoint3d location = OnLevel(state, point);
        OdBmObjectId placedId;
        const bool placed = PlaceColumn(state, location, placedId);
        LOG_DEBUG(CString(OdString().format(L"[VBIMSDK_PLACE] click (%.3f, %.3f, %.3f) level=%llu placed=%d id=%llu",
            location.x, location.y, location.z, static_cast<unsigned long long>(static_cast<OdUInt64>(state.level)),
            placed ? 1 : 0, static_cast<unsigned long long>(static_cast<OdUInt64>(placedId))).c_str()));
        if (!placed)
        {
            pIO->putString(LoadOd(IDS_VBIMSDK_PLACE_FAILED));
            continue;
        }
        vbimRefreshAfterModelChange();
        vbimNotifyEntityPlaced(placedId);
        state.last = location;
        state.hasLast = true;
    }
}

#ifdef _DEBUG
namespace {

VbimRibbon::ButtonDef MakePlaceControl(VbimRibbon::ButtonKind kind, const wchar_t* name, const wchar_t* text)
{
    VbimRibbon::ButtonDef button;
    button.kind = kind;
    button.commandName = name;
    button.text = text;
    return button;
}

class PlaceSampleRibbonProvider final : public VbimRibbon::IRibbonTabProvider
{
public:
    std::wstring GetProviderId() const override { return kPlaceContext; }
    int GetPriority() const override { return 1000; }

    std::vector<VbimRibbon::TabDef> GetTabDefinitions() const override
    {
        using namespace VbimRibbon;
        PanelDef options;
        options.name = L"Options";
        options.buttons.push_back(MakePlaceControl(ButtonKind::ComboBox, kPlaceLevel, L"Level"));
        options.buttons.push_back(MakePlaceControl(ButtonKind::TextBox, kPlaceOffset, L"Offset (mm)"));
        ButtonDef rotation = MakePlaceControl(ButtonKind::RadioButtonGroup, kPlaceRotation, L"Rotation");
        rotation.subItems.push_back(MakePlaceControl(ButtonKind::Button, kPlaceRot0, L"0 deg"));
        rotation.subItems.push_back(MakePlaceControl(ButtonKind::Button, kPlaceRot90, L"90 deg"));
        options.buttons.push_back(rotation);

        PanelDef mode;
        mode.name = L"Mode";
        mode.buttons.push_back(MakePlaceControl(ButtonKind::CommandInput, kPlaceFinish, kPlaceFinish));
        mode.buttons.push_back(MakePlaceControl(ButtonKind::CommandInput, kPlaceCancel, kPlaceCancel));

        TabDef tab;
        tab.source = DefinitionSource::ExternalPlugin;
        tab.name = L"Place Column (SDK sample)";
        tab.isContextual = true;
        tab.contextId = kPlaceContext;
        tab.returnTab = L"Architecture";
        tab.panels.push_back(options);
        tab.panels.push_back(mode);
        return { tab };
    }
};

} // namespace

std::unique_ptr<VbimRibbon::IRibbonTabProvider> CreateVBimSdkPlaceRibbonProvider()
{
    return std::make_unique<PlaceSampleRibbonProvider>();
}
#endif
