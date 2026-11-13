#include "pch.h"
#include "domain/public_api/events/internal/VBimEventBridge.h"
#include "domain/public_api/events/internal/VBimEventDispatch.h"
#include "domain/public_api/events/internal/VBimViewBuilder.h"
#include "Host/Document/VinaBIMDoc.h"   // CVinaBIMDoc, database(), GetPathName()
#include "Database/Entities/BmDBDrawing.h"

namespace {

OdBmDatabase* s_lastViewActivatedDb      = nullptr;
OdDbStub*     s_lastViewActivatedDrawing = nullptr;

// Opens DBDrawing from stub → resolves base DBView.
// Returns null smart pointer on any failure.
OdBmDBViewPtr ResolveDbViewFromDrawingId(OdDbStub* drawingStub)
{
    if (!drawingStub)
        return OdBmDBViewPtr();
    const OdBmObjectId drawingId(drawingStub);
    OdBmDBDrawingPtr pDrawing;
    try { pDrawing = drawingId.safeOpenObject(); } catch (...) { return OdBmDBViewPtr(); }
    if (pDrawing.isNull())
        return OdBmDBViewPtr();
    const OdBmObjectId viewId = pDrawing->getBaseDBViewId();
    if (viewId.isNull())
        return OdBmDBViewPtr();
    OdBmDBViewPtr pView;
    try { pView = viewId.safeOpenObject(); } catch (...) { return OdBmDBViewPtr(); }
    return pView;
}

} // namespace

void VBimEventBridge::NotifyDocumentOpened(CVinaBIMDoc* pDoc)
{
    if (!pDoc || !pDoc->database())
        return;
    VBimDocumentEventArgs args;
    args.m_pDatabase    = pDoc->database();
    args.m_documentPath = OdString(pDoc->GetPathName().GetString());
    vbimEventFire(VBimEventType::DocumentOpened, args);
}

void VBimEventBridge::NotifyDocumentCreated(CVinaBIMDoc* pDoc)
{
    if (!pDoc || !pDoc->database())
        return;
    VBimDocumentEventArgs args;
    args.m_pDatabase = pDoc->database();
    vbimEventFire(VBimEventType::DocumentCreated, args);
}

void VBimEventBridge::NotifyDocumentSaving(CVinaBIMDoc* pDoc, const OdString& targetPath)
{
    if (!pDoc || !pDoc->database())
        return;
    VBimDocumentEventArgs args;
    args.m_pDatabase    = pDoc->database();
    args.m_documentPath = targetPath;
    vbimEventFire(VBimEventType::DocumentSaving, args);
}

void VBimEventBridge::NotifyDocumentSaved(CVinaBIMDoc* pDoc, const OdString& targetPath)
{
    if (!pDoc || !pDoc->database())
        return;
    VBimDocumentEventArgs args;
    args.m_pDatabase    = pDoc->database();
    args.m_documentPath = targetPath;
    vbimEventFire(VBimEventType::DocumentSaved, args);
}

void VBimEventBridge::NotifyDocumentSaveFailed(CVinaBIMDoc* pDoc, const OdString& targetPath)
{
    if (!pDoc || !pDoc->database())
        return;
    VBimDocumentEventArgs args;
    args.m_pDatabase    = pDoc->database();
    args.m_documentPath = targetPath;
    vbimEventFire(VBimEventType::DocumentSaveFailed, args);
}

bool VBimEventBridge::NotifyDocumentClosing(CVinaBIMDoc* pDoc, bool cancellable)
{
    if (!pDoc || !pDoc->database())
        return false;
    VBimDocumentClosingEventArgs args;
    args.m_pDatabase   = pDoc->database();
    args.m_filePath    = OdString(pDoc->GetPathName().GetString());
    args.m_cancellable = cancellable;
    vbimEventFire(VBimEventType::DocumentClosing, args);
    if (cancellable && args.m_cancel)
        return true;

    // Reset view state only when this document owned the last active view.
    // Avoids clearing state when a background document closes.
    if (pDoc->database() == s_lastViewActivatedDb)
    {
        s_lastViewActivatedDb      = nullptr;
        s_lastViewActivatedDrawing = nullptr;
    }
    return false;
}

void VBimEventBridge::NotifyDocumentClosed(const OdString& filePath, const OdString& documentId)
{
    VBimDocumentClosedEventArgs args;
    args.m_filePath   = filePath;
    args.m_documentId = documentId;
    vbimEventFire(VBimEventType::DocumentClosed, args);
    // View state reset already done in NotifyDocumentClosing while db was valid.
}

void VBimEventBridge::NotifySelectionChanged(OdBmObjectId selectedId)
{
    VBimSelectionChangedEventArgs args;
    if (!selectedId.isNull())
    {
        args.m_selectedIds = vbimGetPickFirst();
        // Some Host paths report a primary id without populating PickFirst.
        if (args.m_selectedIds.isEmpty())
            args.m_selectedIds.append(selectedId);
    }
    vbimEventFire(VBimEventType::SelectionChanged, args);
}

bool VBimEventBridge::NotifyViewActivating(OdBmDatabase* db, const OdBmObjectId& nextDrawingId)
{
    OdDbStub* const nextStub = nextDrawingId;  // implicit conversion — VinaBIMDoc_Oda.cpp:591 pattern
    if (db == s_lastViewActivatedDb && nextStub == s_lastViewActivatedDrawing)
        return false;  // no real change — skip

    VBimViewActivatingEventArgs args;
    args.m_previous = MakeVBimView(s_lastViewActivatedDb,
                                   ResolveDbViewFromDrawingId(s_lastViewActivatedDrawing));
    args.m_next     = MakeVBimView(db, ResolveDbViewFromDrawingId(nextStub));
    vbimEventFire(VBimEventType::ViewActivating, args);
    return false;  // Cancel not honoured in Phase 1 (notification-only)
}

void VBimEventBridge::NotifyViewActivated(OdBmDatabase* db, const OdBmObjectId& currentDrawingId)
{
    OdDbStub* const newStub = currentDrawingId;  // implicit conversion
    if (db == s_lastViewActivatedDb && newStub == s_lastViewActivatedDrawing)
        return;

    VBimViewActivatedEventArgs args;
    args.m_previous  = MakeVBimView(s_lastViewActivatedDb,
                                    ResolveDbViewFromDrawingId(s_lastViewActivatedDrawing));
    args.m_current   = MakeVBimView(db, ResolveDbViewFromDrawingId(newStub));
    args.m_pDatabase = db;

    s_lastViewActivatedDb      = db;
    s_lastViewActivatedDrawing = newStub;

    vbimEventFire(VBimEventType::ViewActivated, args);
}

void VBimEventBridge::NotifyApplicationEvent(VBimEventType type)
{
    if (type != VBimEventType::ApplicationInitialized &&
        type != VBimEventType::ApplicationClosing &&
        type != VBimEventType::Idling)
        return;
    VBimEventArgs args;
    vbimEventFire(type, args);
}

bool VBimEventBridge::NotifyDialogBoxShowing(const OdString& caption, const OdString& text, int& result)
{
    // A handler that shows a Host message box itself must not re-enter this
    // event (unbounded recursion); the nested box is shown without notification.
    static bool s_dispatching = false;
    if (s_dispatching)
        return false;
    struct DispatchGuard
    {
        DispatchGuard()  { s_dispatching = true; }
        ~DispatchGuard() { s_dispatching = false; }
    } guard;

    VBimDialogBoxShowingEventArgs args;
    args.m_caption = caption;
    args.m_message = text;
    vbimEventFire(VBimEventType::DialogBoxShowing, args);
    if (!args.m_overridden)
        return false;
    result = args.m_result;
    return true;
}
