// VBimUIDocument.h
//
// Document-level facade for VinaBIM SDK developers.
//
// Proxy pattern: obtain only via VBimUIApplication::ActiveUIDocument().
// Do not cache this pointer across document activations or document close.
// The same VBimUIDocument object is reused; calling ActiveUIDocument()
// always returns a pointer to the proxy refreshed with the current document.
//
// Threading: All methods must be called from the UI thread.
//
#pragma once

#include "../VinaBIMApiExport.h"
#include "../events/VBimEventManager.h"  // VBimView

#include "Base/BmObjectId.h"
#include "Base/BmObjectIdArray.h"
#include "OdArray.h"
#include "OdPlatform.h"
#include "OdResult.h"
#include "../properties/VBimProjectProperties.h"
#include "../properties/VBimElementProperties.h"
#include <memory>

class OdBmDatabase;
class VBimSelection;
class VBimSelectionService;
class CVinaBIMDoc;
class IUndoableAction;
class OdGeVector3d;
class OdGePoint3d;
class OdGeMatrix3d;
class OdaSnapshotDeltaAction;

// Document-level UI facade. Wraps CVinaBIMDoc and CVinaBIMView.
//
// The underlying CVinaBIMDoc is managed by VinaBIM. Do not store or delete
// any raw pointer obtained from this class beyond the scope of a single
// VBimUIApplication::ActiveUIDocument() call chain.
//
class VINABIMCORE_DLLEXPORT VBimUIDocument
{
public:

    /**
     * @brief Returns the underlying ODA BIM database.
     * Never nullptr when obtained via VBimUIApplication::ActiveUIDocument().
     * Maps to CVinaBIMDoc::database().
     * @return OdBmDatabase* Pointer to the active ODA BIM database.
     */
    OdBmDatabase* GetDatabase() const;

    /**
     * @brief Returns a Project Properties service facade for querying and editing project metadata.
     * @return VBimProjectProperties Facade bound to this document and its active database.
     */
    VBimProjectProperties ProjectProperties();

    /**
     * @brief Returns an element properties facade for querying and editing parameters of a specific element.
     * @param elementId The object ID of the element to inspect or modify.
     * @return VBimElementProperties Facade bound to this element in the active document.
     */
    VBimElementProperties GetElementProperties(const OdBmObjectId& elementId);

    /**
     * @brief Returns an element properties facade for the primary currently-selected element on screen.
     * @details If multiple elements are selected, the first element's properties are returned.
     * If no elements are selected, returns an invalid VBimElementProperties object (check with IsValid()).
     * @return VBimElementProperties Facade bound to active selection.
     */
    VBimElementProperties GetActiveSelectionProperties();

    /**
     * @brief Returns true when the currently active document is a family (.rfa) file, false for project (.rvt).
     * @return bool True if family document mode is active.
     */
    bool IsFamilyDocument() const;

    /**
     * @brief Invalidates and schedules a repaint of the active view without geometric regeneration.
     */
    void RefreshActiveView();

    /**
     * @brief Returns the active viewport background color configured in the host application.
     *
     * Enables export services (e.g. SVG, DWG) and view rendering to query the canvas
     * background without relying on legacy C-bridge functions.
     *
     * @return ODCOLORREF The RGB background color (format 0x00BBGGRR).
     * @note UI-thread only. Non-modifying query.
     */
    ODCOLORREF GetActiveBackgroundColor() const;

    /**
     * @brief Rebuilds the Project Browser tree (Views and Families sections) to reflect current DB state.
     * @details Call from the UI thread after creating/deleting views or loading families.
     * Safe to call at any time; no database transaction is opened. Must be called from the UI thread.
     */
    void RefreshProjectBrowser();

    /**
     * @brief Rebuilds or refreshes the Project Browser tree to reflect current DB state.
     * @param bForceReload If true, forces in-place update of view placement statuses even if layout count is unchanged.
     */
    void RefreshProjectBrowser(bool bForceReload);

    /**
     * @brief Opens a Schedule view in the MDI interface and makes it the active view.
     *
     * Resolves the layout drawing associated with the specified Schedule view object ID,
     * verifies that the underlying view type is Schedule, ColumnSchedule, or PanelSchedule,
     * creates or activates its MDI child frame, and refreshes the Project Browser selection.
     * Rejects non-schedule view types (e.g. FloorPlan, ThreeD) and ids of another document's
     * database, and handles ODA exceptions safely.
     *
     * @param scheduleId The OdBmObjectId of the schedule view (or its layout drawing).
     * @return true if the schedule was successfully resolved, validated, and opened; false otherwise.
     * @note Must be called from the UI thread after any modifying transaction has committed.
     *       Safe against OdError exceptions (returns false on error).
     */
    bool OpeningSchedule(const OdBmObjectId& scheduleId);

    /**
     * @brief Alias for OpeningSchedule adhering to Revit UIDocument naming conventions.
     * @param scheduleId The OdBmObjectId of the schedule view (or its layout drawing).
     * @return true if opened successfully; false otherwise.
     */
    bool OpenSchedule(const OdBmObjectId& scheduleId);

    // Opens any view or sheet of this document in its MDI tab and makes it the
    // active view: creates the tab, or activates it when already open, then
    // refreshes the Project Browser. Use it after creating a view or sheet so
    // the user lands on it (e.g. Create Sheet, Duplicate Sheet).
    //
    // viewId may be the view (OdBmDBView, e.g. OdBmDBViewDrafting of a sheet)
    // or its layout drawing (OdBmDBDrawing). Returns false, opening nothing,
    // for a null or unknown id, an id of another document's database, a view
    // template, or when ODA throws.
    //
    // Does not modify the database. UI thread only; call it after the
    // transaction that created the view has committed and outside a modal
    // dialog. Non-virtual: no SDK ABI change.
    //
    bool OpenView(const OdBmObjectId& viewId);

    /**
     * @brief Returns the selection proxy for this document.
     * @details Same proxy lifetime rules apply as VBimUIDocument — do NOT cache.
     * @return Pointer to VBimSelection proxy, or nullptr if no document is active.
     */
    VBimSelection* Selection();

    /**
     * @brief Alias for Selection() providing selection proxy access.
     * @return Pointer to VBimSelectionService proxy, or nullptr if no document is active.
     */
    VBimSelectionService* SelectionService();

    /**
     * @brief Zooms to and highlights the specified elements in the active view.
     * @param ids Array of element IDs to show.
     */
    void ShowElements(const OdBmObjectIdArray& ids);

    /**
     * @brief Selects ids in the active view (as TrySetElementIds) and zooms the view to their combined extents.
     * @details Does not switch views and does not modify the database. UI thread only.
     * @param ids Array of element IDs to show.
     * @return OdResult eOk on success, eInvalidInput for an empty array or an invalid id,
     * eNoDatabase without a document, or eNotApplicable without an active view or when none of the
     * elements has geometry extents (the selection is still applied).
     */
    OdResult TryShowElements(const OdBmObjectIdArray& ids);

    /**
     * @brief Fills views with a snapshot of the views open in this document's MDI frames.
     * @details One entry per distinct view, active one included. The entries hold ids only and
     * are not updated when frames open or close. Read-only; UI thread only. Analogous to Revit UIDocument.GetOpenUIViews().
     * @param views Output array of VBimView structures.
     * @return OdResult eOk (views may be empty) or eNoDatabase without a document.
     */
    OdResult GetOpenUIViews(OdArray<VBimView>& views) const;

    /**
     * @brief Makes viewId (an OdBmDBView of this document) the active view, opening an MDI frame when none is open.
     * @details Analogous to Revit UIDocument.RequestViewChange(view). UI thread only.
     * @param viewId Object ID of the view.
     * @return OdResult eOk on success, eNoDatabase without a document, eInvalidInput when viewId is not
     * a view of this document, or eNotApplicable while a command is running -- call it from an external event
     * or a modeless UI handler instead of from inside a command.
     */
    OdResult RequestViewChange(const OdBmObjectId& viewId);

    /**
     * @brief Zooms the active view to the extents of its visible model.
     * @return OdResult eOk on success.
     */
    OdResult ZoomToFit();

    /**
     * @brief Returns the stable identity of the currently active view in this document.
     * @return VBimView Active view descriptor.
     */
    VBimView ActiveView() const;

    /**
     * @brief Convenience accessor for the stable active view handle.
     * @return OdUInt64 Stable view handle, or 0 if inactive.
     */
    OdUInt64 ActiveViewId() const;

    /**
     * @brief Records an undoable delta action to the document's Undo stack.
     * @param action Shared pointer to the reversible action.
     */
    void RecordUndoAction(std::shared_ptr<IUndoableAction> action);

    /**
     * @brief Records an undoable delta action for a specific database.
     * @details Resolves the owning document from @p pDb. Skips recording if no document owns the database.
     * @param pDb Database mutated by the action.
     * @param action Shared pointer to the reversible action.
     */
    static void RecordUndoActionForDatabase(const OdBmDatabase* pDb, std::shared_ptr<IUndoableAction> action);

    /**
     * @brief Records creation of elements for Undo (Ctrl+Z).
     * @param ids Array of created element IDs.
     * @param name Descriptive action name (defaults to L"Create").
     */
    void RecordCreated(const OdBmObjectIdArray& ids, const OdString& name = L"Create");

    /**
     * @brief Records creation of a single element for Undo (Ctrl+Z).
     * @param id Created element ID.
     * @param name Descriptive action name (defaults to L"Create").
     */
    void RecordCreated(const OdBmObjectId& id, const OdString& name = L"Create");

    /**
     * @brief Records creation of elements from a vector for Undo (Ctrl+Z).
     * @param ids Vector of created element IDs.
     * @param name Descriptive action name (defaults to L"Create").
     */
    void RecordCreated(const std::vector<OdBmObjectId>& ids, const OdString& name = L"Create");

    /**
     * @brief Records geometric translation of elements for Undo (Ctrl+Z).
     * @param ids Array of moved element IDs.
     * @param delta Net displacement vector applied.
     * @param name Descriptive action name (defaults to L"Move").
     */
    void RecordMoved(const OdBmObjectIdArray& ids, const OdGeVector3d& delta, const OdString& name = L"Move");

    /**
     * @brief Records geometric translation of a single element for Undo (Ctrl+Z).
     * @param id Moved element ID.
     * @param delta Net displacement vector applied.
     * @param name Descriptive action name (defaults to L"Move").
     */
    void RecordMoved(const OdBmObjectId& id, const OdGeVector3d& delta, const OdString& name = L"Move");

    /**
     * @brief Records geometric translation of elements from a vector for Undo (Ctrl+Z).
     * @param ids Vector of moved element IDs.
     * @param delta Net displacement vector applied.
     * @param name Descriptive action name (defaults to L"Move").
     */
    void RecordMoved(const std::vector<OdBmObjectId>& ids, const OdGeVector3d& delta, const OdString& name = L"Move");

    /**
     * @brief Records geometric rotation of an element for Undo (Ctrl+Z).
     * @param id Element ID rotated.
     * @param center Rotation center point.
     * @param axis Rotation axis vector.
     * @param angle Rotation angle in radians.
     * @param name Descriptive action name.
     */
    void RecordRotated(const OdBmObjectId& id, const OdGePoint3d& center, const OdGeVector3d& axis, double angle, const OdString& name = L"Rotate");

    /**
     * @brief Records pre-image snapshot before deletion of elements for Undo (Ctrl+Z).
     * @note Must be called BEFORE deleting elements from the database.
     * @param ids Array of element IDs about to be deleted.
     * @param name Descriptive action name (defaults to L"Delete").
     */
    void RecordErased(const OdBmObjectIdArray& ids, const OdString& name = L"Delete");

    /**
     * @brief Records pre-image snapshot before deletion of a single element for Undo (Ctrl+Z).
     * @note Must be called BEFORE deleting element from the database.
     * @param id Element ID about to be deleted.
     * @param name Descriptive action name (defaults to L"Delete").
     */
    void RecordErased(const OdBmObjectId& id, const OdString& name = L"Delete");

    /**
     * @brief Records pre-image snapshot before deletion of elements from a vector for Undo (Ctrl+Z).
     * @note Must be called BEFORE deleting elements from the database.
     * @param ids Vector of element IDs about to be deleted.
     * @param name Descriptive action name (defaults to L"Delete").
     */
    void RecordErased(const std::vector<OdBmObjectId>& ids, const OdString& name = L"Delete");

    /**
     * @brief Records general matrix transformation (mirror, align, affine transform) for Undo (Ctrl+Z).
     * @param ids Array of element IDs transformed.
     * @param matrix 3D Transformation matrix applied.
     * @param name Descriptive action name (e.g. L"Mirror", L"Align").
     */
    void RecordMatrixTransformed(const OdBmObjectIdArray& ids, const OdGeMatrix3d& matrix, const OdString& name = L"Transform");

    /**
     * @brief Records general matrix transformation of a single element for Undo (Ctrl+Z).
     * @param id Element ID transformed.
     * @param matrix 3D Transformation matrix applied.
     * @param name Descriptive action name (defaults to L"Transform").
     */
    void RecordMatrixTransformed(const OdBmObjectId& id, const OdGeMatrix3d& matrix, const OdString& name = L"Transform");

    /**
     * @brief Records general matrix transformation of elements from a vector for Undo (Ctrl+Z).
     * @param ids Vector of element IDs transformed.
     * @param matrix 3D Transformation matrix applied.
     * @param name Descriptive action name (defaults to L"Transform").
     */
    void RecordMatrixTransformed(const std::vector<OdBmObjectId>& ids, const OdGeMatrix3d& matrix, const OdString& name = L"Transform");

    /**
     * @brief Creates an in-place element state mutation snapshot before modifications are made.
     * @note Does NOT register the action to the undo stack immediately. Callers must modify the
     * element, call CommitPostState() on the returned action, and then register it via RecordUndoAction().
     * @param id Element ID to snapshot.
     * @param name Descriptive action name (e.g. L"Edit Parameter").
     * @return Shared pointer to the snapshot action, or nullptr on failure.
     */
    std::shared_ptr<OdaSnapshotDeltaAction> RecordSnapshot(const OdBmObjectId& id, const OdString& name = L"Modify Element");
    /**
     * @brief Finalizes and commits post-state of a snapshot delta action to the undo stack.
     * @details Must be called AFTER modifications to record changes into the undo history.
     * @param database Target database context.
     * @param snapshot Shared pointer to snapshot action initialized via RecordSnapshot().
     * @throws OdError(eInvalidInput) If snapshot is null, has no pre/post state, or database mismatch.
     */
    static void CommitSnapshot(const OdBmDatabase* database,
        const std::shared_ptr<OdaSnapshotDeltaAction>& snapshot);

    /**
     * @brief Restores the pre-modification state of elements captured in the snapshot without altering the undo stack.
     * @param database Target database context.
     * @param snapshot Shared pointer to snapshot action.
     * @return true if pre-state was successfully restored; false otherwise.
     */
    static bool RestoreSnapshot(const OdBmDatabase* database,
        const std::shared_ptr<OdaSnapshotDeltaAction>& snapshot);

    /**
     * @brief Creates in-place element state mutation snapshots for multiple elements before modifications.
     * @note Does NOT register the action to the undo stack immediately. Callers must modify the
     * elements, call CommitPostState() on the returned action, and then register it via RecordUndoAction().
     * @param ids Array of element IDs to snapshot.
     * @param name Descriptive action name (e.g. L"Edit Parameter").
     * @return Shared pointer to the snapshot action, or nullptr on failure.
     */
    std::shared_ptr<OdaSnapshotDeltaAction> RecordSnapshot(const OdBmObjectIdArray& ids, const OdString& name = L"Modify Element");

    /**
     * @brief Begins a composite undo transaction scope.
     * @param name Descriptive transaction name.
     */
    void BeginCompositeUndo(const OdString& name = L"Composite Action");

    /**
     * @brief Commits and ends the active composite undo transaction scope.
     */
    void EndCompositeUndo();

    /**
     * @brief Cancels and discards the active composite undo transaction scope.
     */
    void CancelCompositeUndo();

    /**
     * @brief Internal document accessor for host integration.
     * @return Pointer to wrapped CVinaBIMDoc.
     */
    CVinaBIMDoc* GetInternalDoc() const noexcept { return m_pDoc; }

private:
    // Only VBimUIApplication may update the internal proxy target.
    friend class VBimUIApplication;
    friend class VBimCompositeUndoScope;

    /**
     * @brief Updates the proxy to wrap the given CVinaBIMDoc.
     * @param pDoc Pointer to internal CVinaBIMDoc.
     */
    void SetInternalDoc(CVinaBIMDoc* pDoc);

    CVinaBIMDoc* m_pDoc = nullptr;
};
