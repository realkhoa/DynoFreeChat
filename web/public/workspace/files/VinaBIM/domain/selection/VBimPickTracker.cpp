///////////////////////////////////////////////////////////////////////////////
// VinaBIM — domain/selection
///////////////////////////////////////////////////////////////////////////////
#include "pch.h"
#include "VBimPickTracker.h"
#include "domain/public_api/selection/IVBimPickerService.h"
#include "domain/public_api/selection/VBimReferenceExtractor.h"
#include "Host/view/VinaBIMView.h"
#include "Database/BmDatabase.h"
#include "Database/BmElement.h"
#include "Database/BmGeometryOption.h"
#include "BmCommandContext.h"
#include "BmSSet.h"
#include "Essential/Entities/BmCurveElem.h"
#include "Geometry/Entities/BmGCurve.h"
#include "Geometry/Entities/BmEdge.h"
#include "Geometry/Entities/BmFace.h"
#include "Geometry/Entities/BmGBrep.h"
#include "Geometry/Entities/BmGeometry.h"
#include "Geometry/Entities/BmGFace.h"
#include "Geometry/Entities/BmGEdge.h"
#include "Geometry/Entities/BmGEdgeLoop.h"
#include "Geometry/Entities/BmGGroup.h"
#include "Geometry/Entities/BmGInstance.h"
#include "Geometry/Entities/BmInstInfoBase.h"
#include "Ge/GeLineSeg3d.h"
#include "Ge/GeExtents3d.h"
#include "Ge/GePlane.h"
#include "Essential/Entities/BmGrid.h"
#include "Essential/Entities/BmGridChain.h"
#include "Essential/Entities/BmLevel.h"
#include "Geometry/Entities/BmGArc.h"
#include "Geometry/Entities/BmGLine.h"
#include "HostObj/Entities/BmVWall.h"
#include "Infrastructure/Oda/sdk_includes/BmSdkCompat.h"
#include "Infrastructure/Oda/editor/ExBimEditorSelectionHelpers.h"
#include "Infrastructure/Oda/snap/BmSnapCandidateCollector.h"
#include "Gs/GsBaseVectorizeDevice.h"

#include <cmath>
#include <algorithm>
#include <memory>

namespace {

/**
 * @brief Expands an extents box symmetrically by a specified margin in all 3 dimensions.
 * @param ext Extents to expand.
 * @param margin Distance in meters to expand on each side.
 */
static void expandExtents(OdGeExtents3d& ext, double margin)
{
    if (!ext.isValidExtents())
        return;
    OdGePoint3d minPt = ext.minPoint();
    OdGePoint3d maxPt = ext.maxPoint();
    minPt.x -= margin; minPt.y -= margin; minPt.z -= margin;
    maxPt.x += margin; maxPt.y += margin; maxPt.z += margin;
    ext.set(minPt, maxPt);
}

/**
 * @brief Computes Euclidean distance from a 3D point to an axis-aligned bounding box.
 * @param box 3D bounding box.
 * @param pt Query point.
 * @return Distance in meters.
 */
static double distanceToBox(const OdGeExtents3d& box, const OdGePoint3d& pt)
{
    if (!box.isValidExtents())
        return 1e9;
    const OdGePoint3d& minPt = box.minPoint();
    const OdGePoint3d& maxPt = box.maxPoint();
    double dx = 0.0;
    if (pt.x < minPt.x) dx = minPt.x - pt.x;
    else if (pt.x > maxPt.x) dx = pt.x - maxPt.x;
    double dy = 0.0;
    if (pt.y < minPt.y) dy = minPt.y - pt.y;
    else if (pt.y > maxPt.y) dy = pt.y - maxPt.y;
    double dz = 0.0;
    if (pt.z < minPt.z) dz = minPt.z - pt.z;
    else if (pt.z > maxPt.z) dz = pt.z - maxPt.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * @brief Clamps a 3D point to the interior or boundary of a bounding box.
 * @param box Target bounding box.
 * @param pt Input point.
 * @return Clamped 3D point.
 */
static OdGePoint3d clampPointToBox(const OdGeExtents3d& box, const OdGePoint3d& pt)
{
    if (!box.isValidExtents())
        return pt;
    const OdGePoint3d& minPt = box.minPoint();
    const OdGePoint3d& maxPt = box.maxPoint();
    OdGePoint3d res = pt;
    if (res.x < minPt.x) res.x = minPt.x;
    if (res.x > maxPt.x) res.x = maxPt.x;
    if (res.y < minPt.y) res.y = minPt.y;
    if (res.y > maxPt.y) res.y = maxPt.y;
    if (res.z < minPt.z) res.z = minPt.z;
    if (res.z > maxPt.z) res.z = maxPt.z;
    return res;
}

/**
 * @brief Fast O(1) bounding box pre-culling against a camera ray (3D) or query point (2D).
 * @param bbox Bounding box to test.
 * @param cursorPt Query point on view plane.
 * @param rayDir Camera ray unit direction.
 * @param hasRay Whether a valid camera ray is available (3D views).
 * @param tolerance Maximum distance reach tolerance.
 * @return True if box is within tolerance reach, false if safely culled.
 */
static inline bool isBoxNearRayOrPoint(
    const OdGeExtents3d& bbox,
    const OdGePoint3d& cursorPt,
    const OdGeVector3d& rayDir,
    bool hasRay,
    double tolerance)
{
    if (!bbox.isValidExtents())
        return true;

    const OdGePoint3d& minPt = bbox.minPoint();
    const OdGePoint3d& maxPt = bbox.maxPoint();
    const OdGePoint3d center(
        (minPt.x + maxPt.x) * 0.5,
        (minPt.y + maxPt.y) * 0.5,
        (minPt.z + maxPt.z) * 0.5);

    const double radius = (maxPt - center).length();
    const double maxReach = radius + tolerance;

    if (hasRay && !rayDir.isZeroLength())
    {
        const OdGeVector3d v = center - cursorPt;
        const double proj = v.dotProduct(rayDir);
        const double perpDistSq = std::max(0.0, v.lengthSqrd() - (proj * proj));
        if (perpDistSq > maxReach * maxReach)
            return false;
    }
    else
    {
        if (distanceToBox(bbox, cursorPt) > tolerance)
            return false;
    }
    return true;
}

/**
 * @brief Computes Euclidean distance from a 3D point to a 3D line segment.
 */
static double pointToSegmentDistance(const OdGePoint3d& pt, const OdGePoint3d& p0, const OdGePoint3d& p1)
{
    OdGeVector3d dir = p1 - p0;
    const double len2 = dir.lengthSqrd();
    if (len2 < 1e-12)
        return pt.distanceTo(p0);
    double t = (pt - p0).dotProduct(dir) / len2;
    t = std::max(0.0, std::min(1.0, t));
    return pt.distanceTo(p0 + dir * t);
}

/**
 * @brief Computes distance from a point to a line segment, projected along camera ray for 2D views.
 */
static double pointToSegmentDistance2D(
    const OdGePoint3d& pt,
    const OdGePoint3d& p0,
    const OdGePoint3d& p1,
    const OdGeVector3d& rayDir,
    bool hasRay)
{
    if (hasRay && !rayDir.isZeroLength())
    {
        const OdGePoint3d f0 = p0 - rayDir * ((p0 - pt).dotProduct(rayDir));
        const OdGePoint3d f1 = p1 - rayDir * ((p1 - pt).dotProduct(rayDir));
        return pointToSegmentDistance(pt, f0, f1);
    }
    return pointToSegmentDistance(pt, p0, p1);
}



/**
 * @brief Helper to extract and tessellate circular arc geometry from an OdBmGCurve.
 * @param pGCurve Curve to inspect.
 * @param trf Coordinate transformation matrix.
 * @param edgeItem Target BRepEdgeItem to populate.
 * @return True if pGCurve is a valid OdBmGArc, false otherwise.
 */
static bool extractArcGeometry(
    const OdBmGCurvePtr& pGCurve,
    const OdGeMatrix3d& trf,
    BRepEdgeItem& edgeItem)
{
    if (pGCurve.isNull())
        return false;

    OdBmGArcPtr pArc = OdBmGArc::cast(pGCurve);
    if (pArc.isNull())
        return false;

    const OdGePoint3d center = pArc->getCenter();
    const double radius = pArc->getRadius();
    OdGeVector3d xDir = pArc->getXDirection();
    OdGeVector3d yDir = pArc->getYDirection();
    if (radius < 1e-9 || xDir.isZeroLength() || yDir.isZeroLength())
        return false;

    xDir.normalize();
    yDir.normalize();

    double startAng = pArc->getStartAng();
    double endAng   = pArc->getEndAng();
    if (endAng <= startAng)
        endAng += Oda2PI;

    constexpr int kArcSegments = 32;
    const double step = (endAng - startAng) / static_cast<double>(kArcSegments);

    edgeItem.isCurve = true;
    edgeItem.isArc   = true;
    edgeItem.center  = center;
    edgeItem.center.transformBy(trf);
    edgeItem.tessPts.clear();
    edgeItem.tessPts.reserve(kArcSegments + 1);
    edgeItem.curveSegs.clear();
    edgeItem.curveSegs.reserve(kArcSegments);

    for (int i = 0; i <= kArcSegments; ++i)
    {
        const double a = startAng + step * static_cast<double>(i);
        OdGePoint3d pt = center + xDir * (radius * std::cos(a)) + yDir * (radius * std::sin(a));
        pt.transformBy(trf);
        edgeItem.tessPts.push_back(pt);
    }

    for (size_t i = 0; i + 1 < edgeItem.tessPts.size(); ++i)
    {
        edgeItem.curveSegs.push_back({ edgeItem.tessPts[i], edgeItem.tessPts[i + 1] });
    }

    if (!edgeItem.tessPts.empty())
    {
        edgeItem.radius = edgeItem.center.distanceTo(edgeItem.tessPts[0]);
    }
    else
    {
        edgeItem.radius = radius;
    }
    return true;
}

/**
 * @brief Computes or updates the 3D bounding box for a BRepEdgeItem.
 * @param edge BRepEdgeItem to compute bounding box for.
 */
static void computeEdgeBBox(BRepEdgeItem& edge)
{
    edge.bbox.set(edge.startPt, edge.endPt);
    for (const auto& pt : edge.tessPts)
    {
        edge.bbox.addPoint(pt);
    }
}

/**
 * @brief Recursively traverses geometry group nodes and collects faces, edges, and vertices.
 * @param pGroup Geometry group to traverse.
 * @param currentTrf Cumulative transformation matrix to world space.
 * @param opts Geometry options used for detail level.
 * @param outFaces Accumulated face list.
 * @param outEdges Accumulated edge list.
 * @param outVertices Accumulated vertex list.
 * @param visitedEdgeTags Visited edge tags set to prevent duplicate edge collection across adjacent faces.
 * @param depth Recursion depth guard.
 */
static void collectBRepGeometry(
    const OdBmGGroupPtr& pGroup,
    const OdGeMatrix3d& currentTrf,
    const OdBmGeometryOptions& opts,
    OdArray<BRepFaceItem>& outFaces,
    OdArray<BRepEdgeItem>& outEdges,
    OdGePoint3dArray& outVertices,
    std::set<OdInt32>& visitedEdgeTags,
    int depth = 0)
{
    if (pGroup.isNull() || depth > 5)
        return;

    OdBmGNodePtrArray nodes;
    pGroup->getAllSubNodes(nodes);

    for (OdUInt32 i = 0; i < nodes.size(); ++i)
    {
        OdBmGNodePtr pNode = nodes[i];
        if (pNode.isNull())
            continue;

        if (pNode->isKindOf(OdBmGBrep::desc()))
        {
            OdBmGBrepPtr pGBrep = OdBmGBrep::cast(pNode);
            OdBmFacePtrArray faceNodes;
            pGBrep->getFaces(faceNodes);

            for (OdUInt32 f = 0; f < faceNodes.size(); ++f)
            {
                OdBmFacePtr pFace = faceNodes[f];
                if (pFace.isNull())
                    continue;

                OdGeExtents3d faceBox;
                std::vector<std::pair<OdGePoint3d, OdGePoint3d>> faceEdges;
                std::vector<OdGePoint3d> facePolygon;

                // Collect loops from pFace and any sub-regions
                OdBmGFacePtrArray targetFaces;
                targetFaces.append(pFace);
                OdBmGFacePtrArray regions;
                pFace->getFaceRegions(regions);
                for (OdUInt32 r = 0; r < regions.size(); ++r)
                {
                    if (!regions[r].isNull())
                        targetFaces.append(regions[r]);
                }

                for (OdUInt32 tfIdx = 0; tfIdx < targetFaces.size(); ++tfIdx)
                {
                    OdBmGFacePtr pCurrentFace = targetFaces[tfIdx];
                    if (pCurrentFace.isNull())
                        continue;

                    OdBmGEdgeLoopPtr pLoop = pCurrentFace->getFirstLoop();
                    while (!pLoop.isNull())
                    {
                        OdBmGEdgeBase* pNext = pLoop->getNext();
                        int edgeGuard = 0;
                        std::vector<OdGePoint3d> loopPts;

                        while (pNext && !pNext->isLoop() && edgeGuard++ < 500)
                        {
                            OdBmGEdge* pGEdge = dynamic_cast<OdBmGEdge*>(pNext);
                            if (!pGEdge)
                            {
                                OdBmObjectPtr pTmp(pNext);
                                pGEdge = OdBmGEdge::cast(pTmp).get();
                            }
                            if (!pGEdge)
                                break;

                            // Determine orientation relative to face
                            bool bForwardDir = true;
                            int iEdgeForFace = 0;
                            OdBmFace* pF0 = pGEdge->getFacesItem(0);
                            if (pF0 != pFace.get())
                            {
                                if (pGEdge->getFacesItem(1) == pFace.get())
                                {
                                    bForwardDir = false;
                                    iEdgeForFace = 1;
                                }
                            }
                            if (pGEdge->isFlipped())
                                bForwardDir = !bForwardDir;

                            OdGePoint3d ptStart, ptEnd;
                            const bool hasStart = pGEdge->getFirstAndLastEdgeGePnt(ptStart, false);
                            const bool hasEnd   = pGEdge->getFirstAndLastEdgeGePnt(ptEnd, true);

                            if (hasStart)
                            {
                                ptStart.transformBy(currentTrf);
                                faceBox.addPoint(ptStart);
                                outVertices.append(ptStart);
                            }
                            if (hasEnd)
                            {
                                ptEnd.transformBy(currentTrf);
                                faceBox.addPoint(ptEnd);
                                outVertices.append(ptEnd);
                            }

                            if (hasStart && hasEnd)
                            {
                                faceEdges.push_back({ ptStart, ptEnd });

                                OdInt32 edgeTag = -1;
                                OdBmObjectPtr pEdgeObj(pNext);
                                OdBmEdgePtr pBmEdge = OdBmEdge::cast(pEdgeObj);
                                if (!pBmEdge.isNull())
                                    edgeTag = pBmEdge->getTag();

                                bool shouldAppendEdge = true;
                                if (edgeTag >= 0)
                                {
                                    shouldAppendEdge = visitedEdgeTags.insert(edgeTag).second;
                                }

                                if (shouldAppendEdge)
                                {
                                    BRepEdgeItem edgeItem;
                                    edgeItem.startPt   = ptStart;
                                    edgeItem.endPt     = ptEnd;
                                    edgeItem.edgeIndex = (edgeTag >= 0) ? static_cast<OdUInt64>(edgeTag) : outEdges.size();

                                    OdBmGCurvePtr pGCurve;
                                    if (pGEdge->getGCurve(pGCurve) == eOk && !pGCurve.isNull())
                                    {
                                        if (extractArcGeometry(pGCurve, currentTrf, edgeItem))
                                        {
                                            for (const auto& pt : edgeItem.tessPts)
                                            {
                                                faceBox.addPoint(pt);
                                                outVertices.append(pt);
                                            }
                                        }
                                    }

                                    computeEdgeBBox(edgeItem);
                                    outEdges.append(edgeItem);
                                }

                                const OdGePoint3d& v0 = bForwardDir ? ptStart : ptEnd;
                                if (loopPts.empty() || loopPts.back().distanceTo(v0) > 1e-4)
                                {
                                    loopPts.push_back(v0);
                                }
                            }

                            try
                            {
                                pNext = pGEdge->getNextItem(iEdgeForFace);
                            }
                            catch (const OdError&)
                            {
                                break;
                            }
                            catch (const std::exception&)
                            {
                                break;
                            }
                        }

                        if (!loopPts.empty() && facePolygon.empty())
                        {
                            facePolygon = std::move(loopPts);
                        }

                        pLoop = pLoop->getNextLoop();
                    }
                }

                if (faceBox.isValidExtents())
                {
                    OdGePoint3d centroid = faceBox.center();
                    if (!facePolygon.empty())
                    {
                        OdGeVector3d sumVec(0.0, 0.0, 0.0);
                        for (const auto& pt : facePolygon)
                        {
                            sumVec += pt.asVector();
                        }
                        centroid = OdGePoint3d::kOrigin + sumVec * (1.0 / static_cast<double>(facePolygon.size()));
                    }

                    OdGeVector3d normal = OdGeVector3d::kIdentity;
                    try
                    {
                        OdBmSurfacePtr pSurface = pFace->getSurface();
                        if (!pSurface.isNull() && pSurface->getGeSurfaceType() == OdGe::kPlane)
                        {
                            OdGeSurface* pRawGeSurface = nullptr;
                            if (pSurface->getGeSurface(pRawGeSurface) == eOk && pRawGeSurface != nullptr)
                            {
                                std::unique_ptr<OdGeSurface> pGeSurface(pRawGeSurface);
                                const OdGePlane* pGePlane = static_cast<const OdGePlane*>(pGeSurface.get());
                                normal = pGePlane->normal();
                                normal.transformBy(currentTrf);
                            }
                        }
                    }
                    catch (const OdError&)
                    {
                    }
                    catch (const std::exception&)
                    {
                    }

                    if (pFace->isNormalFlipped() && !normal.isZeroLength())
                    {
                        normal = -normal;
                    }

                    // Fallback: Newell's method from polygon vertices
                    if (normal.isZeroLength() && facePolygon.size() >= 3)
                    {
                        const size_t numPts = facePolygon.size();
                        for (size_t i = 0; i < numPts; ++i)
                        {
                            const OdGePoint3d& c = facePolygon[i];
                            const OdGePoint3d& n = facePolygon[(i + 1) % numPts];
                            normal.x += (c.y - n.y) * (c.z + n.z);
                            normal.y += (c.z - n.z) * (c.x + n.x);
                            normal.z += (c.x - n.x) * (c.y + n.y);
                        }
                        if (pFace->isNormalFlipped() && !normal.isZeroLength())
                        {
                            normal = -normal;
                        }
                    }

                    // Fallback: cross product of edges
                    if (normal.isZeroLength() && faceEdges.size() >= 2)
                    {
                        const OdGeVector3d v0 = faceEdges[0].second - faceEdges[0].first;
                        for (size_t k = 1; k < faceEdges.size(); ++k)
                        {
                            const OdGeVector3d vk = faceEdges[k].second - faceEdges[k].first;
                            const OdGeVector3d cr = v0.crossProduct(vk);
                            if (!cr.isZeroLength())
                            {
                                normal = cr;
                                break;
                            }
                        }
                    }

                    // Fallback: thinnest axis of faceBox
                    if (normal.isZeroLength() && faceBox.isValidExtents())
                    {
                        const double dx = std::abs(faceBox.maxPoint().x - faceBox.minPoint().x);
                        const double dy = std::abs(faceBox.maxPoint().y - faceBox.minPoint().y);
                        const double dz = std::abs(faceBox.maxPoint().z - faceBox.minPoint().z);
                        if (dx <= dy && dx <= dz)
                            normal = OdGeVector3d::kXAxis;
                        else if (dy <= dx && dy <= dz)
                            normal = OdGeVector3d::kYAxis;
                        else
                            normal = OdGeVector3d::kZAxis;
                    }

                    if (!normal.isZeroLength())
                        normal.normalize();

                    OdInt32 faceTag = -1;
                    if (!pFace.isNull() && pFace->getTag() >= 0)
                        faceTag = pFace->getTag();

                    BRepFaceItem item;
                    item.bbox      = faceBox;
                    item.faceIndex = (faceTag >= 0) ? static_cast<OdUInt64>(faceTag) : static_cast<OdUInt64>(outFaces.size());
                    item.edges     = std::move(faceEdges);
                    item.polygon   = std::move(facePolygon);
                    item.normal    = normal;
                    item.centroid  = centroid;
                    outFaces.append(item);
                }
            }
        }
        else if (pNode->isKindOf(OdBmGInstance::desc()))
        {
            if (depth < 5)
            {
                OdBmGInstancePtr pInst = OdBmGInstance::cast(pNode);
                OdGeMatrix3d instTrf = currentTrf;
                OdBmInstInfoBasePtr pInfo = pInst->getInstanceInfo();
                if (!pInfo.isNull())
                {
                    instTrf = currentTrf * pInfo->getTrf();
                }

                OdBmObjectPtr pInstGeom;
                if (pInst->getGeometry(opts, pInstGeom) == eOk && !pInstGeom.isNull())
                {
                    OdBmGGroupPtr pSubGroup = OdBmGGroup::cast(pInstGeom);
                    if (!pSubGroup.isNull())
                    {
                        collectBRepGeometry(pSubGroup, instTrf, opts, outFaces, outEdges, outVertices, visitedEdgeTags, depth + 1);
                    }
                }
            }
        }
        else if (pNode->isKindOf(OdBmGGroup::desc()))
        {
            if (depth < 5)
            {
                OdBmGGroupPtr pSubGroup = OdBmGGroup::cast(pNode);
                collectBRepGeometry(pSubGroup, currentTrf, opts, outFaces, outEdges, outVertices, visitedEdgeTags, depth + 1);
            }
        }
    }
}

/**
 * @brief Computes geometry revision hash for an element using getIdCounter and extents.
 */
static OdUInt64 getElementGeomRevision(const OdBmElementPtr& pElem, const OdGeExtents3d& extents)
{
    if (pElem.isNull())
        return 0;

    OdUInt64 rev = 14695981039346656037ULL; // FNV offset basis
    auto fnvCombine = [&rev](OdUInt64 val)
    {
        rev ^= val;
        rev *= 1099511628211ULL; // FNV prime
    };

    try
    {
        OdBmGeomStepListPtr pSteps = pElem->getGeomSteps();
        if (!pSteps.isNull())
        {
            fnvCombine(static_cast<OdUInt64>(static_cast<OdUInt32>(pSteps->getIdCounter())));
        }
    }
    catch (const OdError&)
    {
    }
    catch (const std::exception&)
    {
    }

    if (extents.isValidExtents())
    {
        const OdGePoint3d& mn = extents.minPoint();
        const OdGePoint3d& mx = extents.maxPoint();

        auto hashCoord = [](double v) -> OdUInt64 {
            return static_cast<OdUInt64>(static_cast<OdInt64>(std::round(v * 1000000.0)));
        };

        fnvCombine(hashCoord(mn.x));
        fnvCombine(hashCoord(mn.y));
        fnvCombine(hashCoord(mn.z));
        fnvCombine(hashCoord(mx.x));
        fnvCombine(hashCoord(mx.y));
        fnvCombine(hashCoord(mx.z));
    }

    return rev;
}

} // namespace

VBimPickTracker::VBimPickTracker()
    : m_result()
{
}

VBimPickTracker::~VBimPickTracker()
{
    cleanup();
}

OdSmartPtr<VBimPickTracker> VBimPickTracker::create(
    CVinaBIMView* pView,
    OdBmDatabase* pDb,
    VBimObjectType  mode,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter)
{
    OdSmartPtr<VBimPickTracker> pTracker =
        OdRxObjectImpl<VBimPickTracker, OdEdPointTracker>::createObject();
    pTracker->init(pView, pDb, mode, snapMode, pFilter);
    return pTracker;
}

void VBimPickTracker::init(
    CVinaBIMView* pView,
    OdBmDatabase* pDb,
    VBimObjectType mode,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter)
{
    m_pDb             = pDb;
    m_mode            = mode;
    m_snapMode        = snapMode;
    m_pFilter         = pFilter;
    m_candidateIndex       = 0;
    m_candidateCount       = 0;
    m_activeCandidateIndex = 0;
    m_cyclingCandidate     = false;
    m_pGsView         = pView ? pView->getActiveView() : nullptr;
    m_activeDrawingId = pView ? pView->getActiveDBDrawingId()
                              : (pDb ? pDb->getActiveDBDrawingId() : OdBmObjectId::kNull);
    m_viewportId      = OdBmObjectId::kNull;
    if (!m_pGsView.isNull())
    {
        OdGsClientViewInfo vi;
        m_pGsView->clientViewInfo(vi);
        m_viewportId = OdBmObjectId(vi.viewportObjectId);
    }
    collectDatumElements();

    m_is2dView = false;
    if (pView)
    {
        try
        {
            OdBmDBViewPtr pDbView = pView->getActiveDbView();
            if (pDbView.isNull() && !m_activeDrawingId.isNull())
            {
                OdBmDBDrawingPtr pDrawing = m_activeDrawingId.safeOpenObject();
                if (!pDrawing.isNull())
                    pDbView = pDrawing->getBaseDBViewId().safeOpenObject();
            }
            if (!pDbView.isNull())
            {
                m_is2dView = (pDbView->getViewTypeBase() != OdBm::ViewTypeBase::_3d);
            }
        }
        catch (const OdError&)
        {
        }
        catch (const std::exception&)
        {
        }
    }

    m_result            = VBimReference();
    m_result.objectType = mode;
    m_result.snapMode   = snapMode;
    m_result.isValid    = false;

    ensureTopModel();

    if (!m_pGsView.isNull() && !m_drawablesRegistered)
    {
        m_pGsView->add(&m_bboxDrawable, m_pTopModel.get());
        m_pGsView->add(&m_snapGlyph, m_pTopModel.get());
        m_drawablesRegistered = true;
    }
}

int VBimPickTracker::addDrawables(OdGsView* pView)
{
    if (pView == nullptr)
        return 0;

    if (m_pGsView.isNull())
        m_pGsView = pView;

    ensureTopModel();

    if (!m_drawablesRegistered)
    {
        pView->add(&m_bboxDrawable, m_pTopModel.get());
        pView->add(&m_snapGlyph, m_pTopModel.get());
        m_drawablesRegistered = true;
    }
    return 1;
}

void VBimPickTracker::removeDrawables(OdGsView* pView)
{
    if (!m_hoveredId.isNull())
    {
        try
        {
            OdBmElementPtr pEnt = m_hoveredId.safeOpenObject();
            if (!pEnt.isNull())
                pEnt->highlight(false);
        }
        catch (const OdError&)
        {
        }
        catch (const std::exception&)
        {
        }
        m_hoveredId = OdBmObjectId::kNull;
    }

    if (pView && m_drawablesRegistered)
    {
        const bool bErasedBBox = pView->erase(&m_bboxDrawable);
        const bool bErasedSnap = pView->erase(&m_snapGlyph);
        (void)bErasedBBox;
        (void)bErasedSnap;
        m_drawablesRegistered = false;
        pView->invalidate();
    }
}

void VBimPickTracker::ensureTopModel()
{
    if (!m_pTopModel.isNull() || m_pGsView.isNull())
        return;

    OdGsDevice* pDev = m_pGsView->device();
    if (!pDev)
        return;

    OdGsBaseVectorizeDevice* pBvd = dynamic_cast<OdGsBaseVectorizeDevice*>(pDev);
    if (!pBvd)
        return;

    m_pTopModel = pBvd->createModel();
    if (!m_pTopModel.isNull())
    {
        m_pTopModel->setRenderType(OdGsModel::kDirectTopmost);
        m_pTopModel->setViewClippingOverride(true);
        m_pTopModel->setSelectable(false);
        m_pTopModel->setEnableViewExtentsCalculation(false);
    }
}

const VBimPickTracker::ElementGeometryCache* VBimPickTracker::ensureGeometry(
    const OdBmObjectId& entId,
    const OdBmElementPtr& pElem,
    const OdBmGeometryOptions& geomOpts)
{
    if (pElem.isNull() || entId.isNull())
        return nullptr;

    OdGeExtents3d elemExtents;
    pElem->getGeomExtents(elemExtents);
    const OdUInt64 currentRevision = getElementGeomRevision(pElem, elemExtents);

    auto it = m_geomCache.find(entId);
    if (it != m_geomCache.end())
    {
        if (it->second && it->second->revision == currentRevision)
        {
            return it->second.get();
        }
        else
        {
            m_geomCache.erase(it);
        }
    }

    auto newEntry = std::make_shared<ElementGeometryCache>();
    newEntry->revision = currentRevision;
    newEntry->extents  = elemExtents;

    OdBmObjectPtr pGeomObj;
    if (pElem->getGeometry(geomOpts, pGeomObj) != eOk || pGeomObj.isNull())
        pGeomObj = pElem->getGeometry();

    if (!pGeomObj.isNull())
    {
        OdBmGGroupPtr pGroup = OdBmGGroup::cast(pGeomObj);
        if (!pGroup.isNull())
        {
            std::set<OdInt32> visitedEdgeTags;
            collectBRepGeometry(pGroup, OdGeMatrix3d::kIdentity, geomOpts,
                                newEntry->faces, newEntry->edges, newEntry->vertices, visitedEdgeTags);
        }
    }

    OdBmCurveElemPtr pCurve = OdBmCurveElem::cast(pElem);
    if (!pCurve.isNull())
    {
        OdBmGCurvePtr pGCurve;
        if (pCurve->getGeomCurve(pGCurve) == eOk && !pGCurve.isNull())
        {
            OdGePoint3d p0, p1;
            pGCurve->getEndPoint(p0, 0);
            pGCurve->getEndPoint(p1, 1);
            BRepEdgeItem crvEdge;
            crvEdge.startPt   = p0;
            crvEdge.endPt     = p1;
            crvEdge.edgeIndex = newEntry->edges.size();

            if (extractArcGeometry(pGCurve, OdGeMatrix3d::kIdentity, crvEdge))
            {
                for (const auto& pt : crvEdge.tessPts)
                {
                    newEntry->vertices.append(pt);
                    newEntry->extents.addPoint(pt);
                }
            }

            newEntry->edges.append(crvEdge);
            newEntry->vertices.append(p0);
            newEntry->vertices.append(p1);
        }
    }

    OdBmGridChainPtr pChain = OdBmGridChain::cast(pElem);
    if (!pChain.isNull())
    {
        OdBmMap<OdInt32, OdBmObjectId> tagToGrid;
        pChain->getCurveTagToGridsInChain(tagToGrid);
        for (auto it = tagToGrid.begin(); it != tagToGrid.end(); ++it)
        {
            OdBmObjectPtr pChildObj = it->second.safeOpenObject();
            OdBmGridPtr pChildGrid = OdBmGrid::cast(pChildObj);
            if (!pChildGrid.isNull())
            {
                OdBmGCurvePtr pGCurve = pChildGrid->getCurve();
                if (!pGCurve.isNull())
                {
                    OdGePoint3d p0, p1;
                    if (pGCurve->getEndPoint(p0, 0) == eOk && pGCurve->getEndPoint(p1, 1) == eOk)
                    {
                        BRepEdgeItem gridEdge;
                        gridEdge.startPt   = p0;
                        gridEdge.endPt     = p1;
                        gridEdge.edgeIndex = newEntry->edges.size();

                        if (extractArcGeometry(pGCurve, OdGeMatrix3d::kIdentity, gridEdge))
                        {
                            for (const auto& pt : gridEdge.tessPts)
                            {
                                newEntry->vertices.append(pt);
                                newEntry->extents.addPoint(pt);
                            }
                        }

                        newEntry->edges.append(gridEdge);
                        newEntry->vertices.append(p0);
                        newEntry->vertices.append(p1);
                        newEntry->extents.addPoint(p0);
                        newEntry->extents.addPoint(p1);
                    }
                }
            }
        }
    }

    OdBmDatumPlanePtr pDatum = OdBmDatumPlane::cast(pElem);
    if (!pDatum.isNull())
    {
        OdBmGridPtr pGrid = OdBmGrid::cast(pDatum);
        if (!pGrid.isNull())
        {
            OdBmGCurvePtr pGCurve = pGrid->getCurve();
            if (!pGCurve.isNull())
            {
                if (pGrid->isCurved())
                {
                    OdGePoint3d p0, p1;
                    pGCurve->getEndPoint(p0, 0);
                    pGCurve->getEndPoint(p1, 1);
                    BRepEdgeItem arcEdge;
                    arcEdge.startPt   = p0;
                    arcEdge.endPt     = p1;
                    arcEdge.edgeIndex = newEntry->edges.size();

                    if (extractArcGeometry(pGCurve, OdGeMatrix3d::kIdentity, arcEdge))
                    {
                        for (const auto& pt : arcEdge.tessPts)
                        {
                            newEntry->vertices.append(pt);
                            newEntry->extents.addPoint(pt);
                        }
                    }
                    else
                    {
                        const int numSamples = 16;
                        OdGePoint3d prevPt;
                        if (pGCurve->evaluate(prevPt, 0.0, true) == eOk)
                        {
                            newEntry->vertices.append(prevPt);
                            newEntry->extents.addPoint(prevPt);
                            for (int s = 1; s <= numSamples; ++s)
                            {
                                const double t = static_cast<double>(s) / static_cast<double>(numSamples);
                                OdGePoint3d curPt;
                                if (pGCurve->evaluate(curPt, t, true) == eOk)
                                {
                                    arcEdge.tessPts.push_back(curPt);
                                    arcEdge.curveSegs.push_back({ prevPt, curPt });
                                    newEntry->vertices.append(curPt);
                                    newEntry->extents.addPoint(curPt);
                                    prevPt = curPt;
                                }
                            }
                            arcEdge.isCurve = true;
                        }
                    }
                    newEntry->edges.append(arcEdge);
                }
                else
                {
                    OdGePoint3d p0, p1;
                    if (pGCurve->getEndPoint(p0, 0) == eOk && pGCurve->getEndPoint(p1, 1) == eOk)
                    {
                        BRepEdgeItem gridEdge;
                        gridEdge.startPt   = p0;
                        gridEdge.endPt     = p1;
                        gridEdge.edgeIndex = newEntry->edges.size();
                        newEntry->edges.append(gridEdge);
                        newEntry->vertices.append(p0);
                        newEntry->vertices.append(p1);
                        newEntry->extents.addPoint(p0);
                        newEntry->extents.addPoint(p1);
                    }
                    else
                    {
                        OdBmGLinePtr pLine = OdBmGLine::cast(pGCurve);
                        if (!pLine.isNull())
                        {
                            OdGePoint3d origin = pLine->getOriginPoint();
                            OdGeVector3d dir = pLine->getDirectionVector();
                            if (!dir.isZeroLength())
                            {
                                dir.normalize();
                                p0 = origin - dir * 50.0;
                                p1 = origin + dir * 50.0;
                                BRepEdgeItem gridEdge;
                                gridEdge.startPt   = p0;
                                gridEdge.endPt     = p1;
                                gridEdge.edgeIndex = newEntry->edges.size();
                                newEntry->edges.append(gridEdge);
                                newEntry->vertices.append(p0);
                                newEntry->vertices.append(p1);
                                newEntry->extents.addPoint(p0);
                                newEntry->extents.addPoint(p1);
                            }
                        }
                    }
                }
            }
        }

        // Fallback or for RefPlane / Level / general DatumPlane
        if (newEntry->edges.isEmpty())
        {
            const OdGePoint3d ptBubble = pDatum->getBubbleEnd();
            const OdGePoint3d ptFree   = pDatum->getFreeEnd();
            if (ptBubble.distanceTo(ptFree) > 1e-4)
            {
                BRepEdgeItem datumEdge;
                datumEdge.startPt   = ptBubble;
                datumEdge.endPt     = ptFree;
                datumEdge.edgeIndex = newEntry->edges.size();
                newEntry->edges.append(datumEdge);
                newEntry->vertices.append(ptBubble);
                newEntry->vertices.append(ptFree);
                newEntry->extents.addPoint(ptBubble);
                newEntry->extents.addPoint(ptFree);

                // In 3D views, add face quad for Face mode selection
                if (!m_is2dView)
                {
                    OdGeVector3d cutVec = pDatum->getCutVector();
                    if (cutVec.isZeroLength())
                        cutVec = OdGeVector3d::kZAxis;
                    else
                        cutVec.normalize();

                    const double halfSpan = 10.0;
                    const OdGePoint3d q0 = ptBubble - cutVec * halfSpan;
                    const OdGePoint3d q1 = ptFree   - cutVec * halfSpan;
                    const OdGePoint3d q2 = ptFree   + cutVec * halfSpan;
                    const OdGePoint3d q3 = ptBubble + cutVec * halfSpan;

                    BRepFaceItem face;
                    face.faceIndex = newEntry->faces.size();
                    face.polygon = { q0, q1, q2, q3 };
                    face.edges   = { {q0, q1}, {q1, q2}, {q2, q3}, {q3, q0} };
                    face.bbox.set(q0, q1);
                    face.bbox.addPoint(q2);
                    face.bbox.addPoint(q3);
                    face.centroid = (q0.asVector() + q1.asVector() + q2.asVector() + q3.asVector()).asPoint() * 0.25;

                    OdGeVector3d e01 = q1 - q0;
                    OdGeVector3d e03 = q3 - q0;
                    face.normal = e01.crossProduct(e03);
                    if (!face.normal.isZeroLength())
                        face.normal.normalize();
                    else
                        face.normal = OdGeVector3d::kZAxis;

                    newEntry->faces.append(face);
                    newEntry->extents.addPoint(q0);
                    newEntry->extents.addPoint(q1);
                    newEntry->extents.addPoint(q2);
                    newEntry->extents.addPoint(q3);
                }
            }
        }
    }

    OdBmVWallPtr pWall = OdBmVWall::cast(pElem);
    if (!pWall.isNull())
    {
        OdBmGCurvePtr pGCurve;
        if (pWall->getLocationCurve(pGCurve) == eOk && !pGCurve.isNull())
        {
            OdGePoint3d p0, p1;
            if (pGCurve->getEndPoint(p0, 0) == eOk && pGCurve->getEndPoint(p1, 1) == eOk)
            {
                BRepEdgeItem wallCenterEdge;
                wallCenterEdge.startPt   = p0;
                wallCenterEdge.endPt     = p1;
                wallCenterEdge.edgeIndex = newEntry->edges.size();

                if (extractArcGeometry(pGCurve, OdGeMatrix3d::kIdentity, wallCenterEdge))
                {
                    for (const auto& pt : wallCenterEdge.tessPts)
                    {
                        newEntry->vertices.append(pt);
                        newEntry->extents.addPoint(pt);
                    }
                }

                newEntry->edges.append(wallCenterEdge);
                newEntry->vertices.append(p0);
                newEntry->vertices.append(p1);
                newEntry->extents.addPoint(p0);
                newEntry->extents.addPoint(p1);
            }
        }
    }

    if (!elemExtents.isValidExtents() && newEntry->extents.isValidExtents())
    {
        elemExtents = newEntry->extents;
    }

    if (elemExtents.isValidExtents())
    {
        const OdGePoint3d elemCenter = elemExtents.center();
        for (OdUInt32 i = 0; i < newEntry->faces.size(); ++i)
        {
            const OdGeVector3d outVec = newEntry->faces[i].centroid - elemCenter;
            if (outVec.length() > 1e-3 && newEntry->faces[i].normal.dotProduct(outVec) < -1e-4)
            {
                newEntry->faces[i].normal = -newEntry->faces[i].normal;
            }
        }
    }

    for (OdUInt32 e = 0; e < newEntry->edges.size(); ++e)
    {
        computeEdgeBBox(newEntry->edges[e]);
    }

    auto* pResult = newEntry.get();
    m_geomCache[entId] = std::move(newEntry);
    return pResult;
}

void VBimPickTracker::collectDatumElements()
{
    m_datumElements.clear();
    if (m_pDb.isNull())
        return;

    auto addDatum = [this](const OdBmElementPtr& pElem)
    {
        if (pElem.isNull()) return;
        DatumEntry entry;
        entry.id = pElem->objectId();
        pElem->getGeomExtents(entry.bbox);
        m_datumElements.push_back(std::move(entry));
    };

    try
    {
        // 1. Collect Grids
        OdBmElementPtrArray grids = OdBmFilteredElementCollector(m_pDb)
            .ofClass(OdBmGrid::desc()).collect();
        for (OdUInt32 i = 0; i < grids.size(); ++i) addDatum(grids[i]);

        // 1b. Collect Grid Chains
        OdBmElementPtrArray gridChains = OdBmFilteredElementCollector(m_pDb)
            .ofClass(OdBmGridChain::desc()).collect();
        for (OdUInt32 i = 0; i < gridChains.size(); ++i) addDatum(gridChains[i]);

        // 2. Collect Reference Planes
        OdBmElementPtrArray refPlanes = OdBmFilteredElementCollector(m_pDb)
            .ofClass(OdBmRefPlane::desc()).collect();
        for (OdUInt32 i = 0; i < refPlanes.size(); ++i) addDatum(refPlanes[i]);

        // 3. Collect Levels
        OdBmElementPtrArray levels = OdBmFilteredElementCollector(m_pDb)
            .ofClass(OdBmLevel::desc()).collect();
        for (OdUInt32 i = 0; i < levels.size(); ++i) addDatum(levels[i]);
    }
    catch (const OdError&)
    {
    }
    catch (const std::exception&)
    {
    }
}

void VBimPickTracker::cleanup()
{
    clearHoverImpl(false);
    m_geomCache.clear();
    m_datumElements.clear();

    if (!m_pGsView.isNull() && m_drawablesRegistered)
    {
        m_pGsView->erase(&m_bboxDrawable);
        m_pGsView->erase(&m_snapGlyph);
        m_drawablesRegistered = false;
        m_pGsView->invalidate();
    }
    m_pTopModel.release();
}

void VBimPickTracker::clearHover()
{
    clearHoverImpl(true);
}

void VBimPickTracker::clearHoverImpl(bool notifyFilter)
{
    if (notifyFilter)
        if (auto* resolver = dynamic_cast<IVBimSelectionReferenceResolver*>(m_pFilter))
            resolver->OnReferenceHoverCleared();
    if (!m_hoveredId.isNull())
    {
        try
        {
            OdBmElementPtr pEnt = m_hoveredId.safeOpenObject();
            if (!pEnt.isNull())
            {
                pEnt->highlight(false);
            }
        }
        catch (const OdError&)
        {
        }
        catch (const std::exception&)
        {
        }
        m_hoveredId = OdBmObjectId::kNull;
    }

    m_bboxDrawable.clearBBox();
    m_snapGlyph.clearSnap();
    m_result.isValid = false;
    m_candidateCount = 0;
    m_activeCandidateIndex = 0;
    m_candidateIndex = 0;

    if (!m_pTopModel.isNull())
    {
        m_pTopModel->onModified(&m_bboxDrawable, static_cast<OdGiDrawable*>(nullptr));
        m_pTopModel->onModified(&m_snapGlyph, static_cast<OdGiDrawable*>(nullptr));
    }

    if (!m_pGsView.isNull())
        m_pGsView->invalidate();
}

void VBimPickTracker::setValue(const OdGePoint3d& pt)
{
    const bool bWasCycling = m_cyclingCandidate;
    m_cyclingCandidate = false;

    if (bWasCycling && pt.distanceTo(m_lastEvaluatedPt) <= 1e-4)
    {
        return;
    }

    // Resolution-dependent jitter threshold: if mouse moved less than 1.5 pixels, skip re-evaluating
    if (!bWasCycling && m_worldPerPxLast > 1e-12)
    {
        const double minMoveDist = m_worldPerPxLast * 1.5;
        if (pt.distanceTo(m_lastEvaluatedPt) < minMoveDist)
        {
            return;
        }
    }

    // Preserve candidateIndex during micro-movements and click jitter on the same element.
    // Only reset candidateIndex if the cursor moved significantly (> 0.5m in world space).
    if (!bWasCycling && pt.distanceTo(m_lastEvaluatedPt) > 0.5)
    {
        m_candidateIndex = 0;
    }

    m_lastEvaluatedPt = pt;
    if (m_pGsView.isNull() || m_pDb.isNull())
        return;

    evaluateHit(pt);
}

void VBimPickTracker::setSnapMode(VBimObjectSnapTypes mode)
{
    m_snapMode = mode;
    m_candidateIndex = 0;
    refresh();
}

void VBimPickTracker::setSnapMode(SnapMode mode)
{
    setSnapMode(toVBimObjectSnapTypes(mode));
}

VBimObjectSnapTypes VBimPickTracker::cycleSnapMode()
{
    if (m_snapMode == VBimObjectSnapTypes::All)
        m_snapMode = VBimObjectSnapTypes::Endpoints;
    else if (m_snapMode == VBimObjectSnapTypes::Endpoints)
        m_snapMode = VBimObjectSnapTypes::Midpoints;
    else if (m_snapMode == VBimObjectSnapTypes::Midpoints)
        m_snapMode = VBimObjectSnapTypes::Nearest;
    else if (m_snapMode == VBimObjectSnapTypes::Nearest)
        m_snapMode = VBimObjectSnapTypes::Off;
    else
        m_snapMode = VBimObjectSnapTypes::All;

    m_candidateIndex = 0;
    refresh();
    return m_snapMode;
}

void VBimPickTracker::cycleCandidate(bool forward)
{
    if (forward)
        m_candidateIndex++;
    else
        m_candidateIndex--;

    m_cyclingCandidate = true;
    refresh();
}

void VBimPickTracker::cycleSnapCandidate()
{
    cycleCandidate(true);
}

OdString VBimPickTracker::snapModeName() const
{
    if (m_snapMode == VBimObjectSnapTypes::Off)
        return OD_T("Off");
    if (m_snapMode == VBimObjectSnapTypes::Endpoints)
        return OD_T("Endpoints");
    if (m_snapMode == VBimObjectSnapTypes::Midpoints)
        return OD_T("Midpoints");
    if (m_snapMode == VBimObjectSnapTypes::Nearest)
        return OD_T("Nearest");
    return OD_T("All");
}

void VBimPickTracker::setPickMode(VBimObjectType mode)
{
    clearHover();
    m_mode = mode;
    m_result.objectType = mode;
    refresh();
}

VBimObjectType VBimPickTracker::cyclePickMode()
{
    clearHover();
    if (m_mode == VBimObjectType::Element)
        m_mode = VBimObjectType::Face;
    else if (m_mode == VBimObjectType::Face)
        m_mode = VBimObjectType::Edge;
    else if (m_mode == VBimObjectType::Edge)
        m_mode = VBimObjectType::PointOnElement;
    else if (m_mode == VBimObjectType::PointOnElement)
        m_mode = VBimObjectType::LinkedElement;
    else
        m_mode = VBimObjectType::Element;

    m_result.objectType = m_mode;
    refresh();
    return m_mode;
}

OdString VBimPickTracker::pickModeName() const
{
    if (m_mode == VBimObjectType::Face)
        return OD_T("Face");
    if (m_mode == VBimObjectType::Edge)
        return OD_T("Edge");
    if (m_mode == VBimObjectType::PointOnElement)
        return OD_T("PointOnElement");
    if (m_mode == VBimObjectType::LinkedElement)
        return OD_T("LinkedElement");
    return OD_T("Element");
}

void VBimPickTracker::refresh()
{
    if (!m_pGsView.isNull() && !m_pDb.isNull())
    {
        evaluateHit(m_lastEvaluatedPt);
    }
}

void VBimPickTracker::evaluateHit(const OdGePoint3d& cursorPt)
{
    const OdBmObjectId drawingId = m_activeDrawingId;
    if (drawingId.isNull())
    {
        clearHover();
        return;
    }

    // Compute world units per device pixel for resolution-independent magnetic picking
    double worldPerPx = 0.0;
    if (!m_pGsView.isNull())
    {
        OdGePoint2d ll, ur;
        m_pGsView->getViewport(ll, ur);
        OdGsDCRect scrRect;
        m_pGsView->getViewport(scrRect);
        const double pixW = std::abs(static_cast<double>(scrRect.m_max.x - scrRect.m_min.x));
        if (!OdZero(pixW) && !OdZero(m_pGsView->fieldWidth()))
        {
            const double ptDimX = (pixW / m_pGsView->fieldWidth()) * (ur.x - ll.x);
            if (!OdZero(ptDimX))
            {
                OdGeVector3d v(1.0 / ptDimX, 0.0, 0.0);
                v.transformBy(m_pGsView->viewingMatrix());
                worldPerPx = v.length();
            }
        }
    }

    // Magnetic pick aperture: 24px for comfortable, responsive reach
    const double kMagnetBoxPixels = 24.0;
    const double tol = (worldPerPx > 1e-12) ? (worldPerPx * kMagnetBoxPixels) : 0.5;

    // 1. Collect candidate element IDs under cursor:
    // Try exact point hit first (front-to-back ray order)
    std::vector<OdBmObjectId> candidateElemIds;
    try
    {
        OdSelectionSetPtr pHit = OdBm::Utils::select(
            drawingId, 1, &cursorPt, OdDbVisualSelection::kPoint, OdDbVisualSelection::kDisableSubents);
        if (!pHit.isNull())
        {
            for (OdSelectionSetIteratorPtr pIter = pHit->newIterator(); !pIter->done(); pIter->next())
            {
                const OdBmObjectId entId = pIter->id();
                if (!entId.isNull() && std::find(candidateElemIds.begin(), candidateElemIds.end(), entId) == candidateElemIds.end())
                {
                    if (!m_pFilter || m_pFilter->AllowElement(entId))
                    {
                        candidateElemIds.push_back(entId);
                    }
                }
            }
        }
    }
    catch (const OdError&)
    {
    }
    catch (const std::exception&)
    {
    }

    // Aperture crossing box: collect adjoining or overlapping elements within reach
    if (candidateElemIds.size() < 8)
    {
        OdGePoint3d boxPts[2];
        boxPts[0] = cursorPt - OdGeVector3d(tol, tol, tol);
        boxPts[1] = cursorPt + OdGeVector3d(tol, tol, tol);
        try
        {
            OdSelectionSetPtr pBoxHit = OdBm::Utils::select(
                drawingId, 2, boxPts, OdDbVisualSelection::kCrossing, OdDbVisualSelection::kDisableSubents);
            if (!pBoxHit.isNull())
            {
                for (OdSelectionSetIteratorPtr pIter = pBoxHit->newIterator(); !pIter->done(); pIter->next())
                {
                    const OdBmObjectId entId = pIter->id();
                    if (!entId.isNull() && std::find(candidateElemIds.begin(), candidateElemIds.end(), entId) == candidateElemIds.end())
                    {
                        if (!m_pFilter || m_pFilter->AllowElement(entId))
                        {
                            candidateElemIds.push_back(entId);
                            if (candidateElemIds.size() >= 8)
                                break;
                        }
                    }
                }
            }
        }
        catch (const OdError&)
        {
        }
        catch (const std::exception&)
        {
        }
    }

    // Viewport crossing query for view-specific elements (like datums, annotations)
    if (candidateElemIds.size() < 8 && !m_viewportId.isNull() && m_viewportId != drawingId)
    {
        const OdBmObjectId vpId = m_viewportId;
        {
            OdGePoint3d boxPts[2];
            boxPts[0] = cursorPt - OdGeVector3d(tol, tol, tol);
            boxPts[1] = cursorPt + OdGeVector3d(tol, tol, tol);
            try
            {
                OdSelectionSetPtr pVpHit = OdBm::Utils::select(
                    vpId, 2, boxPts, OdDbVisualSelection::kCrossing, OdDbVisualSelection::kDisableSubents);
                if (!pVpHit.isNull())
                {
                    for (OdSelectionSetIteratorPtr pIter = pVpHit->newIterator(); !pIter->done(); pIter->next())
                    {
                        const OdBmObjectId entId = pIter->id();
                        if (!entId.isNull() && std::find(candidateElemIds.begin(), candidateElemIds.end(), entId) == candidateElemIds.end())
                        {
                            if (!m_pFilter || m_pFilter->AllowElement(entId))
                            {
                                candidateElemIds.push_back(entId);
                                if (candidateElemIds.size() >= 8)
                                    break;
                            }
                        }
                    }
                }
            }
            catch (const OdError&)
            {
            }
            catch (const std::exception&)
            {
            }
        }
    }

    // Calculate eye ray from active view camera for ray-surface intersection and back-face culling
    OdGePoint3d rayOrigin = cursorPt;
    OdGeVector3d rayDir = OdGeVector3d::kZAxis;
    bool hasRay = false;
    if (!m_pGsView.isNull())
    {
        if (m_pGsView->isPerspective())
        {
            rayOrigin = m_pGsView->position();
            rayDir = cursorPt - rayOrigin;
            if (!rayDir.isZeroLength())
            {
                rayDir.normalize();
                hasRay = true;
            }
        }
        else
        {
            rayDir = m_pGsView->target() - m_pGsView->position();
            if (!rayDir.isZeroLength())
            {
                rayDir.normalize();
                rayOrigin = cursorPt - rayDir * 10000.0;
                hasRay = true;
            }
        }
    }

    // Proximity scan for datum elements (Grids, Reference Planes, Levels)
    if (!m_datumElements.empty())
    {
        const double datumTol = tol * 2.0;
        OdBmGeometryOptions datumGeomOpts;
        datumGeomOpts.setDetailLevel(OdBm::ViewDetailLevel::Fine);

        for (size_t dIdx = 0; dIdx < m_datumElements.size(); ++dIdx)
        {
            const auto& datum = m_datumElements[dIdx];
            const OdBmObjectId datumId = datum.id;
            if (datumId.isNull() || std::find(candidateElemIds.begin(), candidateElemIds.end(), datumId) != candidateElemIds.end())
                continue;

            // Spatial pre-filter: skip datum element if cursor is far from pre-cached bounding box
            if (!isBoxNearRayOrPoint(datum.bbox, cursorPt, rayDir, hasRay, datumTol))
                continue;

            if (m_pFilter && !m_pFilter->AllowElement(datumId))
                continue;

            OdBmElementPtr pDatumElem = datumId.safeOpenObject();
            if (pDatumElem.isNull())
                continue;

            const ElementGeometryCache* pDatumGeom = ensureGeometry(datumId, pDatumElem, datumGeomOpts);
            if (pDatumGeom)
            {
                bool isNear = false;
                const auto& datumEdges = pDatumGeom->edges;
                for (OdUInt32 e = 0; e < datumEdges.size(); ++e)
                {
                    if (!isBoxNearRayOrPoint(datumEdges[e].bbox, cursorPt, rayDir, hasRay, datumTol))
                        continue;

                    const double dist = pointToSegmentDistance2D(cursorPt, datumEdges[e].startPt, datumEdges[e].endPt, rayDir, hasRay);
                    if (dist <= datumTol)
                    {
                        isNear = true;
                        break;
                    }
                }
                if (!isNear && !pDatumGeom->faces.isEmpty())
                {
                    const auto& datumFaces = pDatumGeom->faces;
                    for (OdUInt32 f = 0; f < datumFaces.size(); ++f)
                    {
                        if (!isBoxNearRayOrPoint(datumFaces[f].bbox, cursorPt, rayDir, hasRay, datumTol))
                            continue;

                        const double dist = distanceToBox(datumFaces[f].bbox, cursorPt);
                        if (dist <= datumTol)
                        {
                            isNear = true;
                            break;
                        }
                    }
                }
                if (isNear)
                {
                    candidateElemIds.push_back(datumId);
                    if (candidateElemIds.size() >= 16)
                        break;
                }
            }
        }
    }

    if (candidateElemIds.empty())
    {
        clearHover();
        return;
    }

    // In 2D views (FloorPlan, CeilingPlan, Section, Elevation), selecting a 3D face is
    // geometrically degenerate (seen edge-on), so face picking automatically transitions to edge picking.
    const bool is2dView = m_is2dView;

    const VBimPickMode effectiveMode = (is2dView && m_mode == VBimPickMode::Face)
        ? VBimPickMode::Edge
        : m_mode;

    // Convert VBimObjectSnapTypes to Core SnapMode for ODA snap candidate collector
    SnapMode coreSnapMode = SnapMode::Off;
    if ((m_snapMode & VBimObjectSnapTypes::Endpoints) != VBimObjectSnapTypes::None)
        coreSnapMode = coreSnapMode | SnapMode::Endpoint;
    if ((m_snapMode & VBimObjectSnapTypes::Midpoints) != VBimObjectSnapTypes::None)
        coreSnapMode = coreSnapMode | SnapMode::Midpoint;
    if ((m_snapMode & VBimObjectSnapTypes::Nearest) != VBimObjectSnapTypes::None)
        coreSnapMode = coreSnapMode | SnapMode::Nearest;

    // Internal candidate reference structure for Tab-cycling under cursor
    struct PickCandidateRef
    {
        OdBmObjectId targetElemId;
        OdBmObjectId linkedElemId;
        OdGeExtents3d candidateBBox;
        // Pointer references to avoid deep copying vectors of thousands of edges/polygon vertices
        const std::vector<std::pair<OdGePoint3d, OdGePoint3d>>* pCandidateEdges = nullptr;
        const std::vector<OdGePoint3d>* pCandidatePolygon = nullptr;
        // Small local storage if candidate edge is created on the fly (e.g. single straight segment or 2D box)
        std::vector<std::pair<OdGePoint3d, OdGePoint3d>> localEdges;
        OdDb::SubentType subentType = OdDb::kNullSubentType;
        OdUInt64 subentIndex = 0;
        OdGePoint3d snapPt = OdGePoint3d::kOrigin;
        SnapKind snapKind = SnapKind::None;
        double score = 0.0;

        // True geometric properties of the candidate
        OdGeVector3d geomNormal = OdGeVector3d::kIdentity;
        OdGePoint3d  geomAnchor = OdGePoint3d::kOrigin;
        bool         hasSegment = false;
        OdGePoint3d  segStart   = OdGePoint3d::kOrigin;
        OdGePoint3d  segEnd     = OdGePoint3d::kOrigin;
        bool         isDatum    = false;
        bool         isArc      = false;
        OdGePoint3d  arcCenter  = OdGePoint3d::kOrigin;
        double       arcRadius  = 0.0;
    };
    std::vector<PickCandidateRef> candidateRefs;

    OdBmGeometryOptions geomOpts;
    geomOpts.setDetailLevel(OdBm::ViewDetailLevel::Fine);

    if (effectiveMode == VBimPickMode::Face)
    {
        const size_t maxElemsToCheck = std::min<size_t>(candidateElemIds.size(), 16);
        for (size_t eIdx = 0; eIdx < maxElemsToCheck; ++eIdx)
        {
            const OdBmObjectId entId = candidateElemIds[eIdx];
            OdBmElementPtr pElem = entId.safeOpenObject();
            if (pElem.isNull()) continue;

            const ElementGeometryCache* pGeom = ensureGeometry(entId, pElem, geomOpts);
            if (!pGeom)
                continue;

            const auto& faces = pGeom->faces;
            const auto& edges = pGeom->edges;

            for (OdUInt32 i = 0; i < faces.size(); ++i)
            {
                const auto& face = faces[i];

                // Fast AABB pre-culling (O(1))
                if (!isBoxNearRayOrPoint(face.bbox, cursorPt, rayDir, hasRay, tol * 3.0))
                    continue;

                OdGePoint3d hitPt = cursorPt;
                double t = 0.0;
                bool isFrontFacing = false;
                double distToBoxVal = 0.0;

                if (hasRay)
                {
                    const double denom = face.normal.dotProduct(rayDir);
                    isFrontFacing = (denom < -0.01);
                    if (std::abs(denom) > 1e-6)
                    {
                        t = (face.centroid - rayOrigin).dotProduct(face.normal) / denom;
                        if (t >= 0.0)
                        {
                            hitPt = rayOrigin + rayDir * t;
                        }
                    }

                    distToBoxVal = distanceToBox(face.bbox, hitPt);

                    // Scoring:
                    // 1. Distance from ray hit point to face bounding box
                    // 2. Back-face penalty: +10,000 for back/interior faces so front faces are prioritized
                    // 3. Depth tie-breaker: prefer closer front faces along ray (+ t * 1e-4)
                    // 4. Element priority: secondary elements get slight penalty (+ eIdx * 10.0)
                    double score = distToBoxVal + (static_cast<double>(eIdx) * 10.0);
                    if (!isFrontFacing)
                        score += 10000.0;
                    if (t > 0.0)
                        score += t * 1e-4;

                    if (distToBoxVal > tol * 3.0)
                        continue;

                    OdGePoint3d snapPt = clampPointToBox(face.bbox, hitPt);
                    SnapKind snapKind = SnapKind::Nearest;

                    // Subentity snap to face boundary edges / midpoints / vertices (24px reach)
                    const double edgeSnapTol = (worldPerPx > 1e-12) ? (worldPerPx * 24.0) : 0.15;
                    double bestEdgeDist = 1e9;
                    for (const auto& edge : face.edges)
                    {
                        if (hitPt.distanceTo(edge.first) < edgeSnapTol)
                        {
                            snapPt = edge.first;
                            snapKind = SnapKind::Endpoint;
                            break;
                        }
                        if (hitPt.distanceTo(edge.second) < edgeSnapTol)
                        {
                            snapPt = edge.second;
                            snapKind = SnapKind::Endpoint;
                            break;
                        }
                        const OdGePoint3d mid = edge.first + (edge.second - edge.first) * 0.5;
                        if (hitPt.distanceTo(mid) < edgeSnapTol)
                        {
                            snapPt = mid;
                            snapKind = SnapKind::Midpoint;
                            break;
                        }
                        OdGeLineSeg3d seg(edge.first, edge.second);
                        const double d = seg.distanceTo(hitPt);
                        if (d < bestEdgeDist && d < edgeSnapTol)
                        {
                            bestEdgeDist = d;
                            snapPt = seg.closestPointTo(hitPt);
                            snapKind = SnapKind::Nearest;
                        }
                    }

                    PickCandidateRef cand;
                    cand.targetElemId      = entId;
                    cand.candidateBBox     = face.bbox;
                    cand.pCandidateEdges   = &face.edges;
                    cand.pCandidatePolygon = &face.polygon;
                    expandExtents(cand.candidateBBox, (worldPerPx > 1e-12) ? (worldPerPx * 2.0) : 0.01);
                    cand.subentType        = OdDb::kFaceSubentType;
                    cand.subentIndex       = face.faceIndex;
                    cand.geomNormal        = face.normal;
                    cand.geomAnchor        = face.centroid;
                    cand.hasSegment        = false;
                    cand.isDatum           = false;
                    cand.snapPt            = snapPt;
                    cand.snapKind          = snapKind;
                    cand.score             = score;
                    candidateRefs.push_back(cand);
                }
                else
                {
                    distToBoxVal = distanceToBox(face.bbox, cursorPt);
                    if (distToBoxVal <= tol * 3.0)
                    {
                        PickCandidateRef cand;
                        cand.targetElemId      = entId;
                        cand.candidateBBox     = face.bbox;
                        cand.pCandidateEdges   = &face.edges;
                        cand.pCandidatePolygon = &face.polygon;
                        expandExtents(cand.candidateBBox, (worldPerPx > 1e-12) ? (worldPerPx * 2.0) : 0.01);
                        cand.subentType        = OdDb::kFaceSubentType;
                        cand.subentIndex       = face.faceIndex;
                        cand.geomNormal        = face.normal;
                        cand.geomAnchor        = face.centroid;
                        cand.hasSegment        = false;
                        cand.isDatum           = false;
                        cand.snapPt            = clampPointToBox(face.bbox, cursorPt);
                        cand.snapKind          = SnapKind::Nearest;
                        cand.score             = distToBoxVal + (static_cast<double>(eIdx) * 10.0);
                        candidateRefs.push_back(cand);
                    }
                }
            }

            // Fallback for linear/datum elements (Grids, GridChains, Reference Planes, CurveElems)
            // that have no 3D volumetric B-Rep faces: evaluate edges against camera ray so they
            // can be highlighted and snapped in Face mode (critical in 3D views).
            if (faces.isEmpty() && !edges.isEmpty())
            {
                for (OdUInt32 i = 0; i < edges.size(); ++i)
                {
                    if (!isBoxNearRayOrPoint(edges[i].bbox, cursorPt, rayDir, hasRay, tol * 2.5))
                        continue;

                    double d = 1e9;
                    OdGePoint3d edgeSnap = cursorPt;
                    std::pair<OdGePoint3d, OdGePoint3d> candidateSeg;
                    bool hasSeg = false;

                    if (edges[i].isCurve && !edges[i].curveSegs.empty())
                    {
                        for (const auto& seg : edges[i].curveSegs)
                        {
                            double segDist = 1e9;
                            OdGePoint3d curSnap = cursorPt;
                            if (hasRay)
                            {
                                const OdGePoint3d p0 = seg.first  - rayDir * ((seg.first  - cursorPt).dotProduct(rayDir));
                                const OdGePoint3d p1 = seg.second - rayDir * ((seg.second - cursorPt).dotProduct(rayDir));
                                const double len2d = p0.distanceTo(p1);
                                if (len2d >= 1e-4)
                                {
                                    OdGeLineSeg3d seg2d(p0, p1);
                                    segDist = seg2d.distanceTo(cursorPt);
                                    const double lenSq = (p1 - p0).lengthSqrd();
                                    const double t = lenSq > 1e-12
                                        ? std::max(0.0, std::min(1.0, (seg2d.closestPointTo(cursorPt) - p0).dotProduct(p1 - p0) / lenSq))
                                        : 0.0;
                                    curSnap = seg.first + (seg.second - seg.first) * t;
                                }
                            }
                            else
                            {
                                OdGeLineSeg3d seg3d(seg.first, seg.second);
                                segDist = seg3d.distanceTo(cursorPt);
                                curSnap = seg3d.closestPointTo(cursorPt);
                            }

                            if (segDist < d)
                            {
                                d = segDist;
                                edgeSnap = curSnap;
                                candidateSeg = seg;
                                hasSeg = true;
                            }
                        }
                    }
                    else
                    {
                        if (hasRay)
                        {
                            const OdGePoint3d p0 = edges[i].startPt - rayDir * ((edges[i].startPt - cursorPt).dotProduct(rayDir));
                            const OdGePoint3d p1 = edges[i].endPt   - rayDir * ((edges[i].endPt   - cursorPt).dotProduct(rayDir));
                            const double len2d = p0.distanceTo(p1);
                            if (len2d >= 1e-4)
                            {
                                OdGeLineSeg3d seg2d(p0, p1);
                                d = seg2d.distanceTo(cursorPt);
                                const double lenSq = (p1 - p0).lengthSqrd();
                                const double t = lenSq > 1e-12
                                    ? std::max(0.0, std::min(1.0, (seg2d.closestPointTo(cursorPt) - p0).dotProduct(p1 - p0) / lenSq))
                                    : 0.0;
                                edgeSnap = edges[i].startPt + (edges[i].endPt - edges[i].startPt) * t;
                                candidateSeg = { edges[i].startPt, edges[i].endPt };
                                hasSeg = true;
                            }
                        }
                        else
                        {
                            OdGeLineSeg3d seg(edges[i].startPt, edges[i].endPt);
                            d = seg.distanceTo(cursorPt);
                            edgeSnap = seg.closestPointTo(cursorPt);
                            candidateSeg = { edges[i].startPt, edges[i].endPt };
                            hasSeg = true;
                        }
                    }

                    if (hasSeg && d <= tol * 2.5)
                    {
                        SnapKind edgeSnapKind = SnapKind::Nearest;
                        const double endTol = (worldPerPx > 1e-12) ? (worldPerPx * 24.0) : 0.25;

                        if (edges[i].isArc)
                        {
                            const OdGePoint3d midPt = !edges[i].tessPts.empty()
                                ? edges[i].tessPts[edges[i].tessPts.size() / 2]
                                : (edges[i].startPt + (edges[i].endPt - edges[i].startPt) * 0.5);

                            if (edgeSnap.distanceTo(edges[i].startPt) < endTol)
                            {
                                edgeSnap = edges[i].startPt;
                                edgeSnapKind = SnapKind::Endpoint;
                            }
                            else if (edgeSnap.distanceTo(edges[i].endPt) < endTol)
                            {
                                edgeSnap = edges[i].endPt;
                                edgeSnapKind = SnapKind::Endpoint;
                            }
                            else if (edgeSnap.distanceTo(midPt) < endTol)
                            {
                                edgeSnap = midPt;
                                edgeSnapKind = SnapKind::Midpoint;
                            }
                            else if (cursorPt.distanceTo(edges[i].center) < endTol * 1.5)
                            {
                                edgeSnap = edges[i].center;
                                edgeSnapKind = SnapKind::Midpoint;
                            }
                        }
                        else
                        {
                            const OdGePoint3d midPt = edges[i].startPt +
                                (edges[i].endPt - edges[i].startPt) * 0.5;

                            if (edgeSnap.distanceTo(edges[i].startPt) < endTol)
                            {
                                edgeSnap = edges[i].startPt;
                                edgeSnapKind = SnapKind::Endpoint;
                            }
                            else if (edgeSnap.distanceTo(edges[i].endPt) < endTol)
                            {
                                edgeSnap = edges[i].endPt;
                                edgeSnapKind = SnapKind::Endpoint;
                            }
                            else if (edgeSnap.distanceTo(midPt) < endTol)
                            {
                                edgeSnap = midPt;
                                edgeSnapKind = SnapKind::Midpoint;
                            }
                        }

                        const bool isDatumElem = (!pElem.isNull() &&
                            (pElem->isKindOf(OdBmGrid::desc()) ||
                             pElem->isKindOf(OdBmGridChain::desc()) ||
                             pElem->isKindOf(OdBmDatumPlane::desc()) ||
                             pElem->isKindOf(OdBmLevel::desc())));

                        PickCandidateRef cand;
                        cand.targetElemId = entId;
                        if (edges[i].isCurve && !edges[i].curveSegs.empty())
                        {
                            cand.pCandidateEdges   = &edges[i].curveSegs;
                            cand.pCandidatePolygon = &edges[i].tessPts;
                            for (const auto& pt : edges[i].tessPts)
                                cand.candidateBBox.addPoint(pt);
                        }
                        else
                        {
                            cand.localEdges.push_back(candidateSeg);
                            cand.candidateBBox.addPoint(edges[i].startPt);
                            cand.candidateBBox.addPoint(edges[i].endPt);
                        }
                        expandExtents(cand.candidateBBox, (worldPerPx > 1e-12) ? (worldPerPx * 4.0) : 0.04);
                        cand.subentType   = isDatumElem ? OdDb::kNullSubentType : OdDb::kEdgeSubentType;
                        cand.subentIndex  = isDatumElem ? 0 : edges[i].edgeIndex;
                        cand.isDatum      = isDatumElem;
                        cand.hasSegment   = true;
                        cand.segStart     = edges[i].startPt;
                        cand.segEnd       = edges[i].endPt;
                        cand.geomAnchor   = edges[i].isArc ? edges[i].center : (edges[i].startPt + (edges[i].endPt - edges[i].startPt) * 0.5);
                        OdGeVector3d edgeDir = edges[i].endPt - edges[i].startPt;
                        if (!edgeDir.isZeroLength()) edgeDir.normalize();
                        cand.geomNormal   = edgeDir;
                        cand.snapPt       = edgeSnap;
                        cand.snapKind     = edgeSnapKind;
                        cand.isArc        = edges[i].isArc;
                        cand.arcCenter    = edges[i].center;
                        cand.arcRadius    = edges[i].radius;
                        cand.score        = d + (static_cast<double>(eIdx) * 5.0);
                        candidateRefs.push_back(cand);
                    }
                }
            }
        }
    }
    else if (effectiveMode == VBimPickMode::Edge)
    {
        const size_t maxElemsToCheck = std::min<size_t>(candidateElemIds.size(), 16);
        for (size_t eIdx = 0; eIdx < maxElemsToCheck; ++eIdx)
        {
            const OdBmObjectId entId = candidateElemIds[eIdx];
            OdBmElementPtr pElem = entId.safeOpenObject();
            if (pElem.isNull()) continue;

            const ElementGeometryCache* pGeom = ensureGeometry(entId, pElem, geomOpts);
            if (!pGeom)
                continue;

            const auto& edges = pGeom->edges;

            for (OdUInt32 i = 0; i < edges.size(); ++i)
            {
                if (!isBoxNearRayOrPoint(edges[i].bbox, cursorPt, rayDir, hasRay, tol * 2.5))
                    continue;

                double d = 1e9;
                OdGePoint3d edgeSnap = cursorPt;
                std::pair<OdGePoint3d, OdGePoint3d> candidateSeg;
                bool hasSeg = false;

                if (edges[i].isCurve && !edges[i].curveSegs.empty())
                {
                    for (const auto& seg : edges[i].curveSegs)
                    {
                        double segDist = 1e9;
                        OdGePoint3d curSnap = cursorPt;
                        if (hasRay)
                        {
                            const OdGePoint3d p0 = seg.first  - rayDir * ((seg.first  - cursorPt).dotProduct(rayDir));
                            const OdGePoint3d p1 = seg.second - rayDir * ((seg.second - cursorPt).dotProduct(rayDir));
                            const double len2d = p0.distanceTo(p1);
                            if (len2d >= 1e-4)
                            {
                                OdGeLineSeg3d seg2d(p0, p1);
                                segDist = seg2d.distanceTo(cursorPt);
                                const double lenSq = (p1 - p0).lengthSqrd();
                                const double t = lenSq > 1e-12
                                    ? std::max(0.0, std::min(1.0, (seg2d.closestPointTo(cursorPt) - p0).dotProduct(p1 - p0) / lenSq))
                                    : 0.0;
                                curSnap = seg.first + (seg.second - seg.first) * t;
                            }
                        }
                        else
                        {
                            OdGeLineSeg3d seg3d(seg.first, seg.second);
                            segDist = seg3d.distanceTo(cursorPt);
                            curSnap = seg3d.closestPointTo(cursorPt);
                        }

                        if (segDist < d)
                        {
                            d = segDist;
                            edgeSnap = curSnap;
                            candidateSeg = seg;
                            hasSeg = true;
                        }
                    }
                }
                else
                {
                    if (hasRay)
                    {
                        const OdGePoint3d p0 = edges[i].startPt - rayDir * ((edges[i].startPt - cursorPt).dotProduct(rayDir));
                        const OdGePoint3d p1 = edges[i].endPt   - rayDir * ((edges[i].endPt   - cursorPt).dotProduct(rayDir));
                        const double len2d = p0.distanceTo(p1);
                        if (len2d >= 1e-4)
                        {
                            OdGeLineSeg3d seg2d(p0, p1);
                            d = seg2d.distanceTo(cursorPt);
                            const double lenSq = (p1 - p0).lengthSqrd();
                            const double t = lenSq > 1e-12
                                ? std::max(0.0, std::min(1.0, (seg2d.closestPointTo(cursorPt) - p0).dotProduct(p1 - p0) / lenSq))
                                : 0.0;
                            edgeSnap = edges[i].startPt + (edges[i].endPt - edges[i].startPt) * t;
                            candidateSeg = { edges[i].startPt, edges[i].endPt };
                            hasSeg = true;
                        }
                    }
                    else
                    {
                        OdGeLineSeg3d seg(edges[i].startPt, edges[i].endPt);
                        d = seg.distanceTo(cursorPt);
                        edgeSnap = seg.closestPointTo(cursorPt);
                        candidateSeg = { edges[i].startPt, edges[i].endPt };
                        hasSeg = true;
                    }
                }

                if (hasSeg && d <= tol * 2.5)
                {
                    SnapKind edgeSnapKind = SnapKind::Nearest;
                    const double endTol = (worldPerPx > 1e-12) ? (worldPerPx * 24.0) : 0.25;

                    if (edges[i].isArc)
                    {
                        const OdGePoint3d midPt = !edges[i].tessPts.empty()
                            ? edges[i].tessPts[edges[i].tessPts.size() / 2]
                            : (edges[i].startPt + (edges[i].endPt - edges[i].startPt) * 0.5);

                        if (edgeSnap.distanceTo(edges[i].startPt) < endTol)
                        {
                            edgeSnap = edges[i].startPt;
                            edgeSnapKind = SnapKind::Endpoint;
                        }
                        else if (edgeSnap.distanceTo(edges[i].endPt) < endTol)
                            {
                            edgeSnap = edges[i].endPt;
                            edgeSnapKind = SnapKind::Endpoint;
                        }
                        else if (edgeSnap.distanceTo(midPt) < endTol)
                        {
                            edgeSnap = midPt;
                            edgeSnapKind = SnapKind::Midpoint;
                        }
                        else if (cursorPt.distanceTo(edges[i].center) < endTol * 1.5)
                        {
                            edgeSnap = edges[i].center;
                            edgeSnapKind = SnapKind::Midpoint;
                        }
                    }
                    else
                    {
                        const OdGePoint3d midPt = edges[i].startPt +
                            (edges[i].endPt - edges[i].startPt) * 0.5;

                        if (edgeSnap.distanceTo(edges[i].startPt) < endTol)
                        {
                            edgeSnap = edges[i].startPt;
                            edgeSnapKind = SnapKind::Endpoint;
                        }
                        else if (edgeSnap.distanceTo(edges[i].endPt) < endTol)
                        {
                            edgeSnap = edges[i].endPt;
                            edgeSnapKind = SnapKind::Endpoint;
                        }
                        else if (edgeSnap.distanceTo(midPt) < endTol)
                        {
                            edgeSnap = midPt;
                            edgeSnapKind = SnapKind::Midpoint;
                        }
                    }

                    const bool isDatumElem = (!pElem.isNull() &&
                        (pElem->isKindOf(OdBmGrid::desc()) ||
                         pElem->isKindOf(OdBmGridChain::desc()) ||
                         pElem->isKindOf(OdBmDatumPlane::desc()) ||
                         pElem->isKindOf(OdBmLevel::desc())));

                    PickCandidateRef cand;
                    cand.targetElemId = entId;
                    if (edges[i].isCurve && !edges[i].curveSegs.empty())
                    {
                        cand.pCandidateEdges   = &edges[i].curveSegs;
                        cand.pCandidatePolygon = &edges[i].tessPts;
                        for (const auto& pt : edges[i].tessPts)
                            cand.candidateBBox.addPoint(pt);
                    }
                    else
                    {
                        cand.localEdges.push_back(candidateSeg);
                        cand.candidateBBox.addPoint(candidateSeg.first);
                        cand.candidateBBox.addPoint(candidateSeg.second);
                    }
                    expandExtents(cand.candidateBBox, (worldPerPx > 1e-12) ? (worldPerPx * 4.0) : 0.04);
                    cand.subentType   = isDatumElem ? OdDb::kNullSubentType : OdDb::kEdgeSubentType;
                    cand.subentIndex  = isDatumElem ? 0 : edges[i].edgeIndex;
                    cand.isDatum      = isDatumElem;
                    cand.hasSegment   = true;
                    cand.segStart     = edges[i].startPt;
                    cand.segEnd       = edges[i].endPt;
                    cand.geomAnchor   = edges[i].isArc ? edges[i].center : (edges[i].startPt + (edges[i].endPt - edges[i].startPt) * 0.5);
                    OdGeVector3d edgeDir = edges[i].endPt - edges[i].startPt;
                    if (!edgeDir.isZeroLength()) edgeDir.normalize();
                    cand.geomNormal   = edgeDir;
                    cand.snapPt       = edgeSnap;
                    cand.snapKind     = edgeSnapKind;
                    cand.isArc        = edges[i].isArc;
                    cand.arcCenter    = edges[i].center;
                    cand.arcRadius    = edges[i].radius;
                    cand.score        = d + (static_cast<double>(eIdx) * 5.0);
                    candidateRefs.push_back(cand);
                }
            }
        }
    }
    else if (effectiveMode == VBimPickMode::Vertex)
    {
        const size_t maxElemsToCheck = std::min<size_t>(candidateElemIds.size(), 3);
        for (size_t eIdx = 0; eIdx < maxElemsToCheck; ++eIdx)
        {
            const OdBmObjectId entId = candidateElemIds[eIdx];
            OdBmElementPtr pElem = entId.safeOpenObject();
            if (pElem.isNull()) continue;

            const ElementGeometryCache* pGeom = ensureGeometry(entId, pElem, geomOpts);
            if (!pGeom)
                continue;

            const auto& vertices = pGeom->vertices;
            for (OdUInt32 i = 0; i < vertices.size(); ++i)
            {
                const double d = vertices[i].distanceTo(cursorPt);
                if (d <= tol * 2.5)
                {
                    PickCandidateRef cand;
                    cand.targetElemId = entId;
                    cand.snapPt       = vertices[i];
                    cand.snapKind     = SnapKind::Endpoint;
                    cand.candidateBBox.set(vertices[i], vertices[i]);
                    expandExtents(cand.candidateBBox, (worldPerPx > 1e-12) ? (worldPerPx * 4.0) : 0.04);
                    cand.subentType   = OdDb::kVertexSubentType;
                    cand.subentIndex  = static_cast<OdUInt64>(i);
                    cand.score        = d + (static_cast<double>(eIdx) * 5.0);
                    candidateRefs.push_back(cand);
                }
            }
        }
    }
    else if (effectiveMode == VBimPickMode::Element)
    {
        for (size_t eIdx = 0; eIdx < candidateElemIds.size(); ++eIdx)
        {
            const OdBmObjectId entId = candidateElemIds[eIdx];
            OdBmElementPtr pElem = entId.safeOpenObject();
            if (pElem.isNull()) continue;

            OdGeExtents3d elemExtents;
            pElem->getGeomExtents(elemExtents);
            if (!elemExtents.isValidExtents())
            {
                const ElementGeometryCache* pGeom = ensureGeometry(entId, pElem, geomOpts);
                if (pGeom)
                    elemExtents = pGeom->extents;
            }
            if (!elemExtents.isValidExtents()) continue;

            PickCandidateRef cand;
            cand.targetElemId     = entId;
            cand.candidateBBox    = elemExtents;
            cand.subentType       = OdDb::kNullSubentType;
            cand.subentIndex      = 0;
            cand.snapPt           = clampPointToBox(elemExtents, cursorPt);
            cand.snapKind         = SnapKind::Nearest;
            cand.score            = distanceToBox(elemExtents, cursorPt) + (static_cast<double>(eIdx) * 1.0);

            if (is2dView)
            {
                const OdGePoint3d& mn = elemExtents.minPoint();
                const OdGePoint3d& mx = elemExtents.maxPoint();
                const double z = cursorPt.z;
                cand.localEdges.push_back({ OdGePoint3d(mn.x, mn.y, z), OdGePoint3d(mx.x, mn.y, z) });
                cand.localEdges.push_back({ OdGePoint3d(mx.x, mn.y, z), OdGePoint3d(mx.x, mx.y, z) });
                cand.localEdges.push_back({ OdGePoint3d(mx.x, mx.y, z), OdGePoint3d(mn.x, mx.y, z) });
                cand.localEdges.push_back({ OdGePoint3d(mn.x, mx.y, z), OdGePoint3d(mn.x, mn.y, z) });
            }

            candidateRefs.push_back(cand);
        }

        // Snap candidate fallback: if only 1 element is found, but snapping is enabled
        // and multiple snap points exist near the cursor, expand into snap point candidates!
        if (candidateRefs.size() == 1 && coreSnapMode != SnapMode::Off)
        {
            const double kSnapRadiusPixels = 36.0;
            const double radiusWorld = (worldPerPx > 1e-12) ? (worldPerPx * kSnapRadiusPixels) : 1.0;
            OdArray<SnapCandidate> snapCands =
                collectSnapCandidates(m_pDb.get(), m_activeDrawingId, cursorPt, radiusWorld, coreSnapMode);

            if (snapCands.size() > 1)
            {
                PickCandidateRef baseCand = candidateRefs[0];
                candidateRefs.clear();
                for (OdUInt32 sc = 0; sc < snapCands.size(); ++sc)
                {
                    PickCandidateRef scCand = baseCand;
                    scCand.snapPt   = snapCands[sc].point;
                    scCand.snapKind = snapCands[sc].kind;
                    scCand.score    = cursorPt.distanceTo(snapCands[sc].point);
                    candidateRefs.push_back(scCand);
                }
            }
            else if (snapCands.size() == 1)
            {
                candidateRefs[0].snapPt   = snapCands[0].point;
                candidateRefs[0].snapKind = snapCands[0].kind;
            }
        }
        else if (coreSnapMode != SnapMode::Off && !candidateRefs.empty())
        {
            const double kSnapRadiusPixels = 36.0;
            const double radiusWorld = (worldPerPx > 1e-12) ? (worldPerPx * kSnapRadiusPixels) : 1.0;
            OdArray<SnapCandidate> snapCands =
                collectSnapCandidates(m_pDb.get(), m_activeDrawingId, cursorPt, radiusWorld, coreSnapMode);
            if (!snapCands.isEmpty())
            {
                for (auto& cand : candidateRefs)
                {
                    double bestSnapDist = 1e9;
                    for (OdUInt32 sc = 0; sc < snapCands.size(); ++sc)
                    {
                        const double sd = cursorPt.distanceTo(snapCands[sc].point);
                        if (sd < bestSnapDist)
                        {
                            bestSnapDist = sd;
                            cand.snapPt = snapCands[sc].point;
                            cand.snapKind = snapCands[sc].kind;
                        }
                    }
                }
            }
        }
    }
    else if (m_mode == VBimPickMode::Xref)
    {
        for (size_t eIdx = 0; eIdx < candidateElemIds.size(); ++eIdx)
        {
            const OdBmObjectId entId = candidateElemIds[eIdx];
            OdBmElementPtr pElem = entId.safeOpenObject();
            if (pElem.isNull()) continue;

            if (pElem->isKindOf(OdBmRvtLinkInstance::desc()))
            {
                OdBmRvtLinkInstancePtr pRvtLink = OdBmRvtLinkInstance::cast(pElem);
                OdBmDatabasePtr pLinkDb;
                if (VbimGetLinkDatabase(pRvtLink, pLinkDb) == eOk && !pLinkDb.isNull())
                {
                    OdBmObjectId linkDrawId = pLinkDb->getActiveDBDrawingId();
                    if (!linkDrawId.isNull())
                    {
                        try
                        {
                            OdSelectionSetPtr pLinkHit = OdBm::Utils::select(
                                linkDrawId, 1, &cursorPt, OdDbVisualSelection::kPoint, OdDbVisualSelection::kDisableSubents);
                            if (!pLinkHit.isNull())
                            {
                                for (OdSelectionSetIteratorPtr pLIter = pLinkHit->newIterator(); !pLIter->done(); pLIter->next())
                                {
                                    const OdBmObjectId linkedId = pLIter->id();
                                    if (!linkedId.isNull())
                                    {
                                        PickCandidateRef cand;
                                        cand.targetElemId = entId;
                                        cand.linkedElemId = linkedId;
                                        cand.snapPt       = cursorPt;
                                        cand.snapKind     = SnapKind::Nearest;
                                        cand.score        = static_cast<double>(candidateRefs.size());
                                        candidateRefs.push_back(cand);
                                    }
                                }
                            }
                        }
                        catch (const OdError&)
                        {
                        }
                        catch (const std::exception&)
                        {
                        }
                    }
                }
            }
        }
    }

    // Deduplicate candidate references
    std::vector<PickCandidateRef> uniqueCandidates;
    for (const auto& cand : candidateRefs)
    {
        bool isDup = false;
        for (const auto& existing : uniqueCandidates)
        {
            if (existing.targetElemId == cand.targetElemId &&
                existing.linkedElemId == cand.linkedElemId &&
                existing.subentType == cand.subentType &&
                existing.subentIndex == cand.subentIndex &&
                existing.snapPt.distanceTo(cand.snapPt) < 1e-4)
            {
                isDup = true;
                break;
            }
        }
        if (!isDup)
        {
            uniqueCandidates.push_back(cand);
        }
    }

    if (uniqueCandidates.empty() && !candidateElemIds.empty() && m_mode != VBimPickMode::Xref)
    {
        OdBmElementPtr pElem = candidateElemIds[0].safeOpenObject();
        if (!pElem.isNull())
        {
            OdGeExtents3d elemExtents;
            pElem->getGeomExtents(elemExtents);
            PickCandidateRef fallbackCand;
            fallbackCand.targetElemId  = candidateElemIds[0];
            fallbackCand.candidateBBox = elemExtents;
            fallbackCand.snapPt        = cursorPt;
            fallbackCand.snapKind      = SnapKind::Nearest;
            fallbackCand.score         = 0.0;
            uniqueCandidates.push_back(fallbackCand);
        }
    }

    if (uniqueCandidates.empty())
    {
        clearHover();
        return;
    }

    std::stable_sort(uniqueCandidates.begin(), uniqueCandidates.end(),
        [](const PickCandidateRef& a, const PickCandidateRef& b) {
            return a.score < b.score;
        });

    if (uniqueCandidates.size() > 16)
    {
        uniqueCandidates.resize(16);
    }

    // Reset candidate index when hovering over a different element
    if (!m_hoveredId.isNull() && !uniqueCandidates.empty() && uniqueCandidates[0].targetElemId != m_hoveredId)
    {
        m_candidateIndex = 0;
    }
    else if (m_candidateIndex != 0 && m_result.isValid)
    {
        // Preserve current candidate index when the selected candidate remains in uniqueCandidates,
        // while resetting it when that candidate is no longer present.
        bool bCandidatePresent = false;
        for (const auto& cand : uniqueCandidates)
        {
            if (cand.targetElemId == m_result.elementId &&
                cand.linkedElemId == m_result.linkedElementId &&
                cand.subentType == m_result.subentType &&
                (m_result.subentIndex >= 0 && cand.subentIndex == static_cast<OdUInt64>(m_result.subentIndex)))
            {
                bCandidatePresent = true;
                break;
            }
        }
        if (!bCandidatePresent)
        {
            m_candidateIndex = 0;
        }
    }

    m_candidateCount = static_cast<int>(uniqueCandidates.size());
    const int step = m_cyclingCandidate && m_candidateIndex < m_activeCandidateIndex ? -1 : 1;
    m_activeCandidateIndex = ((m_candidateIndex % m_candidateCount) + m_candidateCount) % m_candidateCount;

    // Calculate lift vector towards camera eye to prevent Z-fighting overlap with wall geometry
    OdGeVector3d liftVector(0.0, 0.0, 1.0);
    if (!m_pGsView.isNull())
    {
        try
        {
            OdGeVector3d viewDir = m_pGsView->target() - m_pGsView->position();
            if (!viewDir.isZeroLength())
            {
                viewDir.normalize();
                liftVector = -viewDir;
            }
        }
        catch (const OdError&)
        {
        }
        catch (const std::exception&)
        {
        }
    }
    const double liftDistance = (worldPerPx > 1e-12) ? std::max(0.0005, worldPerPx * 1.5) : 0.0005;

    const std::vector<OdGePoint3d> emptyPoly;
    m_worldPerPxLast = worldPerPx;

    // Opt-in resolvers may reject a raw subentity while another reference
    // inside the same pick aperture is valid. Try it before clearing hover;
    // keep legacy filters' single-candidate behavior and TAB direction.
    const int requestedIndex = m_activeCandidateIndex;
    const bool resolveAlternatives = dynamic_cast<IVBimSelectionReferenceResolver*>(m_pFilter) != nullptr;
    const int attempts = resolveAlternatives ? m_candidateCount : 1;
    for (int attempt = 0; attempt < attempts; ++attempt)
    {
        const int index = ((requestedIndex + step * attempt) % m_candidateCount + m_candidateCount) % m_candidateCount;
        const PickCandidateRef& activeCand = uniqueCandidates[index];
        const std::vector<std::pair<OdGePoint3d, OdGePoint3d>>& candEdges =
            activeCand.pCandidateEdges ? *activeCand.pCandidateEdges : activeCand.localEdges;
        const std::vector<OdGePoint3d>& candPoly =
            activeCand.pCandidatePolygon ? *activeCand.pCandidatePolygon : emptyPoly;

        if (updateCandidate(
            activeCand.targetElemId,
            activeCand.linkedElemId,
            activeCand.candidateBBox,
            candEdges,
            candPoly,
            liftVector,
            liftDistance,
            activeCand.subentType,
            activeCand.subentIndex,
            activeCand.snapPt,
            activeCand.snapKind,
            worldPerPx,
            activeCand.geomNormal,
            activeCand.geomAnchor,
            activeCand.hasSegment,
            activeCand.segStart,
            activeCand.segEnd,
            activeCand.isDatum,
            activeCand.isArc,
            activeCand.arcCenter,
            activeCand.arcRadius))
        {
            m_activeCandidateIndex = index;
            if (resolveAlternatives) m_candidateIndex = index;
            return;
        }
    }
    clearHover();
}

bool VBimPickTracker::updateCandidate(
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
    double worldPerPx,
    const OdGeVector3d& geomNormal,
    const OdGePoint3d& geomAnchor,
    bool hasSegment,
    const OdGePoint3d& segStart,
    const OdGePoint3d& segEnd,
    bool isDatum,
    bool isArc,
    const OdGePoint3d& arcCenter,
    double arcRadius)
{
    VBimObjectSnapTypes pubSnap = VBimObjectSnapTypes::None;
    if (snapKind == SnapKind::Endpoint) pubSnap = VBimObjectSnapTypes::Endpoints;
    else if (snapKind == SnapKind::Midpoint) pubSnap = VBimObjectSnapTypes::Midpoints;
    else if (snapKind == SnapKind::Nearest) pubSnap = VBimObjectSnapTypes::Nearest;

    VBimReference candRef;
    candRef.elementId       = id;
    candRef.linkedElementId = linkedId;
    candRef.objectType      = (subentType == OdDb::kEdgeSubentType) ? VBimObjectType::Edge : m_mode;
    candRef.subentType      = subentType;
    candRef.subentIndex     = static_cast<OdGsMarker>(subentIndex);
    candRef.globalPoint     = snapPt;
    candRef.snapType        = pubSnap;
    candRef.snapMode        = m_snapMode;
    candRef.isValid         = !id.isNull();

    // Populate true geometric properties
    candRef.normal     = geomNormal.isZeroLength() ? liftVector : geomNormal;
    candRef.anchor     = (geomAnchor == OdGePoint3d::kOrigin) ? snapPt : geomAnchor;
    candRef.hasSegment = hasSegment;
    candRef.segStart   = segStart;
    candRef.segEnd     = segEnd;
    candRef.segPoints  = candidatePolygon;
    candRef.isArc      = isArc;
    candRef.arcCenter  = arcCenter;
    candRef.arcRadius  = arcRadius;

    if (subentType == OdDb::kFaceSubentType)
    {
        candRef.geomRef = VBimReferenceExtractor::createGeomRef(id, OdDb::kFaceSubentType, candRef.subentIndex);
    }
    else if (isDatum)
    {
        candRef.subentType  = OdDb::kNullSubentType;
        candRef.subentIndex = 0;
        candRef.geomRef     = VBimReferenceExtractor::createGeomRef(id);
    }
    else if (hasSegment)
    {
        candRef.geomRef = VBimReferenceExtractor::createGeomRef(id, OdDb::kEdgeSubentType, candRef.subentIndex);
    }
    else
    {
        candRef.geomRef = VBimReferenceExtractor::createGeomRef(id, subentType, candRef.subentIndex);
    }

    auto* resolver = dynamic_cast<IVBimSelectionReferenceResolver*>(m_pFilter);
    if (m_pFilter)
    {
        // Opt-in reference resolvers need the unsnapped cursor for aperture
        // tests. Keep the historical snap position for existing filters.
        const auto& filterPosition = resolver ? m_lastEvaluatedPt : snapPt;
        if (!m_pFilter->AllowElement(id) || !m_pFilter->AllowReference(candRef, filterPosition))
        {
            return false;
        }
    }

    // DIM and other opt-in filters can resolve a hit to a different native
    // reference on this element (e.g. wall center instead of its visible face).
    bool resolvedPreview = false;
    if (resolver)
    {
        VBimReference resolved = candRef;
        if (resolver->ResolveReference(resolved) && resolved.elementId == id &&
            resolved.linkedElementId == linkedId && !resolved.geomRef.isNull() &&
            (resolved.objectType == VBimObjectType::Element || resolved.hasSegment || resolved.segPoints.size() >= 2))
        {
            candRef = resolved;
            resolvedPreview = true;
        }
    }

    const bool isSameEntity = (id == m_hoveredId);
    const bool previewModeChanged = resolvedPreview &&
        ((candRef.objectType == VBimObjectType::Element) != (m_result.objectType == VBimObjectType::Element));

    if (!isSameEntity || previewModeChanged)
    {
        // Unhighlight previous
        if (!m_hoveredId.isNull())
        {
            try
            {
                OdBmElementPtr pOld = m_hoveredId.safeOpenObject();
                if (!pOld.isNull())
                    pOld->highlight(false);
            }
            catch (const OdError&)
            {
            }
            catch (const std::exception&)
            {
            }
        }

        // Highlight new candidate in Element mode, and always for Datum elements (Grids, Reference Planes)
        // so the entire datum line and bubble light up across all views.
        m_hoveredId = id;
        if (!m_hoveredId.isNull())
        {
            try
            {
                OdBmElementPtr pEnt = m_hoveredId.safeOpenObject();
                if (!pEnt.isNull())
                {
                    bool shouldNativeHighlight = resolvedPreview
                        ? candRef.objectType == VBimObjectType::Element : m_mode == VBimObjectType::Element;
                    if (!shouldNativeHighlight)
                    {
                        if (pEnt->isKindOf(OdBmGrid::desc()) ||
                            pEnt->isKindOf(OdBmGridChain::desc()) ||
                            pEnt->isKindOf(OdBmDatumPlane::desc()))
                        {
                            shouldNativeHighlight = true;
                        }
                    }
                    if (shouldNativeHighlight)
                    {
                        pEnt->highlight(true);
                    }
                }
            }
            catch (const OdError&)
            {
            }
            catch (const std::exception&)
            {
            }
        }
    }

    m_bboxDrawable.setPixelScale(worldPerPx);

    // Update 3D wireframe / face contour / edge highlight
    if (resolvedPreview && candRef.objectType == VBimObjectType::Element)
    {
        // Whole-owner native highlight above is authoritative. Do not leave
        // the raw hit edge/face overlay on top when mode changes mid-pick.
        m_bboxDrawable.clearBBox();
    }
    else if (resolvedPreview && candRef.objectType == VBimObjectType::Face &&
        !candRef.hasSegment && candRef.segPoints.size() >= 3)
    {
        // A resolver supplies geometry for its accepted face, which may differ
        // from the original hit. Do not fill the original hit or an owner box.
        OdGeExtents3d faceBounds;
        for (const auto& point : candRef.segPoints) faceBounds.addPoint(point);
        m_bboxDrawable.showFace(faceBounds, {}, candRef.segPoints, liftVector, liftDistance);
    }
    else if (resolvedPreview)
    {
        std::vector<std::pair<OdGePoint3d, OdGePoint3d>> edges;
        if (candRef.segPoints.size() >= 2)
            for (size_t i = 1; i < candRef.segPoints.size(); ++i)
                edges.emplace_back(candRef.segPoints[i-1], candRef.segPoints[i]);
        else
            edges.emplace_back(candRef.segStart, candRef.segEnd);
        m_bboxDrawable.showEdge(edges, liftVector, liftDistance, worldPerPx);
    }
    else if (subentType == OdDb::kFaceSubentType)
    {
        m_bboxDrawable.showFace(candidateBBox, candidateEdges, candidatePolygon, liftVector, liftDistance);
    }
    else if (subentType == OdDb::kEdgeSubentType && !candidateEdges.empty())
    {
        m_bboxDrawable.showEdge(candidateEdges, liftVector, liftDistance, worldPerPx);
    }
    else if (!candidateEdges.empty())
    {
        m_bboxDrawable.showEdge(candidateEdges, liftVector, liftDistance, worldPerPx);
    }
    else if (!candidatePolygon.empty())
    {
        m_bboxDrawable.showFace(candidateBBox, candidateEdges, candidatePolygon, liftVector, liftDistance);
    }
    else if (candidateBBox.isValidExtents())
    {
        m_bboxDrawable.showBBox(candidateBBox, liftVector, liftDistance, snapPt.z, m_is2dView);
    }
    else
    {
        m_bboxDrawable.clearBBox();
    }

    // Update snap glyph
    if (!(resolvedPreview && candRef.objectType == VBimObjectType::Element) &&
        snapKind != SnapKind::None && m_snapMode != VBimObjectSnapTypes::Off)
        m_snapGlyph.showSnapped(candRef.globalPoint, snapKind);
    else
        m_snapGlyph.clearSnap();

    // Record fully enriched result
    m_result = candRef;

    if (!m_pTopModel.isNull())
    {
        m_pTopModel->onModified(&m_bboxDrawable, static_cast<OdGiDrawable*>(nullptr));
        m_pTopModel->onModified(&m_snapGlyph, static_cast<OdGiDrawable*>(nullptr));
    }

    if (!m_pGsView.isNull())
        m_pGsView->invalidate();
    return true;
}

