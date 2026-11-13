///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Selection Engine
// VBimPickerService.h — Engine-level service for interactive picking.
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "domain/public_api/VinaBIMApiExport.h"
#include "domain/public_api/selection/IVBimPickerService.h"
#include "domain/public_api/selection/VBimSelectionTypes.h"
#include "domain/public_api/selection/IVBimSelectionFilter.h"

class CVinaBIMDoc;

/**
 * @class VBimPickerService
 * @brief High-level service providing interactive picking with
 * 3D bounding box preview, geometric snapping, and B-Rep subentity modes.
 */
class VINABIM_API VBimPickerService : public IVBimPickerService
{
public:
    VBimPickerService() = default;
    ~VBimPickerService() override = default;

    using IVBimPickerService::pick;

    /**
     * @brief Singleton accessor.
     */
    static VBimPickerService& instance();

    /**
     * @brief Performs interactive picking of an element or B-Rep subentity.
     */
    bool pick(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        VBimReference& result,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr) override;

    /**
     * @brief Convenience overload returning element ID.
     */
    bool pick(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        OdBmObjectId& resultId,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr) override;

    /**
     * @brief Performs interactive multi-picking of elements or B-Rep subentities.
     * @param pDoc Document context.
     * @param mode Selection mode.
     * @param prompt Status text prompt displayed to user.
     * @param[out] results Receives collected references.
     * @param snapMode Allowed snap types during picking.
     * @param pFilter Optional selection filter.
     * @param pPreselected Optional preselected references.
     * @return true if confirmed; false if cancelled.
     */
    bool pickMultiple(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        std::vector<VBimReference>& results,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr,
        const std::vector<VBimReference>* pPreselected = nullptr) override;

    /**
     * @brief Convenience overload for pickMultiple returning an array of element IDs.
     * @param pDoc Document context.
     * @param mode Selection mode.
     * @param prompt Status text prompt displayed to user.
     * @param[out] resultIds Receives picked element IDs.
     * @param snapMode Allowed snap types during picking.
     * @param pFilter Optional selection filter.
     * @return true if confirmed; false if cancelled.
     */
    bool pickMultiple(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        OdBmObjectIdArray& resultIds,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr) override;

    /**
     * @brief Interactively picks a 3D world-space point using the geometric snap engine and snap glyphs.
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] resultPoint Receives picked coordinate.
     * @param snapSettings Allowed geometric snap types.
     * @return true if point was picked; false if cancelled (Esc).
     */
    bool pickPoint(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        OdGePoint3d& resultPoint,
        VBimObjectSnapTypes snapSettings = VBimObjectSnapTypes::All) override;

    /**
     * @brief Prompts the user to specify a rectangular area on screen via two corner clicks (Revit PickBox equivalent).
     * @param pDoc Document context.
     * @param style Box selection style (Crossing, Enclosing, Directional).
     * @param prompt Status text prompt.
     * @param[out] resultBox Receives picked 3D box extents.
     * @return true if box was picked; false if cancelled.
     */
    bool pickBox(
        CVinaBIMDoc* pDoc,
        VBimPickBoxStyle style,
        const OdString& prompt,
        VBimPickedBox& resultBox) override;

    /**
     * @brief Prompts the user to select multiple elements by drawing a rectangle (Revit PickElementsByRectangle equivalent).
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] resultIds Receives IDs of elements within or crossing the rectangle.
     * @param pFilter Optional element filter.
     * @param style Box selection style.
     * @return true if elements were selected; false if cancelled.
     */
    bool pickElementsByRectangle(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        OdBmObjectIdArray& resultIds,
        IVBimSelectionFilter* pFilter = nullptr,
        VBimPickBoxStyle style = VBimPickBoxStyle::Directional) override;

    /**
     * @brief Overload of pickElementsByRectangle returning vector of VBimReference.
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] results Receives collected references.
     * @param pFilter Optional element filter.
     * @param style Box selection style.
     * @return true if elements were selected; false if cancelled.
     */
    bool pickElementsByRectangle(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        std::vector<VBimReference>& results,
        IVBimSelectionFilter* pFilter = nullptr,
        VBimPickBoxStyle style = VBimPickBoxStyle::Directional) override;

    /**
     * @brief Static convenience helper for full result.
     * @param pDoc Document context.
     * @param mode Selection mode.
     * @param prompt Status text prompt.
     * @param[out] result Receives picked reference.
     * @param snapMode Allowed snap types.
     * @param pFilter Optional selection filter.
     * @return true if selected; false if cancelled.
     */
    static bool Pick(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        VBimReference& result,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr);

    /**
     * @brief Static convenience helper for ObjectId result.
     * @param pDoc Document context.
     * @param mode Selection mode.
     * @param prompt Status text prompt.
     * @param[out] resultId Receives picked element ID.
     * @param snapMode Allowed snap types.
     * @param pFilter Optional selection filter.
     * @return true if selected; false if cancelled.
     */
    static bool Pick(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        OdBmObjectId& resultId,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr);

    /**
     * @brief Static convenience helper for multi-pick.
     * @param pDoc Document context.
     * @param mode Selection mode.
     * @param prompt Status text prompt.
     * @param[out] results Receives collected references.
     * @param snapMode Allowed snap types.
     * @param pFilter Optional selection filter.
     * @param pPreselected Optional initial selection.
     * @return true if confirmed; false if cancelled.
     */
    static bool PickMultiple(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        std::vector<VBimReference>& results,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr,
        const std::vector<VBimReference>* pPreselected = nullptr);

    /**
     * @brief Static convenience helper for multi-pick returning element IDs.
     * @param pDoc Document context.
     * @param mode Selection mode.
     * @param prompt Status text prompt.
     * @param[out] resultIds Receives picked element IDs.
     * @param snapMode Allowed snap types.
     * @param pFilter Optional selection filter.
     * @return true if confirmed; false if cancelled.
     */
    static bool PickMultiple(
        CVinaBIMDoc* pDoc,
        VBimObjectType mode,
        const OdString& prompt,
        OdBmObjectIdArray& resultIds,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr);

    /**
     * @brief Static convenience helper for snap point pick.
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] resultPoint Receives picked coordinate.
     * @param snapSettings Allowed geometric snap types.
     * @return true if point was picked; false if cancelled (Esc).
     */
    static bool PickPoint(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        OdGePoint3d& resultPoint,
        VBimObjectSnapTypes snapSettings = VBimObjectSnapTypes::All);

    /**
     * @brief Static convenience helper for box pick.
     * @param pDoc Document context.
     * @param style Box selection style.
     * @param prompt Status text prompt.
     * @param[out] resultBox Receives picked 3D box extents.
     * @return true if box was picked; false if cancelled.
     */
    static bool PickBox(
        CVinaBIMDoc* pDoc,
        VBimPickBoxStyle style,
        const OdString& prompt,
        VBimPickedBox& resultBox);

    /**
     * @brief Static convenience helper for rectangular element pick.
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] resultIds Receives IDs of elements within or crossing the rectangle.
     * @param pFilter Optional element filter.
     * @param style Box selection style.
     * @return true if elements were selected; false if cancelled.
     */
    static bool PickElementsByRectangle(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        OdBmObjectIdArray& resultIds,
        IVBimSelectionFilter* pFilter = nullptr,
        VBimPickBoxStyle style = VBimPickBoxStyle::Directional);

    /**
     * @brief Static convenience helper for rectangular reference pick.
     * @param pDoc Document context.
     * @param prompt Status text prompt.
     * @param[out] results Receives collected references.
     * @param pFilter Optional element filter.
     * @param style Box selection style.
     * @return true if elements were selected; false if cancelled.
     */
    static bool PickElementsByRectangle(
        CVinaBIMDoc* pDoc,
        const OdString& prompt,
        std::vector<VBimReference>& results,
        IVBimSelectionFilter* pFilter = nullptr,
        VBimPickBoxStyle style = VBimPickBoxStyle::Directional);

    /**
     * @brief Static convenience helper for backward compatibility with VBimPickResult.
     */
    static bool Pick(
        CVinaBIMDoc* pDoc,
        VBimPickMode mode,
        const OdString& prompt,
        VBimPickResult& result,
        SnapMode snapMode = SnapMode::All)
    {
        VBimReference ref;
        VBimObjectSnapTypes pubSnap = toVBimObjectSnapTypes(snapMode);

        bool ok = Pick(pDoc, mode, prompt, ref, pubSnap, nullptr);
        result = ref;
        result.snapMode = snapMode;
        return ok;
    }
};
