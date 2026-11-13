#pragma once

#include "../VinaBIMApiExport.h"

#include "Base/BmObjectId.h"
#include "Ge/GePoint3d.h"
#include "windef.h"

class OdBmDatabase;

// Regenerates all model graphics through the active Host editor service.
// Must be called from the UI thread while a document is active.
VINABIM_API void regenAllModel();

// Enables or disables the Host ribbon during a modal command workflow.
// This changes UI state only and must be called from the UI thread.
VINABIM_API void vbedEnableRibbonBar(BOOL isEnable);

// Returns the Host main-window handle, or nullptr before Host registration.
// The returned handle is non-owning and remains valid only for the window lifetime.
VINABIM_API HWND vbimMainWnd();

// Marks the active viewport dirty without forcing a full model regeneration.
// pDb is a non-owning pointer and must refer to the active open database.
VINABIM_API void vbimInvalidateActiveView(OdBmDatabase* pDb);

// Returns the active drawing ID tracked by the Host rendering device.
// Returns OdBmObjectId::kNull when no rendering device is active.
VINABIM_API OdBmObjectId vbimGetStableActiveDrawingId();

// Restores the active drawing after an ODA operation changes it as a side effect.
// The call is idempotent and must be made outside an open ODA transaction.
VINABIM_API void vbimRestoreActiveDrawing(
    OdBmDatabase* pDb,
    const OdBmObjectId& drawingId);

/**
 * @brief Sets the status bar text displayed in the host application.
 * @param text The text message to display on the status bar.
 * @note Must be called from the UI thread.
 */
VINABIM_API void vbimSetStatusText(const OdString& text);

// Loads elements created or changed by the running command into the view:
// cleans the active DB view's graphics cache and invalidates the GS model with
// kInvalidateAll, then repaints. Use it after committing a NEW element;
// vbimInvalidateActiveView() / VBimUIDocument::RefreshActiveView() only redraw
// elements the GS model already knows, so a new one stays invisible until the
// command ends. Call outside an open transaction, on the UI thread.
VINABIM_API void vbimRefreshAfterModelChange();

/**
 * @brief Rebuilds the graphics of the active view so a structural change of the open drawing becomes visible.
 * @details Typically used when a viewport is added to the open sheet with OdBmDBViewDrafting::addView(), which
 *          regen and vbimRefreshAfterModelChange() cannot show. After the running command returns, the Host
 *          replaces the tab's view window with a new one (as when the tab is reopened): the view is zoomed
 *          to extents and the selection of that view is cleared.
 *
 *          Does nothing without an active view. Call after the transaction is committed, outside any open
 *          transaction, on the UI thread. Nothing changes inside this call; the rebuild happens once the command has ended.
 */
VINABIM_API void vbimRebuildActiveViewGraphics();

// Re-runs the point tracker of the getPoint() that is waiting on the active
// view, at the last cursor position, so a preview follows an option changed
// from Host UI (Properties Type Selector, ribbon control) without a mouse move.
// Works for any OdEdPointTracker passed to getPoint(), not only VinaBIM jigs.
// The point is the raw cursor point: object snap is not re-applied.
// Returns false when no getPoint() with a tracker is waiting. UI thread only.
VINABIM_API bool vbimRefreshActiveJigPreview();

// Shows the element just committed in the Properties pane (same refresh the
// Host Component command does after a placement). Call after the transaction
// that created it commits, never for an element in an open transaction. While
// the command owns a Type Selector session, the plugin's type list is kept.
// UI thread only.
VINABIM_API void vbimNotifyEntityPlaced(OdBmObjectId id);

// Rebuilds the Project Browser "Families" tree, e.g. after the plugin loaded a
// family with OdBmDatabase::loadFamily(). Call outside an open transaction, on
// the UI thread.
VINABIM_API void vbimUpdateFamilyBrowser();

// ---------------------------------------------------------------------------
// Snap scope — object snap and Temporary Dimensions for a command's getPoint().
//
// While a scope is active, every mouse move in getPoint() runs, in this order:
//   1. the Host object snap, which may replace the cursor point;
//   2. OdEdPointTracker::setValue(point) of the command's tracker;
//   3. the Temporary Dimensions to nearby references.
// Outside a scope the view applies no object snap and shows no Temporary
// Dimensions. Open the scope immediately before getPoint()/drag() and close it
// immediately after (prefer VBimSnapScope below). UI thread only; a scope is
// global to the application, not per view. The getPoint() options
// OdEd::kGptNoOSnap and OdEd::kGptRectFrame still turn object snap off.
// ---------------------------------------------------------------------------

// Opens (true) or closes (false) the snap scope.
VINABIM_API void vbimSetVbimSnapScopeActive(bool enabled);

// Returns true while a snap scope is open. The doubled "Active" in the name is
// historical and kept: the name is the exported symbol.
VINABIM_API bool vbimIsVbimSnapScopeActiveActive();

// Excludes one element (e.g. the one being moved) from snapping and from
// Temporary Dimension references for the open scope. A null id excludes nothing.
VINABIM_API void vbimSetVbimSnapScopeSubjectId(const OdBmObjectId& subjectId);

// Returns the element excluded in the open scope, or a null id.
VINABIM_API OdBmObjectId vbimVbimSnapScopeSubjectId();

// Publishes the world-space bounds of the command's preview so Temporary
// Dimension labels avoid covering it. Presentation input only: it never changes
// a measured distance. Pass valid = false when no preview is shown.
VINABIM_API void vbimSetVbimSnapScopePreviewBounds(
    const OdGePoint3d& minimum, const OdGePoint3d& maximum, bool valid);

// Returns the published preview bounds, or false (outputs untouched) when none.
VINABIM_API bool vbimVbimSnapScopePreviewBounds(OdGePoint3d& minimum, OdGePoint3d& maximum);

// Hides the Host Temporary Dimensions for the open scope; set it when the
// command draws its own listening dimension. Cleared when the scope closes.
VINABIM_API void vbimSetVbimSnapScopeTemporaryDimensionsSuppressed(bool suppressed);

// Returns true while the open scope hides the Temporary Dimensions; false
// outside a scope.
VINABIM_API bool vbimVbimSnapScopeTemporaryDimensionsSuppressed();

// Records whether the current mouse move's point came from an object snap.
// Written by the view on every mouse move of the open scope; plugins do not
// need to call it.
VINABIM_API void vbimSetVbimSnapScopePointSnapped(bool snapped);

// Returns true when the point just given to OdEdPointTracker::setValue() came
// from an object snap, so the tracker can let the snap win over its own soft
// axis tracking. Read it inside setValue(). False outside a scope.
VINABIM_API bool vbimVbimSnapScopePointSnapped();

// RAII snap scope for one getPoint()/drag() call: opens the scope on
// construction; on destruction clears the preview bounds, the Temporary
// Dimension suppression and the point-snapped flag, restores the enclosing
// subject (subject overload only) and closes the scope. Header-only: it calls
// the exported functions above and adds no symbol. Same behaviour as the Host's
// internal VbimSnapScopeGuard.
//
//   {
//       VBimSnapScope scope;                      // or scope(subjectId)
//       vbimSetVbimSnapScopeTemporaryDimensionsSuppressed(true); // own dimension
//       pt = pIO->getPoint(prompt, options, nullptr, OdString::kEmpty, &tracker);
//   }
//
class VBimSnapScope
{
public:
    VBimSnapScope() { vbimSetVbimSnapScopeActive(true); }

    explicit VBimSnapScope(const OdBmObjectId& subjectId)
        : m_previousSubjectId(vbimVbimSnapScopeSubjectId())
        , m_restoreSubjectId(true)
    {
        vbimSetVbimSnapScopeActive(true);
        vbimSetVbimSnapScopeSubjectId(subjectId);
    }

    ~VBimSnapScope()
    {
        vbimSetVbimSnapScopePreviewBounds(OdGePoint3d(), OdGePoint3d(), false);
        vbimSetVbimSnapScopeTemporaryDimensionsSuppressed(false);
        vbimSetVbimSnapScopePointSnapped(false);
        if (m_restoreSubjectId)
            vbimSetVbimSnapScopeSubjectId(m_previousSubjectId);
        vbimSetVbimSnapScopeActive(false);
    }

    VBimSnapScope(const VBimSnapScope&) = delete;
    VBimSnapScope& operator=(const VBimSnapScope&) = delete;

private:
    OdBmObjectId m_previousSubjectId;
    bool         m_restoreSubjectId = false;
};

