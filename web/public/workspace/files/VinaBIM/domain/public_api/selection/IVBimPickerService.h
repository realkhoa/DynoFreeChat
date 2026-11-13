///////////////////////////////////////////////////////////////////////////////
// VinaBIM Native SDK — Public API
// Picker Service Contract
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "VBimSelectionTypes.h"
#include "IVBimSelectionFilter.h"
#include "Base/BmObjectIdArray.h"
#include "OdString.h"

class CVinaBIMDoc;

/**
 * @brief Converts legacy SnapMode bitmask to VBimObjectSnapTypes.
 *
 * Checks each SnapMode flag using bitwise AND and combines corresponding public snap flags.
 * Combined modes (e.g. Endpoint | Midpoint) enable only requested flags, Off remains disabled.
 */
inline VBimObjectSnapTypes toVBimObjectSnapTypes(SnapMode snapMode)
{
    if (snapMode == SnapMode::Off)
        return VBimObjectSnapTypes::Off;

    VBimObjectSnapTypes pubSnap = VBimObjectSnapTypes::None;
    if (static_cast<std::uint32_t>(snapMode & SnapMode::Endpoint))
        pubSnap = pubSnap | VBimObjectSnapTypes::Endpoints;
    if (static_cast<std::uint32_t>(snapMode & SnapMode::Midpoint))
        pubSnap = pubSnap | VBimObjectSnapTypes::Midpoints;
    if (static_cast<std::uint32_t>(snapMode & SnapMode::Nearest))
        pubSnap = pubSnap | VBimObjectSnapTypes::Nearest;

    return pubSnap;
}

/**
 * @class IVBimPickerService
 * @brief Engine-level interface contract for interactive element/subentity picking.
 */
class IVBimPickerService
{
public:
    virtual ~IVBimPickerService() = default;

    /**
     * @brief Converts legacy SnapMode bitmask to VBimObjectSnapTypes.
     */
    static VBimObjectSnapTypes toVBimObjectSnapTypes(SnapMode snapMode)
    {
        return ::toVBimObjectSnapTypes(snapMode);
    }

    /**
     * @brief Performs interactive picking of an element or B-Rep subentity.
     */
    virtual bool pick(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        VBimReference& result,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr) = 0;

    /**
     * @brief Convenience overload returning element ID.
     */
    virtual bool pick(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        OdBmObjectId& resultId,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr) = 0;

    /**
     * @brief Performs interactive multi-picking of elements or B-Rep subentities.
     * User can select multiple items. Pressing Enter/Space finishes selection; Escape cancels.
     * @param pDoc Document context.
     * @param mode Selection mode.
     * @param prompt Status text prompt displayed to user.
     * @param[out] results Receives collected references.
     * @param snapMode Allowed snap types during picking.
     * @param pFilter Optional filter.
     * @param pPreselected Optional preselected references to initialize the collection with.
     * @return true if selection completed (Enter/Space pressed with at least one item or user accepted); false on Escape.
     */
    virtual bool pickMultiple(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        std::vector<VBimReference>& results,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr,
        const std::vector<VBimReference>* pPreselected = nullptr) = 0;

    /**
     * @brief Convenience overload for pickMultiple returning an array of element IDs.
     * @param pDoc Document context.
     * @param mode Selection mode.
     * @param prompt Status text prompt displayed to user.
     * @param[out] resultIds Receives picked element IDs.
     * @param snapMode Allowed snap types during picking.
     * @param pFilter Optional selection filter.
     * @return true if selection was confirmed; false if cancelled.
     */
    virtual bool pickMultiple(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        OdBmObjectIdArray& resultIds,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr) = 0;

    /**
     * @brief Interactively picks a 3D world-space point using the geometric snap engine and snap glyphs.
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] resultPoint Receives picked coordinate.
     * @param snapSettings Allowed geometric snap types.
     * @return true if point was picked; false if cancelled (Esc).
     */
    virtual bool pickPoint(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        OdGePoint3d& resultPoint,
        VBimObjectSnapTypes snapSettings = VBimObjectSnapTypes::All) = 0;

    /**
     * @brief Prompts the user to specify a rectangular area on screen via two corner clicks (Revit PickBox equivalent).
     * @param pDoc Document context.
     * @param style Box selection style (Crossing, Enclosing, Directional).
     * @param prompt Status text prompt.
     * @param[out] resultBox Receives picked 3D box extents.
     * @return true if box was picked; false if cancelled.
     */
    virtual bool pickBox(
        CVinaBIMDoc* pDoc,
        VBimPickBoxStyle style,
        const OdString& prompt,
        VBimPickedBox& resultBox) = 0;

    /**
     * @brief Prompts the user to select multiple elements by drawing a rectangle (Revit PickElementsByRectangle equivalent).
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] resultIds Receives IDs of elements within or crossing the rectangle.
     * @param pFilter Optional element filter.
     * @param style Box selection style.
     * @return true if elements were selected; false if cancelled.
     */
    virtual bool pickElementsByRectangle(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        OdBmObjectIdArray& resultIds,
        IVBimSelectionFilter* pFilter = nullptr,
        VBimPickBoxStyle style = VBimPickBoxStyle::Directional) = 0;

    /**
     * @brief Overload of pickElementsByRectangle returning vector of VBimReference.
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] results Receives collected references.
     * @param pFilter Optional element filter.
     * @param style Box selection style.
     * @return true if elements were selected; false if cancelled.
     */
    virtual bool pickElementsByRectangle(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        std::vector<VBimReference>& results,
        IVBimSelectionFilter* pFilter = nullptr,
        VBimPickBoxStyle style = VBimPickBoxStyle::Directional) = 0;

    /**
     * @brief Backward-compatible pick overload accepting legacy VBimPickResult and SnapMode.
     */
    virtual bool pick(
        CVinaBIMDoc* pDoc,
        VBimPickMode mode,
        const OdString& prompt,
        VBimPickResult& result,
        SnapMode snapMode = SnapMode::All)
    {
        VBimReference ref;
        VBimObjectSnapTypes pubSnap = toVBimObjectSnapTypes(snapMode);

        bool ok = pick(pDoc, mode, prompt, ref, pubSnap, nullptr);
        result = ref;
        result.snapMode = snapMode;
        return ok;
    }
};
