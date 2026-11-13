///////////////////////////////////////////////////////////////////////////////
// VinaBIM Native SDK — Public API
// Selection Facade
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "../VinaBIMApiExport.h"
#include "VBimSelectionTypes.h"
#include "IVBimSelectionFilter.h"
#include "Base/BmObjectId.h"
#include "Base/BmObjectIdArray.h"
#include "Ge/GePoint3d.h"
#include "OdResult.h"
#include "OdString.h"

class CVinaBIMDoc;
class VBimElementProperties;

/**
 * @class VBimSelection
 * @brief Selection service facade for VinaBIM SDK developers.
 *
 * Proxy pattern: obtain only via VBimUIDocument::Selection() or SelectionService().
 * Do not cache this pointer across document activations.
 *
 * Threading: All methods must be called from the UI thread.
 */
class VINABIMCORE_DLLEXPORT VBimSelection
{
public:
    // UI-thread only; one opt-in session at a time. Token binds document,
    // database, drawing, view and GS identity. Old overloads are unchanged.
    /**
     * @brief Begins an interactive selection session on the UI thread.
     * @note One session at a time; token binds document, database, drawing, view, and GS context.
     * @return VBimSelectionSessionToken Non-zero token identifying the session, or 0 on failure.
     */
    VBimSelectionSessionToken BeginSession();
    /**
     * @brief Ends an active selection session and releases its resources.
     * @param token Selection session token obtained from BeginSession().
     */
    static void EndSession(VBimSelectionSessionToken token) noexcept;

    /**
     * @brief Checks if a selection session token is valid and currently active.
     * @param token Selection session token to test.
     * @return true if valid and active; false otherwise.
     */
    static bool IsSessionValid(VBimSelectionSessionToken token);

    /**
     * @brief Cancels an active selection session, aborting any pending pick operations.
     * @param token Selection session token to cancel.
     */
    static void CancelSession(VBimSelectionSessionToken token) noexcept;

    /**
     * @brief Attaches a lifecycle and event observer to the selection session.
     * @param token Active selection session token.
     * @param observer Pointer to observer interface.
     */
    static void SetSessionObserver(VBimSelectionSessionToken token,
        IVBimSelectionSessionObserver* observer);

    /**
     * @brief Retrieves the Win32 window handle hosting the selection session.
     * @param token Active selection session token.
     * @return HWND window handle (as void*), or nullptr if invalid.
     */
    static void* SessionWindow(VBimSelectionSessionToken token);

    /**
     * @brief Sets an optional borrowed Win32 cursor (HCURSOR) for the session's pick inputs.
     * @param token Active selection session token.
     * @param cursor Win32 HCURSOR handle (nullptr resets to default).
     */
    static void SetSessionCursor(VBimSelectionSessionToken token, void* cursor);

    /**
     * @brief Session-bound object picking with explicit session token.
     * @param type Object type filter.
     * @param prompt Status prompt displayed in UI.
     * @param[out] result Pick reference outcome.
     * @param filter Custom selection filter callback.
     * @param token Active selection session token.
     * @return true if picked; false on cancel/ESC.
     * @throws OdEdOtherInput, OdEdEmptyInput, OdEdKeyword and other SDK errors
     * propagate to the command so Enter/Finish/keywords retain their input flow.
     */
    bool PickObject(VBimObjectType type, const OdString& prompt,
        VBimReference& result, IVBimSelectionFilter* filter,
        VBimSelectionSessionToken token);

    /**
     * @brief Session-bound 3D point picking with explicit session token.
     * @note Performs raw 3D point picking without object snapping.
     * @param prompt Status prompt displayed in UI.
     * @param[out] point Picked 3D point in world coordinates.
     * @param snaps Reserved parameter; currently ignored as caller performs its own projection or snapping.
     * @param token Active selection session token.
     * @return true if point picked; false on cancel/ESC.
     * @throws OdEdOtherInput, OdEdEmptyInput, OdEdKeyword and other SDK errors
     * propagate to the command; only ESC is converted to false.
     */
    bool PickPoint(const OdString& prompt, OdGePoint3d& point,
        VBimObjectSnapTypes snaps, VBimSelectionSessionToken token);

    /**
     * @brief Interactively picks an element or B-Rep subentity with 3D Bounding Box preview, snap, and dynamic pre-highlight.
     * @param objectType Selection mode (Element, PointOnElement, Edge, Face, LinkedElement).
     * @param prompt Status text prompt displayed to user.
     * @param[out] result Output container holding picked element and geometry info.
     * @param pFilter Optional filter determining which elements/subentities are eligible.
     * @return true if picked; false if cancelled (Esc).
     */
    bool PickObject(
        VBimObjectType objectType,
        const OdString& prompt,
        VBimReference& result,
        IVBimSelectionFilter* pFilter = nullptr);

    /**
     * @brief Convenience overload: picks an element or subentity and returns its element ID.
     */
    bool PickObject(
        VBimObjectType objectType,
        const OdString& prompt,
        OdBmObjectId& resultId,
        IVBimSelectionFilter* pFilter = nullptr);

    /**
     * @brief Legacy single-element pick.
     */
    bool PickObject(const OdString& prompt, OdBmObjectId& resultId);

    /**
     * @brief Prompts the user to select multiple objects (Revit Selection.PickObjects equivalent).
     * Pressing Enter or Space finishes selection; Escape cancels the entire operation.
     * @param objectType Selection mode (Element, PointOnElement, Edge, Face, LinkedElement).
     * @param prompt Status text prompt displayed to user.
     * @param[out] results Receives the list of picked references.
     * @param pFilter Optional selection filter.
     * @param pPreselected Optional initial pre-selected references.
     * @return true if selection was confirmed (Enter); false if cancelled (Esc).
     */
    bool PickObjects(
        VBimObjectType objectType,
        const OdString& prompt,
        std::vector<VBimReference>& results,
        IVBimSelectionFilter* pFilter = nullptr,
        const std::vector<VBimReference>* pPreselected = nullptr);

    /**
     * @brief Prompts the user to select multiple objects and returns their element IDs.
     * @param objectType Selection mode.
     * @param prompt Status text prompt.
     * @param[out] resultIds Receives the array of picked element IDs.
     * @param pFilter Optional selection filter.
     * @return true if confirmed; false if cancelled.
     */
    bool PickObjects(
        VBimObjectType objectType,
        const OdString& prompt,
        OdBmObjectIdArray& resultIds,
        IVBimSelectionFilter* pFilter = nullptr);

    /**
     * @brief Prompts the user to specify a rectangular area on the screen (Revit Selection.PickBox equivalent).
     * Uses a general-purpose two-corner click editor with live rectangular frame preview.
     * @param style Controls box selection style (Crossing, Enclosing, Directional).
     * @param prompt Status text prompt.
     * @param[out] resultBox Receives picked 3D box extents.
     * @return true if picked; false if cancelled.
     */
    bool PickBox(
        VBimPickBoxStyle style,
        const OdString& prompt,
        VBimPickedBox& resultBox);

    /**
     * @brief Prompts the user to select multiple elements by drawing a rectangle (Revit Selection.PickElementsByRectangle equivalent).
     * @param prompt Status text prompt.
     * @param[out] resultIds Receives the array of selected element IDs.
     * @param pFilter Optional filter for allowed elements.
     * @param style Box selection style (Directional by default).
     * @return true if selected; false if cancelled.
     */
    bool PickElementsByRectangle(
        const OdString& prompt,
        OdBmObjectIdArray& resultIds,
        IVBimSelectionFilter* pFilter = nullptr,
        VBimPickBoxStyle style = VBimPickBoxStyle::Directional);

    /**
     * @brief Overload of PickElementsByRectangle returning vector of VBimReference.
     * @param prompt Status text prompt.
     * @param[out] results Receives collected references.
     * @param pFilter Optional element filter.
     * @param style Box selection style (Directional by default).
     * @return true if selected; false if cancelled.
     */
    bool PickElementsByRectangle(
        const OdString& prompt,
        std::vector<VBimReference>& results,
        IVBimSelectionFilter* pFilter = nullptr,
        VBimPickBoxStyle style = VBimPickBoxStyle::Directional);

    /**
     * @brief Interactively picks a 3D world-space point from the active view.
     * @param prompt Status text prompt.
     * @param[out] resultPoint Receives picked 3D world coordinate.
     * @param snapSettings Allowed geometric snap modes.
     * @return true if point was picked; false if cancelled (Esc).
     */
    bool PickPoint(
        const OdString& prompt,
        OdGePoint3d& resultPoint,
        VBimObjectSnapTypes snapSettings = VBimObjectSnapTypes::All);

    /**
     * @brief Interactively picks where a view's viewport goes on the sheet open in the active view.
     *
     * A rectangle the size of the viewport (crop region / view scale, or an
     * approximate placeholder when the view has no crop) follows the cursor,
     * with a warning colour when it leaves the titleblock or overlaps another
     * viewport, until the user clicks, presses ESC or right-clicks.
     *
     * Does not modify the database and opens no transaction: pass the returned
     * point to OdBmDBViewDrafting::addView() inside your own OdBmTransaction.
     * Must be called from inside a command's execute(); UI thread only. The
     * preview is removed before returning.
     *
     * @param viewId View (OdBmDBView) to place; plugin-supplied ids are checked with ::cast().
     * @param[out] location Sheet point to use as the addView() location (z = 0).
     * @return eOk when picked; eUserBreak when cancelled; eNotApplicable when the
     *         active view is not a sheet or the view cannot go on it (already on a
     *         sheet, template, unsupported type); eWrongObjectType when viewId is
     *         not a view; eNoDatabase without an active document or view.
     */
    OdResult PickViewportLocation(const OdBmObjectId& viewId, OdGePoint3d& location);

    /**
     * @brief Returns the current PickFirst pre-selection as an array of element IDs.
     */
    OdBmObjectIdArray GetElementIds() const;

    /**
     * @brief Replaces the current editor selection with the given element IDs.
     * @param ids Array of element object IDs to select. If empty, clears the selection.
     */
    void SetElementIds(const OdBmObjectIdArray& ids);

    /**
     * @brief Clears the current editor selection.
     */
    void Clear();

    /**
     * @brief Returns an element properties facade for the primary currently selected element.
     * @return VBimElementProperties Facade for active selection, or invalid object if nothing selected.
     */
    VBimElementProperties GetActiveProperties();

    // Backward compatibility Pick() overloads:
    bool Pick(
        VBimObjectType mode,
        const OdString& prompt,
        VBimReference& result,
        IVBimSelectionFilter* pFilter = nullptr);

    bool Pick(
        VBimPickMode mode,
        const OdString& prompt,
        VBimPickResult& result,
        IVBimSelectionFilter* pFilter = nullptr);

    bool Pick(
        VBimObjectType mode,
        const OdString& prompt,
        OdBmObjectId& resultId,
        IVBimSelectionFilter* pFilter = nullptr);

private:
    friend class VBimUIDocument;

    /**
     * @brief Internal document binding helper used by VBimUIDocument.
     * @param pDoc Document pointer.
     */
    void SetInternalDoc(CVinaBIMDoc* pDoc);
    CVinaBIMDoc* m_pDoc = nullptr;
};
