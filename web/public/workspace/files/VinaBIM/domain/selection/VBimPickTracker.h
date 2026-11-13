///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Selection Engine
// VBimPickTracker.h — Real-time interactive hover tracker for Pick API.
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "domain/public_api/VinaBIMApiExport.h"
#include "Ed/EdUserIO.h"
#include "domain/public_api/selection/VBimSelectionTypes.h"
#include "domain/public_api/selection/IVBimSelectionFilter.h"
#include "VBimPickBBoxDrawable.h"
#include "Infrastructure/Oda/snap/BmSnapGlyphDrawable.h"
#include "Core/contracts/snap/ISnapService.h"
#include "StaticRxObject.h"
#include "Base/BmObjectId.h"
#include "Ge/GePoint3d.h"
#include "Database/BmDatabase.h"
#include "Gs/Gs.h"
#include "Gs/GsModel.h"
#include <vector>
#include <utility>
#include <map>
#include <memory>

class CVinaBIMView;

/**
 * @brief Representation of an extracted B-Rep edge in world coordinates.
 */
struct BRepEdgeItem
{
    OdGePoint3d   startPt;
    OdGePoint3d   endPt;
    OdGeExtents3d bbox;
    OdUInt64      edgeIndex = 0;

    // Curved edge properties
    bool        isCurve   = false;
    bool        isArc     = false;
    OdGePoint3d center    = OdGePoint3d::kOrigin;
    double      radius    = 0.0;
    std::vector<OdGePoint3d> tessPts;
    std::vector<std::pair<OdGePoint3d, OdGePoint3d>> curveSegs;
};

/**
 * @brief Representation of an extracted B-Rep face with boundary, extents, normal, and centroid.
 */
struct BRepFaceItem
{
    OdGeExtents3d bbox;
    OdUInt64      faceIndex = 0;
    std::vector<std::pair<OdGePoint3d, OdGePoint3d>> edges;
    std::vector<OdGePoint3d> polygon;
    OdGeVector3d  normal = OdGeVector3d::kZAxis;
    OdGePoint3d   centroid = OdGePoint3d::kOrigin;
};

/**
 * @class VBimPickTracker
 * @brief Point tracker implementing interactive hover preview, snapping,
 * and B-Rep subentity hit testing.
 */
class VINABIM_API VBimPickTracker : public OdEdPointTracker
{
public:
    VBimPickTracker();
    ~VBimPickTracker() override;

    /**
     * @brief Factory method creating an OdSmartPtr managed instance.
     */
    static OdSmartPtr<VBimPickTracker> create(
        CVinaBIMView* pView,
        OdBmDatabase* pDb,
        VBimObjectType  mode,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr);

    /**
     * @brief Initializes the tracker with the active view and selection mode.
     */
    void init(
        CVinaBIMView* pView,
        OdBmDatabase* pDb,
        VBimObjectType mode,
        VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All,
        IVBimSelectionFilter* pFilter = nullptr);

    /**
     * @brief OdEdPointTracker protocol: invoked on every mouse move in getPoint loop.
     */
    void setValue(const OdGePoint3d& pt) override;

    /**
     * @brief OdEdPointTracker protocol: registers preview drawables into view.
     * @param pView Target GS view.
     * @return 1 on success, 0 on failure.
     */
    int addDrawables(OdGsView* pView) override;

    /**
     * @brief OdEdPointTracker protocol: removes preview drawables from view.
     * @param pView Target GS view.
     */
    void removeDrawables(OdGsView* pView) override;

    /**
     * @brief Returns current active snap mode.
     */
    VBimObjectSnapTypes snapMode() const noexcept { return m_snapMode; }

    /**
     * @brief Sets active snap mode.
     * @param mode Public snap types bitmask.
     */
    void setSnapMode(VBimObjectSnapTypes mode);

    /**
     * @brief Sets active snap mode using core SnapMode enum.
     * @param mode Core snap mode enum.
     */
    void setSnapMode(SnapMode mode);

    /**
     * @brief Cycles to next snap mode: All -> Endpoint -> Midpoint -> Nearest -> Off -> All.
     */
    VBimObjectSnapTypes cycleSnapMode();

    /**
     * @brief Cycles to next reference candidate under the cursor (Tab key cycling).
     * @param forward True to cycle forward (Tab), false to cycle backwards (Shift+Tab).
     */
    void cycleCandidate(bool forward = true);

    /**
     * @brief Cycles to next candidate under the cursor (backward-compatible alias for Tab cycling).
     */
    void cycleSnapCandidate();

    /**
     * @brief Returns total count of candidate references under the cursor at last evaluation.
     * @return Number of candidates under cursor.
     */
    int candidateCount() const noexcept { return m_candidateCount; }

    /**
     * @brief Returns 0-based active candidate index under the cursor.
     * @return Active candidate index.
     */
    int activeCandidateIndex() const noexcept { return m_activeCandidateIndex; }

    /**
     * @brief Returns human-readable name of active snap mode.
     */
    OdString snapModeName() const;

    /**
     * @brief Returns current selection mode (Element, Face, Edge, PointOnElement, LinkedElement).
     */
    VBimObjectType pickMode() const noexcept { return m_mode; }

    /**
     * @brief Sets selection mode and refreshes hover candidate.
     */
    void setPickMode(VBimObjectType mode);

    /**
     * @brief Cycles to next pick mode: Element -> Face -> Edge -> PointOnElement -> LinkedElement -> Element.
     */
    VBimObjectType cyclePickMode();

    /**
     * @brief Returns human-readable name of active pick mode.
     */
    OdString pickModeName() const;

    /**
     * @brief Returns the final picked result after getPoint completes.
     */
    const VBimReference& result() const noexcept { return m_result; }

    /**
     * @brief Explicit cleanup of all graphics and highlights.
     */
    void cleanup();

    /**
     * @brief Re-evaluates hover and snap at the last evaluated cursor position.
     */
    void refresh();

    /**
     * @brief Clears current visual hover highlight, bounding box, and snap glyph without purging geometry cache.
     */
    void clearHover();

private:
    void clearHoverImpl(bool notifyFilter);

    /**
     * @brief Performs hit testing and snapping at the specified 3D world cursor point.
     */
    void evaluateHit(const OdGePoint3d& cursorPt);

    /**
     * @brief Updates internal candidate selection and visual feedback.
     */
    bool updateCandidate(
        const OdBmObjectId& id,
        const OdBmObjectId& linkedId,
        const OdGeExtents3d& candidateBBox,
        const std::vector<std::pair<OdGePoint3d, OdGePoint3d>>& candidateEdges,
        const std::vector<OdGePoint3d>& candidatePolygon,
        const OdGeVector3d& liftVector,
        double liftDistance,
        OdDb::SubentType subentType,
        OdUInt64 subentIndex,
        const OdGePoint3d& snapPt,
        SnapKind snapKind,
        double worldPerPx = 0.0,
        const OdGeVector3d& geomNormal = OdGeVector3d::kIdentity,
        const OdGePoint3d& geomAnchor = OdGePoint3d::kOrigin,
        bool hasSegment = false,
        const OdGePoint3d& segStart = OdGePoint3d::kOrigin,
        const OdGePoint3d& segEnd = OdGePoint3d::kOrigin,
        bool isDatum = false,
        bool isArc = false,
        const OdGePoint3d& arcCenter = OdGePoint3d::kOrigin,
        double arcRadius = 0.0);

    /**
     * @brief Ensures top model exists on the active GS view for topmost non-occluded rendering.
     */
    void ensureTopModel();

    /**
     * @brief Cached B-Rep geometry for an element with geometry revision validation.
     */
    struct ElementGeometryCache
    {
        OdUInt64              revision = 0;
        OdGeExtents3d         extents;
        OdArray<BRepFaceItem> faces;
        OdArray<BRepEdgeItem> edges;
        OdGePoint3dArray      vertices;
    };

    /**
     * @brief Pre-cached datum element record with spatial bounds for fast AABB rejection.
     */
    struct DatumEntry
    {
        OdBmObjectId  id;
        OdGeExtents3d bbox;
    };

    /**
     * @brief Ensures fine B-Rep geometry for an element is extracted and cached by (OdBmObjectId, revision).
     * Returns a direct pointer to the cache entry (zero-copy).
     */
    const ElementGeometryCache* ensureGeometry(
        const OdBmObjectId& entId,
        const OdBmElementPtr& pElem,
        const OdBmGeometryOptions& geomOpts);

    /**
     * @brief Pre-caches datum elements (Grids, Reference Planes, Levels) for proximity picking.
     */
    void collectDatumElements();

private:
    OdBmObjectId         m_activeDrawingId;
    OdBmObjectId         m_viewportId;
    OdGsViewPtr          m_pGsView;
    OdGsModelPtr         m_pTopModel;
    OdBmDatabasePtr      m_pDb;
    VBimObjectType       m_mode                = VBimObjectType::Element;
    VBimObjectSnapTypes  m_snapMode            = VBimObjectSnapTypes::All;
    IVBimSelectionFilter* m_pFilter            = nullptr;
    int                  m_candidateIndex       = 0;
    int                  m_candidateCount       = 0;
    int                  m_activeCandidateIndex = 0;
    bool                 m_cyclingCandidate     = false;
    OdGePoint3d          m_lastEvaluatedPt      = OdGePoint3d::kOrigin;
    double               m_worldPerPxLast       = 0.0;

    OdStaticRxObject<VBimPickBBoxDrawable> m_bboxDrawable;
    OdStaticRxObject<BmSnapGlyphDrawable>  m_snapGlyph;
    bool                 m_drawablesRegistered = false;

    OdBmObjectId         m_hoveredId;
    VBimReference        m_result;
    bool                 m_is2dView            = false;

    std::vector<DatumEntry> m_datumElements;
    std::map<OdBmObjectId, std::shared_ptr<ElementGeometryCache>> m_geomCache;
};

typedef OdSmartPtr<VBimPickTracker> VBimPickTrackerPtr;
