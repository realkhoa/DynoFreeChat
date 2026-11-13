///////////////////////////////////////////////////////////////////////////////
// VinaBIM Native SDK — Public API
// VBimReferenceExtractor.h — Unified generic reference extractor for all elements.
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "../VinaBIMApiExport.h"
#include "VBimSelectionTypes.h"
#include "Database/Entities/BmDBView.h"
#include "Database/BmElement.h"
#include "Database/Entities/BmGeomRef.h"
#include "Ge/GePoint3d.h"
#include "Ge/GeVector3d.h"

#include <vector>

/**
 * @class VBimReferenceExtractor
 * @brief Unified generic reference extractor for all BIM element categories.
 *
 * Implements generic extraction over the 4 canonical ODA / Revit geometry models:
 *   1. B-Rep Solids / Surfaces (Faces & Edges from OdBmGBrep / OdBmGGroup / OdBmGInstance)
 *   2. Curve Elements (OdBmCurveElem, OdBmRbsCurve, OdBmGCurve)
 *   3. Datum Elements (OdBmGrid, OdBmGridChain, OdBmDatumPlane, OdBmLevel)
 *   4. Location / Centerlines (getLocationCurve on linear elements)
 *
 * Eliminates the need for category-specific extractors by operating directly
 * on ODA's underlying topological and geometric representations.
 */
class VINABIM_API VBimReferenceExtractor
{
public:
    /**
     * @brief Extracts all dimensionable/selectable references from a given element.
     * @param elementId ID of the element to extract references from.
     * @param pView Optional view context (used for view-dependent curves or datums).
     * @param[out] outRefs Receives the extracted references.
     * @param pNearPt Optional 3D point to sort candidates by proximity.
     * @return true if one or more valid references were extracted; false otherwise.
     */
    static bool extract(
        const OdBmObjectId& elementId,
        OdBmDBViewPtr pView,
        std::vector<VBimReference>& outRefs,
        const OdGePoint3d* pNearPt = nullptr);

    /**
     * @brief Extracts B-Rep face and edge references from any element containing 3D geometry.
     * @param pElem The opened element pointer.
     * @param[out] outRefs Receives extracted face and edge references.
     * @return true if B-Rep geometry was successfully extracted; false otherwise.
     */
    static bool extractBRepReferences(
        const OdBmElementPtr& pElem,
        std::vector<VBimReference>& outRefs);

    /**
     * @brief Extracts curve references from linear elements (lines, MEP curves, rebars, etc.).
     * @param pElem The opened element pointer.
     * @param[out] outRefs Receives extracted curve references.
     * @return true if curve geometry was successfully extracted; false otherwise.
     */
    static bool extractCurveReferences(
        const OdBmElementPtr& pElem,
        std::vector<VBimReference>& outRefs);

    /**
     * @brief Extracts datum references (Grids, Grid Chains, Reference Planes, Levels).
     * @param pElem The opened element pointer.
     * @param pView Active view pointer.
     * @param[out] outRefs Receives extracted datum references.
     * @return true if datum geometry was successfully extracted; false otherwise.
     */
    static bool extractDatumReferences(
        const OdBmElementPtr& pElem,
        OdBmDBViewPtr pView,
        std::vector<VBimReference>& outRefs);

    /**
     * @brief Extracts location centerline reference (e.g. wall centerline, beam axis).
     * @param pElem The opened element pointer.
     * @param[out] outRefs Receives extracted centerline reference.
     * @return true if a location curve was found and extracted; false otherwise.
     */
    static bool extractLocationReferences(
        const OdBmElementPtr& pElem,
        std::vector<VBimReference>& outRefs);

    /**
     * @brief Helper to construct an OdBmGeomRef for a given element and subentity.
     * @param elemId Element ID.
     * @param subentType Subentity type (Face, Edge, or Null for datum/element).
     * @param subentIndex Subentity index or tag.
     * @return Newly created OdBmGeomRefPtr.
     */
    static OdBmGeomRefPtr createGeomRef(
        const OdBmObjectId& elemId,
        OdDb::SubentType subentType = OdDb::kNullSubentType,
        OdGsMarker subentIndex = 0);
};
