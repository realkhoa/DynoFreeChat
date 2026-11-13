// VBimEventManager.h
//
// Event subscription facade for VinaBIM SDK developers.
//
// Provides a public event subscription surface without exposing ODA
// reactors, MFC messages, CDocument lifecycle, or Host internals.
//
// Obtain via VBimUIApplication::EventManager() — deferred to a later
// prompt when VBimUIApplication::EventManager() is added.
//
// Threading: Handlers are dispatched on the UI thread.
// All Subscribe/Unsubscribe calls must be made from the UI thread.
//
// ABI note: std::function is used for Phase 1 in-process plugins only.
// For binary-stable third-party SDK, replace with a pure virtual
// listener interface or C-style callback. See design document.
//
#pragma once

#include <functional>

#include "../VinaBIMApiExport.h"

#include "Base/BmObjectId.h"
#include "Base/BmObjectIdArray.h"
#include "OdPlatform.h"
#include "OdString.h"

class OdBmDatabase;
class VBimEventBridge;  // Internal bridge — not part of public SDK

// Event type tag. Passed to Subscribe() to select which event to monitor.
//
enum class VBimEventType
{
    DocumentOpened,     // A document was opened or created
    DocumentClosing,    // A document is about to close (database pointer valid during handler)
    DocumentClosed,     // A document was closed (database pointer no longer valid)
    SelectionChanged,   // The active selection set changed
    ViewActivating,     // The active view is about to change (notification-only in Phase 1)
    ViewActivated,      // The active MDI view / layout changed
    DocumentCreated,        // A new unsaved document was created (DocumentOpened also fires)
    DocumentSaving,         // A document is about to be written to disk
    DocumentSaved,          // A document was written to disk successfully
    DocumentChanged,        // Elements were added / modified / erased by a finished command
    ApplicationInitialized, // Startup finished and the main window is shown
    ApplicationClosing,     // The application is exiting; documents are already closed
    Idling,                 // The UI message loop is idle and no command is running
    DialogBoxShowing,       // A Host message box is about to be shown
    DocumentSaveFailed      // A save announced by DocumentSaving did not complete
};

// Classifies the type of a VBimView for feature dialog decision-making.
//
enum class VBimViewType
{
    Unknown,
    ThreeD,
    Drafting,   // FloorPlan, CeilingPlan, Elevation, Section, AreaPlan
    Sheet,      // DrawingSheet, DraftingView, Detail, Walkthrough
    Schedule,
    Other
};

// Stable identity for a BIM view. Returned by VBimUIDocument::ActiveView()
// and carried in ViewActivating/ViewActivated event args.
//
// Use stableViewHandle or viewId to identify which view a modeless dialog
// was opened from. IsValid() returns false when no view is active.
//
struct VINABIMCORE_DLLEXPORT VBimView
{
    // Owning database. Valid only while the document is open.
    OdBmDatabase* database         = nullptr;

    // ODA object id of the OdBmDBView. Use for identity comparisons.
    // Obtained via pDbView->id() — confirmed pattern in VinaBIMDoc_Oda.cpp.
    OdBmObjectId  viewId;

    // Drawing container id for this view.
    OdBmObjectId  drawingId;

    // Numeric handle stable within a session. Use to identify the view
    // without keeping an ODA pointer alive.
    OdUInt64      stableViewHandle = 0;

    VBimViewType  viewType         = VBimViewType::Unknown;
    OdString      viewName;

    // Returns true if this view identity is populated (viewId non-null).
    bool IsValid() const { return !viewId.isNull(); }
};

// Opaque subscription token. Pass to Unsubscribe() to remove a handler.
// Value 0 indicates an invalid or already-removed subscription.
//
using VBimEventHandlerId = unsigned long long;

// ─────────────────────────────────────────────
// Event argument types
// ─────────────────────────────────────────────

// Base class for all VBimEventManager event argument objects.
//
class VINABIMCORE_DLLEXPORT VBimEventArgs
{
public:
    virtual ~VBimEventArgs() = default;
};

// Event arguments for DocumentOpened and DocumentClosed events.
//
// Provides access to the database and document path of the affected document.
//
class VINABIMCORE_DLLEXPORT VBimDocumentEventArgs : public VBimEventArgs
{
public:
    // Returns the ODA BIM database of the opened or closing document.
    // For DocumentClosed, the database is still valid during handler dispatch
    // but will be released immediately after. Do not store the pointer.
    //
    OdBmDatabase* GetDatabase() const;

    // Returns the file path of the document.
    // Returns an empty string for new unsaved documents.
    //
    OdString GetDocumentPath() const;

private:
    friend class VBimEventManager;
    friend class VBimEventBridge;
    OdBmDatabase* m_pDatabase   = nullptr;
    OdString      m_documentPath;
};

// Event arguments for SelectionChanged events.
//
// Provides the element IDs of all currently selected elements (the full
// PickFirst set of the active view).
//
class VINABIMCORE_DLLEXPORT VBimSelectionChangedEventArgs : public VBimEventArgs
{
public:
    // Returns the element IDs of all currently selected elements.
    // Returns an empty array if the selection was cleared.
    //
    OdBmObjectIdArray GetSelectedObjectIds() const;

private:
    friend class VBimEventManager;
    friend class VBimEventBridge;
    OdBmObjectIdArray m_selectedIds;
};

// Event arguments for ViewActivating events.
//
// Fires before the active view changes. In Phase 1 this is notification-only:
// SetCancel(true) has no effect because the MDI frame has already activated.
// Cancel is reserved for a future explicit layout-switching flow.
//
class VINABIMCORE_DLLEXPORT VBimViewActivatingEventArgs : public VBimEventArgs
{
public:
    // View that was active before this transition (may be invalid if no prior view).
    const VBimView& PreviousActiveView() const;

    // View that is about to become active.
    const VBimView& NewActiveView() const;

    /**
     * @brief Indicates if view activation was requested to cancel.
     * @return True if cancelled, false otherwise.
     */
    bool Cancel() const;

    // Phase 1: no-op. See class comment.
    void SetCancel(bool cancel);

private:
    friend class VBimEventBridge;
    VBimView m_previous;
    VBimView m_next;
    bool     m_cancel = false;
};

// Event arguments for ViewActivated events.
//
// Provides the database and full VBimView identity of the newly activated view,
// plus the view that was previously active.
//
class VINABIMCORE_DLLEXPORT VBimViewActivatedEventArgs : public VBimEventArgs
{
public:
    // Returns the ODA BIM database of the document whose view was activated.
    // May be nullptr if no document is active after the transition.
    //
    OdBmDatabase* GetDatabase() const;

    // View that was active before this transition (may be invalid if no prior view).
    const VBimView& PreviousActiveView() const;

    // View that is now active (may be invalid if no view is active after transition).
    const VBimView& CurrentActiveView() const;

private:
    friend class VBimEventManager;
    friend class VBimEventBridge;
    OdBmDatabase* m_pDatabase = nullptr;
    VBimView      m_previous;
    VBimView      m_current;
};

// Event arguments for DocumentClosing events.
//
// Fires once per document before MFC document teardown. The ODA database
// pointer is valid during handler dispatch.
//
// When the user closes the document's last frame, the event fires from
// CanCloseFrame after the save prompt was answered, and SetCancel(true) keeps
// the document open. On application exit / close-all the event fires from
// OnCloseDocument, where MFC has already committed and cancel is ignored.
//
class VINABIMCORE_DLLEXPORT VBimDocumentClosingEventArgs : public VBimEventArgs
{
public:
    // Returns the database of the closing document. Valid during this handler.
    // Do not store — will be released during teardown.
    OdBmDatabase* GetDatabase() const;

    // Returns the file path of the document. Empty for unsaved documents.
    OdString GetFilePath() const;

    /**
     * @brief Indicates if document closing was requested to cancel.
     * @return True if cancelled, false otherwise.
     */
    bool Cancel() const;

    // Requests that the document stay open. Honoured only on the last-frame
    // close path (see class comment); ignored when IsCancellable() is false.
    // const so it can be called on the const args a handler receives.
    void SetCancel(bool cancel) const;

    // Returns true when SetCancel(true) will keep the document open.
    bool IsCancellable() const;

private:
    friend class VBimEventBridge;
    OdBmDatabase* m_pDatabase   = nullptr;
    OdString      m_filePath;
    mutable bool  m_cancel      = false;
    bool          m_cancellable = false;
};

// Event arguments for DocumentClosed events.
//
// Fires after the document has been fully closed and removed from MFC.
// The ODA database pointer is no longer valid — do NOT dereference it.
// Use GetDocumentId() to match against a previously captured document identity.
//
class VINABIMCORE_DLLEXPORT VBimDocumentClosedEventArgs : public VBimEventArgs
{
public:
    // File path of the closed document. Empty for unsaved documents (Phase 1 limitation).
    OdString GetFilePath() const;

    // Stable document identifier (derived from file path in Phase 1).
    // Safe to compare after close. Returns empty string for unsaved documents.
    OdString GetDocumentId() const;

private:
    friend class VBimEventBridge;
    OdString m_filePath;
    OdString m_documentId;
};

// Event arguments for DocumentChanged.
//
// Carries the element ids collected from OdBmDatabase objectAppended /
// objectModified / objectErased events since the previous notification.
// Fired on the UI thread at the first idle point after an outermost command
// ended; ids staged by a cancelled or failed command are discarded. Edits made
// outside any command are reported at the next idle point.
//
// An id appears in at most one list (added wins over modified; erased wins over
// both; an element added and erased in the same batch is not reported). ODA has
// no commit/rollback event, so an explicit OdBmTransaction::rollback() inside a
// command that still ends normally may report ids whose change was undone —
// re-read the element before relying on its state. Arrays and the database
// pointer are valid during the callback only; never open an erased id.
//
class VINABIMCORE_DLLEXPORT VBimDocumentChangedEventArgs : public VBimEventArgs
{
public:
    // Database that owns the ids. Valid during the callback only.
    OdBmDatabase* GetDatabase() const;

    // Elements appended to the database.
    const OdBmObjectIdArray& AddedIds() const;

    // Elements modified and still present.
    const OdBmObjectIdArray& ModifiedIds() const;

    // Elements erased. Compare ids only; do not open them.
    const OdBmObjectIdArray& ErasedIds() const;

private:
    friend class VBimChangeTracker;
    OdBmDatabase*     m_pDatabase = nullptr;
    OdBmObjectIdArray m_added;
    OdBmObjectIdArray m_modified;
    OdBmObjectIdArray m_erased;
};

// Event arguments for DialogBoxShowing.
//
// Fired before a message box routed through the Host (CVinaBIMApp::messageBox)
// or VBimTaskDialogService is shown. Dialogs created directly with
// AfxMessageBox / ::MessageBox or custom CDialog classes do not raise it.
//
// Calling OverrideResult() suppresses the dialog and makes the caller receive
// the given result (IDOK, IDYES, IDNO, IDCANCEL, ...) as if the user chose it.
// The first handler that overrides wins. A message box shown by a handler
// itself is not reported again (no recursion). For a CVinaBIMApp::messageBox
// dialog the result must be one of its buttons (an MB_YESNO box accepts only
// IDYES / IDNO); any other value is ignored and the dialog is shown.
//
class VINABIMCORE_DLLEXPORT VBimDialogBoxShowingEventArgs : public VBimEventArgs
{
public:
    // Caption of the dialog.
    OdString GetCaption() const;

    // Main message text of the dialog.
    OdString GetText() const;

    // Suppresses the dialog and returns result to its caller. const so it can
    // be called on the const args a handler receives.
    void OverrideResult(int result) const;

    // Returns true after a handler called OverrideResult().
    bool IsOverridden() const;

private:
    friend class VBimEventBridge;
    OdString m_caption;
    OdString m_message;
    mutable int  m_result     = 0;
    mutable bool m_overridden = false;
};

// ─────────────────────────────────────────────
// VBimEventManager
// ─────────────────────────────────────────────

// Event manager facade. Routes document, selection, and view events to
// registered handlers.
//
// Phase 1 supports four event types via a single polymorphic Subscribe()
// overload. Typed convenience helpers (e.g., SubscribeDocumentOpened)
// are deferred to Phase 2.
//
class VINABIMCORE_DLLEXPORT VBimEventManager
{
public:

    // Registers a handler for the specified event type.
    // Returns a VBimEventHandlerId token that can be passed to Unsubscribe().
    // Returns 0 if registration fails (e.g., invalid type or no active owner).
    //
    // The handler receives a const VBimEventArgs& which must be
    // dynamic_cast to the concrete event args type matching the event:
    //   VBimEventType::DocumentOpened   → VBimDocumentEventArgs
    //   VBimEventType::DocumentClosing  → VBimDocumentClosingEventArgs
    //   VBimEventType::DocumentClosed   → VBimDocumentClosedEventArgs
    //   VBimEventType::SelectionChanged → VBimSelectionChangedEventArgs
    //   VBimEventType::ViewActivating   → VBimViewActivatingEventArgs
    //   VBimEventType::ViewActivated    → VBimViewActivatedEventArgs
    //   VBimEventType::DocumentCreated / DocumentSaving / DocumentSaved /
    //   DocumentSaveFailed              → VBimDocumentEventArgs (path = target file)
    //   Every DocumentSaving is followed by exactly one DocumentSaved or
    //   DocumentSaveFailed for the same path.
    //   VBimEventType::DocumentChanged  → VBimDocumentChangedEventArgs
    //   VBimEventType::DialogBoxShowing → VBimDialogBoxShowingEventArgs
    //   VBimEventType::ApplicationInitialized / ApplicationClosing / Idling
    //                                   → VBimEventArgs (no data)
    //
    // A handler that throws is logged and removed; dispatch continues with the
    // remaining handlers.
    //
    VBimEventHandlerId Subscribe(
        VBimEventType                             type,
        std::function<void(const VBimEventArgs&)> handler);

    // Removes a previously registered handler.
    // No-op if id is 0 or already removed.
    //
    void Unsubscribe(VBimEventHandlerId id);

private:
    // Internal owner handle.
    // Set by VBimUIApplication before providing EventManager() to callers.
    //
    friend class VBimUIApplication;
    void SetInternalOwner(void* pOwner);

    void* m_pOwner = nullptr;
};
