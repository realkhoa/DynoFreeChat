///////////////////////////////////////////////////////////////////////////////
// VinaBIM Native SDK — Public API
// VBimSelection.cpp — Selection facade implementation.
///////////////////////////////////////////////////////////////////////////////
#include "pch.h"
#include "domain/public_api/selection/VBimSelection.h"
#include "domain/selection/VBimPickerService.h"
#include "domain/vinaBIMCore/vbedvds.h"
#include "Host/application/VinaBIM.h"
#include "Host/Document/VinaBIMDoc.h"
#include "Host/view/VinaBIMView.h"
#include "Host/sdk/ViewportPlacement/VBimViewportPlacementHost.h"
#include "domain/public_api/properties/VBimElementProperties.h"
#include "domain/public_api/app/VBimUIApplication.h"
#include "domain/public_api/app/VBimUIDocument.h"
#include "OdaCommon.h"
#include "domain/selection/VBimPickTracker.h"
#include "Host/sdk/Selection/VBimSelectionHost.h"
#include "Host/sdk/Selection/VBimDimHostBridge.h"
#include "Host/sdk/ChangeTracking/VBimChangeTracker.h"
#include <map>
#include <algorithm>

namespace
{
    struct InteractiveSession
    {
        VBimSelectionSessionToken token = 0;
        CVinaBIMDoc* doc = nullptr;
        CVinaBIMView* view = nullptr;
        OdBmDatabase* db = nullptr;
        OdBmObjectId drawing;
        OdGsView* gs = nullptr;
        HWND window = nullptr;
        IVBimSelectionSessionObserver* observer = nullptr;
        VBimPickTracker* tracker = nullptr;
        void* cursor = nullptr;
        bool cancelled = false;
        bool ending = false;
        unsigned activeCalls = 0;
    } s_session;
    VBimSelectionSessionToken s_nextSession = 0;

    // Keep the generation published until input and observer callbacks unwind.
    // EndSession may be called reentrantly by OnInvalidated/OnTab.
    struct SessionCall
    {
        VBimSelectionSessionToken token;
        explicit SessionCall(VBimSelectionSessionToken value) : token(value) { ++s_session.activeCalls; }
        SessionCall(const SessionCall&) = delete;
        SessionCall& operator=(const SessionCall&) = delete;
        ~SessionCall()
        {
            if (s_session.token != token) return;
            --s_session.activeCalls;
            if (!s_session.activeCalls && s_session.ending) s_session = InteractiveSession();
        }
    };

    struct DeferredClose
    {
        UINT message = 0; // Zero resumes OnCloseDocument, otherwise posts to the frame.
        CVinaBIMDoc* document = nullptr; // Identity only until checked against live documents.
        VBimSelectionSessionToken session = 0;
        ULONG_PTR identity = 0;
        CWnd* owner = nullptr; // Identity only; never dereferenced from the queue.
        bool marked = false;
    };
    struct DeferredDocumentClose
    {
        OdBmDatabase* database = nullptr; // Identity only, no DB ownership.
        VBimSelectionSessionToken session = 0;
    };
    std::map<HWND, DeferredClose> s_deferredCloses;
    // Document close must survive an absent/destroyed input HWND. The document
    // destructor removes this entry before its address can be reused.
    std::map<CVinaBIMDoc*, DeferredDocumentClose> s_deferredDocumentCloses;
    ULONG_PTR s_nextClose = 0;
    constexpr wchar_t kCloseProperty[] = L"VinaBIM.Selection.DeferredClose";

    CWnd* permanentWindow(HWND window)
    {
        AFX_MANAGE_STATE(AfxGetAppModuleState());
        return CWnd::FromHandlePermanent(window);
    }

    bool deferClose(HWND window, UINT message, CVinaBIMDoc* doc,
        VBimSelectionSessionToken session) noexcept
    {
        if (!::IsWindow(window)) return false;
        auto* owner = permanentWindow(window);
        if (!owner) return false; // Host only queues its own MFC frames.
        auto existing = s_deferredCloses.find(window);
        if (existing != s_deferredCloses.end() && existing->second.owner == owner)
        {
            existing->second.message = message;
            existing->second.document = doc;
            existing->second.session = session;
            return true;
        }
        const auto identity = ++s_nextClose;
        const bool marked = ::SetPropW(window, kCloseProperty, reinterpret_cast<HANDLE>(identity)) != FALSE;
        // If SetProp fails, the permanent MFC identity and destruction hooks
        // still bound the request. It is never sent to an arbitrary HWND.
        try { s_deferredCloses[window] = {message, doc, session, identity, owner, marked}; }
        catch (...)
        {
            if (marked) ::RemovePropW(window, kCloseProperty);
            LOG(L"[Selection] Could not retain a close retry; close remains blocked.");
            return false;
        }
        return true;
    }

    bool deferDocumentClose(CVinaBIMDoc* doc, VBimSelectionSessionToken session) noexcept
    {
        if (!doc) return false;
        try
        {
            s_deferredDocumentCloses[doc] = {doc->database(), session};
            return true;
        }
        catch (...) { LOG(L"[Selection] Could not retain a document close retry; close remains blocked."); return false; }
    }

    void invalidateSession() noexcept
    {
        if (!s_session.token || s_session.cancelled) return;
        s_session.cancelled = true;
        SessionCall call(s_session.token);
        // Detach plugin previews while the original view/device still exists.
        auto* observer = s_session.observer;
        s_session.observer = nullptr;
        if (observer) observer->OnInvalidated();
        try { if (s_session.tracker) s_session.tracker->cleanup(); } catch (...) {}
        try { if (::IsWindow(s_session.window)) s_session.view->track(nullptr); } catch (...) {}
        if (::IsWindow(s_session.window) && s_session.view->isWaitingForInput())
            s_session.view->OnCommandWnd(OdString(), TRUE, FALSE);
    }
}

VBimSelectionSessionToken VBimSelection::BeginSession()
{
    if (s_session.token || !m_pDoc || m_pDoc != theApp.GetActiveDocument()) return 0;
    auto* view = m_pDoc->getActiveViewer();
    if (!view || !view->getActiveView()) return 0;
    s_session.token = ++s_nextSession;
    s_session.doc = m_pDoc;
    s_session.db = m_pDoc->database();
    s_session.view = view;
    s_session.window = view->GetSafeHwnd();
    s_session.drawing = view->getActiveDBDrawingId();
    s_session.gs = view->getActiveView();
    return s_session.token;
}

void VBimSelection::EndSession(VBimSelectionSessionToken token) noexcept
{
    if (!token || token != s_session.token || s_session.ending) return;
    s_session.ending = true;
    if (s_session.activeCalls) invalidateSession();
    else s_session = InteractiveSession();
}

bool VBimSelection::IsSessionValid(VBimSelectionSessionToken token)
{
    if (!token || token != s_session.token || s_session.cancelled) return false;
    if (!::IsWindow(s_session.window) || theApp.GetActiveDocument() != s_session.doc ||
        theApp.GetActiveView() != s_session.view || s_session.doc->database() != s_session.db ||
        s_session.view->getActiveDBDrawingId() != s_session.drawing ||
        s_session.view->getActiveView() != s_session.gs)
    {
        invalidateSession();
        return false;
    }
    return true;
}

void VBimSelection::CancelSession(VBimSelectionSessionToken token) noexcept
{
    if (token && token == s_session.token) invalidateSession();
}

void VBimSelection::SetSessionObserver(VBimSelectionSessionToken token,
    IVBimSelectionSessionObserver* observer)
{
    if (token && token == s_session.token && (!observer || !s_session.cancelled)) s_session.observer = observer;
}

void* VBimSelection::SessionWindow(VBimSelectionSessionToken token)
{
    return token && token == s_session.token ? s_session.window : nullptr;
}

void VBimSelection::SetSessionCursor(VBimSelectionSessionToken token, void* cursor)
{
    if (IsSessionValid(token)) s_session.cursor = cursor;
}

void* VBimSelectionHost::InputCursorForView(CVinaBIMView* view)
{
    return s_session.view == view && VBimSelection::IsSessionValid(s_session.token)
        ? s_session.cursor : nullptr;
}

bool VBimSelectionHost::DispatchSessionTab(bool backwards)
{
    try
    {
        if (!VBimSelection::IsSessionValid(s_session.token) || !s_session.observer ||
            s_session.ending) return false;
        SessionCall call(s_session.token);
        if (!s_session.observer->OnTab(backwards)) return false;
        // Refresh the Host highlight/result immediately after a plugin cycles
        // its reference, including before the first dimension witness.
        if (s_session.tracker && VBimSelection::IsSessionValid(s_session.token))
            s_session.tracker->refresh();
        return true;
    }
    catch (...) { invalidateSession(); return true; }
}

void VBimSelectionHost::ValidateActiveSession()
{
    VBimDimHostBridge::Validate();
    if (s_session.token) VBimSelection::IsSessionValid(s_session.token);
}

void VBimSelectionHost::NotifyViewUnavailable(CVinaBIMView* view) noexcept
{
    VBimDimHostBridge::ViewUnavailable(view);
    if (s_session.token && s_session.view == view) invalidateSession();
}

bool VBimSelectionHost::CancelSessionForDocument(CVinaBIMDoc* doc) noexcept
{
    if (!s_session.token)
    {
        // EndSession can run after input returns but before the surrounding
        // command unwinds. An already queued close remains a lifetime barrier.
        if (VBimChangeTracker::IsCommandRunning() || theApp.IsSomeCommandActive())
        {
            for (const auto& request : s_deferredCloses)
                if (!doc || request.second.document == doc) return true;
            for (const auto& request : s_deferredDocumentCloses)
                if (!doc || request.first == doc) return true;
        }
        return false;
    }
    if (doc && s_session.doc != doc) return false;
    invalidateSession();
    if (s_session.activeCalls || VBimChangeTracker::IsCommandRunning() || theApp.IsSomeCommandActive()) return true;
    s_session = InteractiveSession();
    return false;
}

bool VBimSelectionHost::DeferSessionClose(CVinaBIMDoc* doc, HWND window, UINT message)
{
    const auto token = s_session.token;
    auto* boundDocument = doc ? doc : s_session.doc;
    if (!CancelSessionForDocument(doc)) return false;
    if (!deferClose(window, message, boundDocument, token))
        LOG(L"[Selection] Frame close retry could not be queued; refusing unsafe teardown.");
    return true;
}

bool VBimSelectionHost::DeferSessionDocumentClose(CVinaBIMDoc* doc)
{
    const auto token = s_session.token;
    if (!CancelSessionForDocument(doc)) return false;
    deferDocumentClose(doc, token);
    return true; // Never release the unwind barrier on a queue/allocation failure.
}

void VBimSelectionHost::NotifyDocumentUnavailable(CVinaBIMDoc* doc) noexcept
{
    s_deferredDocumentCloses.erase(doc);
    for (auto& request : s_deferredCloses)
        if (request.second.document == doc) request.second.document = nullptr;
    if (s_session.token && s_session.doc == doc)
    {
        invalidateSession();
        s_session.ending = true;
        if (!s_session.activeCalls) s_session = InteractiveSession();
    }
}

void VBimSelectionHost::NotifyWindowDestroying(HWND window) noexcept
{
    auto request = s_deferredCloses.find(window);
    if (request == s_deferredCloses.end()) return;
    if (request->second.marked && ::GetPropW(window, kCloseProperty) == reinterpret_cast<HANDLE>(request->second.identity))
        ::RemovePropW(window, kCloseProperty);
    s_deferredCloses.erase(request);
}

bool VBimSelectionHost::FlushDeferredSessionCloses()
{
    if (s_session.activeCalls || VBimChangeTracker::IsCommandRunning() || theApp.IsSomeCommandActive()) return false;
    if (!s_deferredDocumentCloses.empty())
    {
        const auto request = *s_deferredDocumentCloses.begin();
        s_deferredDocumentCloses.erase(s_deferredDocumentCloses.begin());
        const auto documents = theApp.GetAllActiveVinaBIMDocs();
        if (std::find(documents.begin(), documents.end(), request.first) == documents.end() ||
            request.first->database() != request.second.database ||
            (s_session.token && s_session.token != request.second.session)) return true;
        if (s_session.token) s_session = InteractiveSession();
        request.first->OnCloseDocument();
        return true;
    }
    if (s_deferredCloses.empty()) return false;
    // Process one at a time and recheck the unwind gates after any message pump.
    const auto item = *s_deferredCloses.begin();
    const auto window = item.first;
    const auto& request = item.second;
    const bool matches = ::IsWindow(window) && permanentWindow(window) == request.owner &&
        (!request.marked || ::GetPropW(window, kCloseProperty) == reinterpret_cast<HANDLE>(request.identity));
    if (!matches || (s_session.token && s_session.token != request.session))
    {
        NotifyWindowDestroying(window);
        return true;
    }
    if (s_session.token) s_session = InteractiveSession();
    if (::PostMessageW(window, request.message, 0, 0)) NotifyWindowDestroying(window);
    else LOG(L"[Selection] Posting close retry failed; retaining it for a later idle pass.");
    return true;
}

bool VBimSelection::PickObject(VBimObjectType type, const OdString& prompt,
    VBimReference& result, IVBimSelectionFilter* filter, VBimSelectionSessionToken token)
{
    result = VBimReference();
    if (!IsSessionValid(token) || s_session.activeCalls) return false;
    SessionCall call(token);
    auto tracker = VBimPickTracker::create(s_session.view, s_session.db, type,
        VBimObjectSnapTypes::All, filter);
    s_session.tracker = tracker.get();
    struct TrackerExit
    {
        VBimSelectionSessionToken token;
        VBimPickTracker* tracker;
        ~TrackerExit()
        {
            if (s_session.token == token) s_session.tracker = nullptr;
            try { tracker->cleanup(); } catch (...) { LOG(L"[Selection] Pick tracker cleanup failed."); }
        }
    } exit{token, tracker.get()};
    try
    {
        const auto point = s_session.view->getPoint(prompt, OdEd::kGptNoUCS | OdEd::kGptNoLimCheck, tracker.get());
        if (IsSessionValid(token))
        {
            result = tracker->result();
            if (!result.isValid) result.globalPoint = point;
        }
        return result.isValid;
    }
    catch (const OdEdOtherInput&) { throw; }
    catch (const OdEdEmptyInput&) { throw; }
    catch (const OdEdCancel&)
    {
        result = VBimReference();
        return false;
    }
}

bool VBimSelection::PickPoint(const OdString& prompt, OdGePoint3d& point,
    VBimObjectSnapTypes snaps, VBimSelectionSessionToken token)
{
    if (!IsSessionValid(token) || s_session.activeCalls) return false;
    SessionCall call(token);
    // Placement deliberately uses a plain point tracker, as the DIM preview
    // and work plane perform their own projection. No stale picker state.
    (void)snaps;
    try
    {
        const auto picked = s_session.view->getPoint(prompt, OdEd::kGptNoUCS | OdEd::kGptNoLimCheck, nullptr);
        if (!IsSessionValid(token)) return false;
        point = picked;
        return true;
    }
    catch (const OdEdOtherInput&) { throw; }
    catch (const OdEdEmptyInput&) { throw; }
    catch (const OdEdCancel&) { return false; }
}

bool VBimSelection::PickObject(
    VBimObjectType objectType,
    const OdString& prompt,
    VBimReference& result,
    IVBimSelectionFilter* pFilter)
{
    return VBimPickerService::Pick(m_pDoc, objectType, prompt, result, VBimObjectSnapTypes::All, pFilter);
}

bool VBimSelection::PickObject(
    VBimObjectType objectType,
    const OdString& prompt,
    OdBmObjectId& resultId,
    IVBimSelectionFilter* pFilter)
{
    return VBimPickerService::Pick(m_pDoc, objectType, prompt, resultId, VBimObjectSnapTypes::All, pFilter);
}

bool VBimSelection::PickObject(const OdString& prompt, OdBmObjectId& resultId)
{
    OdSelectionSetPtr entres;
    OdGePoint3d ptres;
    if (vbimEntSel(prompt, entres, ptres) != RTNORM)
        return false;
    OdBmObjectIdArray ids = getObjectIdsFromSelectionSet(entres);
    if (ids.isEmpty())
        return false;
    resultId = ids[0];
    return true;
}

bool VBimSelection::PickObjects(
    VBimObjectType objectType,
    const OdString& prompt,
    std::vector<VBimReference>& results,
    IVBimSelectionFilter* pFilter,
    const std::vector<VBimReference>* pPreselected)
{
    return VBimPickerService::PickMultiple(m_pDoc, objectType, prompt, results, VBimObjectSnapTypes::All, pFilter, pPreselected);
}

bool VBimSelection::PickObjects(
    VBimObjectType objectType,
    const OdString& prompt,
    OdBmObjectIdArray& resultIds,
    IVBimSelectionFilter* pFilter)
{
    return VBimPickerService::PickMultiple(m_pDoc, objectType, prompt, resultIds, VBimObjectSnapTypes::All, pFilter);
}

bool VBimSelection::PickBox(
    VBimPickBoxStyle style,
    const OdString& prompt,
    VBimPickedBox& resultBox)
{
    return VBimPickerService::PickBox(m_pDoc, style, prompt, resultBox);
}

bool VBimSelection::PickElementsByRectangle(
    const OdString& prompt,
    OdBmObjectIdArray& resultIds,
    IVBimSelectionFilter* pFilter,
    VBimPickBoxStyle style)
{
    return VBimPickerService::PickElementsByRectangle(m_pDoc, prompt, resultIds, pFilter, style);
}

bool VBimSelection::PickElementsByRectangle(
    const OdString& prompt,
    std::vector<VBimReference>& results,
    IVBimSelectionFilter* pFilter,
    VBimPickBoxStyle style)
{
    return VBimPickerService::PickElementsByRectangle(m_pDoc, prompt, results, pFilter, style);
}

bool VBimSelection::PickPoint(
    const OdString& prompt,
    OdGePoint3d& resultPoint,
    VBimObjectSnapTypes snapSettings)
{
    return VBimPickerService::PickPoint(m_pDoc, prompt, resultPoint, snapSettings);
}

OdResult VBimSelection::PickViewportLocation(const OdBmObjectId& viewId, OdGePoint3d& location)
{
    // Plugins call this under their own AFX_MANAGE_STATE; view lookups need the app's handle maps.
    AFX_MANAGE_STATE(AfxGetAppModuleState());
    return VBimPickViewportLocation(m_pDoc, viewId, location);
}

OdBmObjectIdArray VBimSelection::GetElementIds() const
{
    return vbimGetPickFirst();
}

void VBimSelection::SetElementIds(const OdBmObjectIdArray& ids)
{
    CVinaBIMDoc* pDoc = m_pDoc;
    if (!pDoc)
        pDoc = theApp.GetActiveDocument();

    CVinaBIMView* pView = pDoc ? pDoc->getActiveViewer() : nullptr;
    if (!pView && pDoc)
        pView = pDoc->getViewer();

    if (pView)
    {
        pView->SetSelection(ids);
    }
    else if (ids.isEmpty())
    {
        UnSelect();
    }
}

void VBimSelection::Clear()
{
    SetElementIds(OdBmObjectIdArray());
}

VBimElementProperties VBimSelection::GetActiveProperties()
{
    if (!m_pDoc)
        return VBimElementProperties();

    OdBmDatabase* pDb = m_pDoc->database();
    if (!pDb)
        return VBimElementProperties();

    const OdBmObjectIdArray ids = GetElementIds();
    if (ids.isEmpty() || ids.first().isNull() || ids.first().database() != pDb)
        return VBimElementProperties();

    VBimUIDocument* pUIDoc = nullptr;
    try
    {
        pUIDoc = VBimUIApplication::Instance().ActiveUIDocument();
        if (pUIDoc && pUIDoc->GetInternalDoc() != m_pDoc)
            pUIDoc = nullptr;
    }
    catch (const OdError& err)
    {
        (void)err;
        ODA_TRACE1("VBimSelection::GetActiveProperties OdError: %ls\n", err.description().c_str());
    }
    catch (const std::exception& ex)
    {
        (void)ex;
        ODA_TRACE1("VBimSelection::GetActiveProperties exception: %hs\n", ex.what());
    }

    return VBimElementProperties(pDb, ids.first(), pUIDoc);
}

bool VBimSelection::Pick(
    VBimObjectType mode,
    const OdString& prompt,
    VBimReference& result,
    IVBimSelectionFilter* pFilter)
{
    return PickObject(mode, prompt, result, pFilter);
}

bool VBimSelection::Pick(
    VBimPickMode mode,
    const OdString& prompt,
    VBimPickResult& result,
    IVBimSelectionFilter* pFilter)
{
    VBimReference ref;
    const bool ok = PickObject(mode, prompt, ref, pFilter);
    result = ref;
    return ok;
}

bool VBimSelection::Pick(
    VBimObjectType mode,
    const OdString& prompt,
    OdBmObjectId& resultId,
    IVBimSelectionFilter* pFilter)
{
    return PickObject(mode, prompt, resultId, pFilter);
}

void VBimSelection::SetInternalDoc(CVinaBIMDoc* pDoc)
{
    m_pDoc = pDoc;
}
