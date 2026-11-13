// VBimEventBridge.h
//
// Internal — NOT part of the public SDK surface.
// Host files include this header to fire lifecycle events into VBimEventManager.
// No MFC or ODA engine types appear in this header — only forward declarations.
//
#pragma once

#include "domain/vinaBIMCore/vbedvds.h"  // OdBmObjectId, OdString

class CVinaBIMDoc;
class OdBmDatabase;
enum class VBimEventType;

// Static bridge between VinaBIM Host lifecycle callbacks and VBimEventManager.
//
// Each Notify* method constructs the appropriate VBimEventArgs and calls
// vbimEventFire(). All methods must be called from the UI thread.
//
class VBimEventBridge
{
public:
    // Fires DocumentOpened. pDoc->database() must be valid at call time.
    // Safe hook point: end of CVinaBIMDoc::StartDocument (after m_pDb assigned).
    //
    static void NotifyDocumentOpened(CVinaBIMDoc* pDoc);

    // Fires DocumentCreated for a new unsaved document. pDoc->database() must be
    // valid. Hook point: CVinaBIMApp::CreateDocumentByBmDb after the frame exists.
    //
    static void NotifyDocumentCreated(CVinaBIMDoc* pDoc);

    // Fires DocumentSaving (before the write) for targetPath. Notification only.
    // Hook point: CVinaBIMDoc::SaveDocumentInternal before SaveModelUseCase.
    //
    static void NotifyDocumentSaving(CVinaBIMDoc* pDoc, const OdString& targetPath);

    // Fires DocumentSaved after a successful write of targetPath.
    // Hook point: CVinaBIMDoc::SaveDocumentInternal after SaveModelUseCase succeeds.
    //
    static void NotifyDocumentSaved(CVinaBIMDoc* pDoc, const OdString& targetPath);

    // Fires DocumentSaveFailed when the write of targetPath announced by
    // DocumentSaving did not complete, so plugins can release save-time state.
    // Hook point: CVinaBIMDoc::SaveDocumentInternal when SaveModelUseCase fails.
    //
    static void NotifyDocumentSaveFailed(CVinaBIMDoc* pDoc, const OdString& targetPath);

    // Fires DocumentClosing. pDoc->database() is valid during handler dispatch.
    // Returns true when cancellable is true and a handler called SetCancel(true);
    // the caller must then keep the document open. Returns false otherwise.
    // Resets bridge view state only when the close proceeds and the closing
    // document owns the last active view.
    // Hook points: CVinaBIMDoc::CanCloseFrame on the last frame (cancellable)
    // and CVinaBIMDoc::OnCloseDocument when not yet notified (not cancellable).
    //
    static bool NotifyDocumentClosing(CVinaBIMDoc* pDoc, bool cancellable);

    // Fires DocumentClosed. Called from CMainFrame::OnNotifyDocumentClosed after
    // MFC document teardown via deferred WM_APP PostMessage.
    // The ODA database is no longer valid — args carry only path and documentId.
    //
    static void NotifyDocumentClosed(const OdString& filePath, const OdString& documentId);

    // Fires SelectionChanged with the full PickFirst set of the active view.
    // selectedId is the primary element reported by the Host, or kNull when the
    // selection is cleared; it is used only when PickFirst is empty.
    // Safe hook point: VbimHostEditorServicesImpl::onSelectionChanged.
    //
    static void NotifySelectionChanged(OdBmObjectId selectedId);

    // Fires ViewActivating (notification-only in Phase 1). Previous view is derived
    // from bridge internal state, not from the call site.
    // Skipped (returns false) when (db, nextDrawingId) matches current bridge state.
    // Cancel is not honoured — MDI frame has already activated when this fires.
    // Safe hook point: CChildFrame::UpdateActiveLayout before SetCurrentLayout.
    //
    static bool NotifyViewActivating(OdBmDatabase* db, const OdBmObjectId& nextDrawingId);

    // Fires ViewActivated. Updates bridge state with (db, currentDrawingId).
    // Deduplicated — no-op when (db, currentDrawingId) matches current bridge state.
    // Safe hook point: CChildFrame::UpdateActiveLayout after SetCurrentLayout.
    //
    static void NotifyViewActivated(OdBmDatabase* db, const OdBmObjectId& currentDrawingId);

    // Fires an event that carries no data: ApplicationInitialized,
    // ApplicationClosing or Idling. Other types are ignored.
    //
    static void NotifyApplicationEvent(VBimEventType type);

    // Fires DialogBoxShowing for a Host message box. Returns true when a handler
    // overrode the result; the caller must then skip the dialog and return
    // result. Returns false (result untouched) when the dialog should be shown.
    // Hook points: CVinaBIMApp::messageBox and VBimTaskDialogService.
    // Not re-entrant: a box shown by a handler during dispatch is not notified.
    //
    static bool NotifyDialogBoxShowing(const OdString& caption, const OdString& text, int& result);
};
