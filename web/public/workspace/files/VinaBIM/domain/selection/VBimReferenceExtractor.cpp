///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Selection Engine
// VBimReferenceExtractor.cpp — Unified generic reference extractor.
///////////////////////////////////////////////////////////////////////////////
#include "pch.h"
#include "domain/public_api/selection/VBimReferenceExtractor.h"

#include "Geometry/Entities/BmGBrep.h"
#include "Geometry/Entities/BmGGroup.h"
#include "Geometry/Entities/BmGInstance.h"
#include "Geometry/Entities/BmGFace.h"
#include "Geometry/Entities/BmFace.h"
#include "Geometry/Entities/BmGEdge.h"
#include "Geometry/Entities/BmGEdgeLoop.h"
#include "Geometry/Entities/BmEdge.h"
#include "Geometry/Entities/BmGLine.h"
#include "Geometry/Entities/BmGArc.h"
#include "Geometry/Entities/BmGCurve.h"
#include "Database/BmGeometryOption.h"
#include "Ge/GePlane.h"
#include "Essential/Entities/BmCurveElem.h"
#include "Essential/Entities/BmGrid.h"
#include "Essential/Entities/BmGridChain.h"
#include "Infrastructure/Oda/sdk_includes/BmSdkCompat.h"
#include "Essential/Entities/BmLevel.h"
#include "HostObj/Entities/BmVWall.h"

#include <algorithm>
#include <cmath>
#include <set>

namespace
{
    /**
     * @brief Helper to test and extract circular arc properties from an OdBmGCurve.
     */
    bool extractArcGeometry(
        const OdBmGCurvePtr& pGCurve,
        const OdGeMatrix3d& trf,
        VBimReference& ref)
    {
        if (pGCurve.isNull())
            return false;

        OdBmGArcPtr pArc = OdBmGArc::cast(pGCurve);
        if (pArc.isNull())
            return false;

        ref.isArc = true;
        OdGePoint3d center = pArc->getCenter();
        center.transformBy(trf);
        ref.arcCenter = center;

        double scale = trf.scale();
        if (scale <= 1e-9)
            scale = 1.0;
        ref.arcRadius = pArc->getRadius() * scale;

        const int numSamples = 32;
        ref.segPoints.clear();
        ref.segPoints.reserve(numSamples + 1);

        bool evalSuccess = true;
        for (int s = 0; s <= numSamples; ++s)
        {
            const double t = static_cast<double>(s) / static_cast<double>(numSamples);
            OdGePoint3d pt;
            if (pArc->evaluate(pt, t, true) == eOk)
            {
                pt.transformBy(trf);
                ref.segPoints.push_back(pt);
            }
            else
            {
                evalSuccess = false;
                break;
            }
        }

        if (!evalSuccess || ref.segPoints.size() < 2)
        {
            ref.segPoints.clear();
            const double startAng = pArc->getStartAng();
            double endAng = pArc->getEndAng();
            if (endAng <= startAng)
                endAng += Oda2PI;

            OdGeVector3d xDir = pArc->getXDirection();
            OdGeVector3d yDir = pArc->getYDirection();
            if (!xDir.isZeroLength())
                xDir.normalize();
            if (!yDir.isZeroLength())
                yDir.normalize();

            const double r = pArc->getRadius();
            const OdGePoint3d c = pArc->getCenter();

            for (int s = 0; s <= numSamples; ++s)
            {
                const double frac = static_cast<double>(s) / static_cast<double>(numSamples);
                const double ang = startAng + (endAng - startAng) * frac;
                OdGePoint3d pt = c + xDir * (r * std::cos(ang)) + yDir * (r * std::sin(ang));
                pt.transformBy(trf);
                ref.segPoints.push_back(pt);
            }
        }

        return true;
    }

    /**
     * @brief Helper to recursively traverse B-Rep nodes and collect Face and Edge references.
     */
    void walkBRepGroup(
        const OdBmObjectId& elemId,
        const OdBmGGroupPtr& pGroup,
        const OdGeMatrix3d& currentTrf,
        const OdBmGeometryOptions& opts,
        std::vector<VBimReference>& outRefs,
        std::set<OdInt32>& seenEdgeTags,
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
                                }
                                if (hasEnd)
                                {
                                    ptEnd.transformBy(currentTrf);
                                    faceBox.addPoint(ptEnd);
                                }

                                if (hasStart && hasEnd)
                                {
                                    OdInt32 edgeTag = -1;
                                    OdBmObjectPtr pEdgeObj(pNext);
                                    OdBmEdgePtr pBmEdge = OdBmEdge::cast(pEdgeObj);
                                    if (!pBmEdge.isNull())
                                        edgeTag = pBmEdge->getTag();

                                    const bool alreadyEmitted = (edgeTag >= 0 && seenEdgeTags.find(edgeTag) != seenEdgeTags.end());
                                    if (edgeTag >= 0)
                                        seenEdgeTags.insert(edgeTag);

                                    if (!alreadyEmitted)
                                    {
                                        const OdGsMarker marker = (edgeTag >= 0) ? edgeTag : static_cast<OdGsMarker>(outRefs.size());
                                        VBimReference edgeRef;
                                        edgeRef.elementId   = elemId;
                                        edgeRef.objectType  = VBimObjectType::Edge;
                                        edgeRef.subentType  = OdDb::kEdgeSubentType;
                                        edgeRef.subentIndex = marker;
                                        edgeRef.segStart    = ptStart;
                                        edgeRef.segEnd      = ptEnd;
                                        edgeRef.hasSegment  = true;
                                        edgeRef.anchor      = ptStart + (ptEnd - ptStart) * 0.5;
                                        edgeRef.globalPoint = edgeRef.anchor;

                                        OdGeVector3d edgeDir = ptEnd - ptStart;
                                        if (!edgeDir.isZeroLength())
                                            edgeDir.normalize();
                                        edgeRef.normal  = edgeDir;
                                        edgeRef.geomRef = VBimReferenceExtractor::createGeomRef(elemId, OdDb::kEdgeSubentType, marker);
                                        edgeRef.isValid = true;

                                        OdBmGCurvePtr pGCurve;
                                        if (pGEdge->getGCurve(pGCurve) == eOk && !pGCurve.isNull())
                                        {
                                            if (extractArcGeometry(pGCurve, currentTrf, edgeRef))
                                            {
                                                if (!edgeRef.segPoints.empty())
                                                {
                                                    edgeRef.anchor = edgeRef.segPoints[edgeRef.segPoints.size() / 2];
                                                    edgeRef.globalPoint = edgeRef.anchor;
                                                }
                                            }
                                        }

                                        outRefs.push_back(edgeRef);
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
                                sumVec += pt.asVector();
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
                            normal = -normal;

                        // Fallback: Newell's method
                        if (normal.isZeroLength() && facePolygon.size() >= 3)
                        {
                            const size_t numPts = facePolygon.size();
                            for (size_t k = 0; k < numPts; ++k)
                            {
                                const OdGePoint3d& c = facePolygon[k];
                                const OdGePoint3d& n = facePolygon[(k + 1) % numPts];
                                normal.x += (c.y - n.y) * (c.z + n.z);
                                normal.y += (c.z - n.z) * (c.x + n.x);
                                normal.z += (c.x - n.x) * (c.y + n.y);
                            }
                            if (pFace->isNormalFlipped() && !normal.isZeroLength())
                                normal = -normal;
                        }

                        if (!normal.isZeroLength())
                            normal.normalize();

                        OdInt32 faceTag = -1;
                        if (!pFace.isNull() && pFace->getTag() >= 0)
                            faceTag = pFace->getTag();

                        const OdGsMarker marker = (faceTag >= 0) ? faceTag : static_cast<OdGsMarker>(outRefs.size());
                        VBimReference faceRef;
                        faceRef.elementId   = elemId;
                        faceRef.objectType  = VBimObjectType::Face;
                        faceRef.subentType  = OdDb::kFaceSubentType;
                        faceRef.subentIndex = marker;
                        faceRef.normal      = normal;
                        faceRef.anchor      = centroid;
                        faceRef.globalPoint = centroid;
                        faceRef.segPoints   = facePolygon;
                        faceRef.geomRef     = VBimReferenceExtractor::createGeomRef(elemId, OdDb::kFaceSubentType, marker);
                        faceRef.isValid     = true;
                        outRefs.push_back(faceRef);
                    }
                }
            }
            else if (pNode->isKindOf(OdBmGInstance::desc()) && depth < 5)
            {
                OdBmGInstancePtr pInst = OdBmGInstance::cast(pNode);
                OdGeMatrix3d instTrf = currentTrf;
                OdBmInstInfoBasePtr pInfo = pInst->getInstanceInfo();
                if (!pInfo.isNull())
                    instTrf = currentTrf * pInfo->getTrf();

                OdBmObjectPtr pInstGeom;
                if (pInst->getGeometry(opts, pInstGeom) == eOk && !pInstGeom.isNull())
                {
                    OdBmGGroupPtr pSubGroup = OdBmGGroup::cast(pInstGeom);
                    if (!pSubGroup.isNull())
                        walkBRepGroup(elemId, pSubGroup, instTrf, opts, outRefs, seenEdgeTags, depth + 1);
                }
            }
            else if (pNode->isKindOf(OdBmGGroup::desc()) && depth < 5)
            {
                OdBmGGroupPtr pSubGroup = OdBmGGroup::cast(pNode);
                walkBRepGroup(elemId, pSubGroup, currentTrf, opts, outRefs, seenEdgeTags, depth + 1);
            }
        }
    }
}

OdBmGeomRefPtr VBimReferenceExtractor::createGeomRef(
    const OdBmObjectId& elemId,
    OdDb::SubentType subentType,
    OdGsMarker subentIndex)
{
    if (elemId.isNull())
        return OdBmGeomRefPtr();

    OdBmGeomRefPtr pRef = OdBmGeomRef::createObject();
    if (pRef.isNull())
        return OdBmGeomRefPtr();

    // Datum elements (Grids, Reference Planes, Levels) must always use bare element geomRefs without tags
    OdBmObjectPtr pObj = elemId.safeOpenObject();
    if (!pObj.isNull())
    {
        if (!OdBmGrid::cast(pObj).isNull() ||
            !OdBmGridChain::cast(pObj).isNull() ||
            !OdBmDatumPlane::cast(pObj).isNull() ||
            !OdBmLevel::cast(pObj).isNull())
        {
            pRef->set(elemId);
            return pRef;
        }
    }

    if (subentType == OdDb::kFaceSubentType || subentType == OdDb::kEdgeSubentType)
    {
        OdInt32Array intermediateTags;
        intermediateTags.push_back(static_cast<OdInt32>(subentIndex));
        pRef->set(elemId, intermediateTags, static_cast<OdInt32>(subentIndex));
    }
    else
    {
        pRef->set(elemId);
    }
    return pRef;
}

bool VBimReferenceExtractor::extract(
    const OdBmObjectId& elementId,
    OdBmDBViewPtr pView,
    std::vector<VBimReference>& outRefs,
    const OdGePoint3d* pNearPt)
{
    if (elementId.isNull())
        return false;

    OdBmObjectPtr pObj = elementId.safeOpenObject();
    OdBmElementPtr pElem = OdBmElement::cast(pObj);
    if (pElem.isNull())
        return false;

    const size_t initialCount = outRefs.size();

    // 1. Datum elements (Grids, Reference Planes, Levels)
    extractDatumReferences(pElem, pView, outRefs);

    // 2. Curve elements (Model lines, Detail lines, MEP curves)
    extractCurveReferences(pElem, outRefs);

    // 3. Location centerlines (Walls, Structural Framing)
    extractLocationReferences(pElem, outRefs);

    // 4. B-Rep Solids / Surfaces (Faces & Edges)
    extractBRepReferences(pElem, outRefs);

    if (outRefs.size() == initialCount)
        return false;

    // Optional proximity sort
    if (pNearPt != nullptr && outRefs.size() > initialCount + 1)
    {
        const OdGePoint3d pt = *pNearPt;
        std::sort(outRefs.begin() + initialCount, outRefs.end(),
            [&pt](const VBimReference& a, const VBimReference& b)
            {
                return a.anchor.distanceTo(pt) < b.anchor.distanceTo(pt);
            });
    }

    return true;
}

bool VBimReferenceExtractor::extractBRepReferences(
    const OdBmElementPtr& pElem,
    std::vector<VBimReference>& outRefs)
{
    if (pElem.isNull())
        return false;

    OdBmGeometryOptions opts;
    opts.setComputeReferences(true);
    opts.setDetailLevel(OdBm::ViewDetailLevel::Fine);

    OdBmObjectPtr pGeomObj;
    if (pElem->getGeometry(opts, pGeomObj) != eOk || pGeomObj.isNull())
        pGeomObj = pElem->getGeometry();

    if (pGeomObj.isNull())
        return false;

    OdBmGGroupPtr pGroup = OdBmGGroup::cast(pGeomObj);
    if (pGroup.isNull())
        return false;

    const size_t countBefore = outRefs.size();
    std::set<OdInt32> seenEdgeTags;
    walkBRepGroup(pElem->objectId(), pGroup, OdGeMatrix3d::kIdentity, opts, outRefs, seenEdgeTags);
    return outRefs.size() > countBefore;
}

bool VBimReferenceExtractor::extractCurveReferences(
    const OdBmElementPtr& pElem,
    std::vector<VBimReference>& outRefs)
{
    if (pElem.isNull())
        return false;

    OdBmCurveElemPtr pCurveElem = OdBmCurveElem::cast(pElem);
    if (!pCurveElem.isNull())
    {
        OdBmGCurvePtr pGCurve;
        if (pCurveElem->getGeomCurve(pGCurve) == eOk && !pGCurve.isNull())
        {
            OdGePoint3d p0, p1;
            if (pGCurve->getEndPoint(p0, 0) == eOk && pGCurve->getEndPoint(p1, 1) == eOk)
            {
                VBimReference ref;
                ref.elementId   = pElem->objectId();
                ref.objectType  = VBimObjectType::Edge;
                ref.subentType  = OdDb::kEdgeSubentType;
                ref.subentIndex = 0;
                ref.segStart    = p0;
                ref.segEnd      = p1;
                ref.hasSegment  = true;
                ref.anchor      = p0 + (p1 - p0) * 0.5;
                ref.globalPoint = ref.anchor;
                const OdGeVector3d segDir = p1 - p0;
                ref.normal      = segDir.isZeroLength() ? OdGeVector3d::kZAxis : segDir.normal();
                ref.geomRef     = createGeomRef(pElem->objectId());
                ref.isValid     = true;

                if (extractArcGeometry(pGCurve, OdGeMatrix3d::kIdentity, ref))
                {
                    if (!ref.segPoints.empty())
                    {
                        ref.anchor = ref.segPoints[ref.segPoints.size() / 2];
                        ref.globalPoint = ref.anchor;
                    }
                }

                outRefs.push_back(ref);
                return true;
            }
        }
    }
    return false;
}

bool VBimReferenceExtractor::extractDatumReferences(
    const OdBmElementPtr& pElem,
    OdBmDBViewPtr pView,
    std::vector<VBimReference>& outRefs)
{
    if (pElem.isNull())
        return false;

    // 1. Grid Chain
    OdBmGridChainPtr pChain = OdBmGridChain::cast(pElem);
    if (!pChain.isNull())
    {
        bool foundAny = false;
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
                        VBimReference ref;
                        ref.elementId   = pElem->objectId();
                        ref.objectType  = VBimObjectType::Element;
                        ref.subentType  = OdDb::kNullSubentType;
                        ref.subentIndex = it->first;
                        ref.segStart    = p0;
                        ref.segEnd      = p1;
                        ref.hasSegment  = true;
                        ref.anchor      = p0 + (p1 - p0) * 0.5;
                        ref.globalPoint = ref.anchor;
                        ref.normal      = (p1 - p0).normal();
                        ref.geomRef     = createGeomRef(pElem->objectId());
                        ref.isValid     = true;

                        if (extractArcGeometry(pGCurve, OdGeMatrix3d::kIdentity, ref))
                        {
                            if (!ref.segPoints.empty())
                            {
                                ref.anchor = ref.segPoints[ref.segPoints.size() / 2];
                                ref.globalPoint = ref.anchor;
                            }
                        }

                        outRefs.push_back(ref);
                        foundAny = true;
                    }
                }
            }
        }
        return foundAny;
    }

    // 2. Linear / Curved Grid
    OdBmGridPtr pGrid = OdBmGrid::cast(pElem);
    if (!pGrid.isNull())
    {
        OdBmGCurvePtr pGCurve = pGrid->getCurve();
        if (!pGCurve.isNull())
        {
            OdGePoint3d p0, p1;
            if (pGCurve->getEndPoint(p0, 0) == eOk && pGCurve->getEndPoint(p1, 1) == eOk)
            {
                VBimReference ref;
                ref.elementId   = pElem->objectId();
                ref.objectType  = VBimObjectType::Element;
                ref.subentType  = OdDb::kNullSubentType;
                ref.segStart    = p0;
                ref.segEnd      = p1;
                ref.hasSegment  = true;
                ref.anchor      = p0 + (p1 - p0) * 0.5;
                ref.globalPoint = ref.anchor;
                const OdGeVector3d segDir = p1 - p0;
                ref.normal      = segDir.isZeroLength() ? OdGeVector3d::kZAxis : segDir.normal();
                ref.geomRef     = createGeomRef(pElem->objectId());
                ref.isValid     = true;

                if (extractArcGeometry(pGCurve, OdGeMatrix3d::kIdentity, ref))
                {
                    if (!ref.segPoints.empty())
                    {
                        ref.anchor = ref.segPoints[ref.segPoints.size() / 2];
                        ref.globalPoint = ref.anchor;
                    }
                }
                else if (pGrid->isCurved())
                {
                    const int numSamples = 32;
                    for (int s = 0; s <= numSamples; ++s)
                    {
                        const double t = static_cast<double>(s) / static_cast<double>(numSamples);
                        OdGePoint3d pt;
                        if (pGCurve->evaluate(pt, t, true) == eOk)
                            ref.segPoints.push_back(pt);
                    }
                    if (!ref.segPoints.empty())
                    {
                        ref.anchor = ref.segPoints[ref.segPoints.size() / 2];
                        ref.globalPoint = ref.anchor;
                    }
                }
                outRefs.push_back(ref);
                return true;
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
                        VBimReference ref;
                        ref.elementId   = pElem->objectId();
                        ref.objectType  = VBimObjectType::Element;
                        ref.subentType  = OdDb::kNullSubentType;
                        ref.segStart    = origin - dir * 50.0;
                        ref.segEnd      = origin + dir * 50.0;
                        ref.hasSegment  = true;
                        ref.anchor      = origin;
                        ref.globalPoint = origin;
                        ref.normal      = dir;
                        ref.geomRef     = createGeomRef(pElem->objectId());
                        ref.isValid     = true;
                        outRefs.push_back(ref);
                        return true;
                    }
                }
            }
        }
    }

    // 3. Reference Plane (DatumPlane)
    OdBmDatumPlanePtr pDatum = OdBmDatumPlane::cast(pElem);
    if (!pDatum.isNull())
    {
        OdGePoint3d bubbleEnd = pDatum->getBubbleEnd();
        OdGePoint3d freeEnd   = pDatum->getFreeEnd();
        OdGeVector3d dir      = freeEnd - bubbleEnd;
        if (!dir.isZeroLength())
        {
            dir.normalize();
            VBimReference ref;
            ref.elementId   = pElem->objectId();
            ref.objectType  = VBimObjectType::Element;
            ref.subentType  = OdDb::kNullSubentType;
            ref.segStart    = bubbleEnd;
            ref.segEnd      = freeEnd;
            ref.hasSegment  = true;
            ref.anchor      = bubbleEnd + (freeEnd - bubbleEnd) * 0.5;
            ref.globalPoint = ref.anchor;
            ref.normal      = dir;
            ref.geomRef     = createGeomRef(pElem->objectId());
            ref.isValid     = true;
            outRefs.push_back(ref);
            return true;
        }
    }

    // 4. Level
    OdBmLevelPtr pLevel = OdBmLevel::cast(pElem);
    if (!pLevel.isNull())
    {
        const double elev = pLevel->getElevation();
        VBimReference ref;
        ref.elementId   = pElem->objectId();
        ref.objectType  = VBimObjectType::Element;
        ref.subentType  = OdDb::kNullSubentType;
        ref.anchor      = OdGePoint3d(0.0, 0.0, elev);
        ref.globalPoint = ref.anchor;
        ref.normal      = OdGeVector3d::kZAxis;
        ref.geomRef     = createGeomRef(pElem->objectId());
        ref.isValid     = true;
        outRefs.push_back(ref);
        return true;
    }

    return false;
}

bool VBimReferenceExtractor::extractLocationReferences(
    const OdBmElementPtr& pElem,
    std::vector<VBimReference>& outRefs)
{
    if (pElem.isNull())
        return false;

    OdBmVWallPtr pWall = OdBmVWall::cast(pElem);
    if (!pWall.isNull())
    {
        OdBmGCurvePtr pCurve;
        if (pWall->getLocationCurve(pCurve) == eOk && !pCurve.isNull())
        {
            OdGePoint3d p0, p1;
            if (pCurve->getEndPoint(p0, 0) == eOk && pCurve->getEndPoint(p1, 1) == eOk)
            {
                VBimReference ref;
                ref.elementId   = pElem->objectId();
                ref.objectType  = VBimObjectType::Edge;
                ref.subentType  = OdDb::kNullSubentType;
                ref.subentIndex = 0;
                ref.segStart    = p0;
                ref.segEnd      = p1;
                ref.hasSegment  = true;
                ref.anchor      = p0 + (p1 - p0) * 0.5;
                ref.globalPoint = ref.anchor;
                const OdGeVector3d segDir = p1 - p0;
                ref.normal      = segDir.isZeroLength() ? OdGeVector3d::kZAxis : segDir.normal();
                ref.geomRef     = createGeomRef(pElem->objectId());
                ref.isValid     = true;

                if (extractArcGeometry(pCurve, OdGeMatrix3d::kIdentity, ref))
                {
                    if (!ref.segPoints.empty())
                    {
                        ref.anchor = ref.segPoints[ref.segPoints.size() / 2];
                        ref.globalPoint = ref.anchor;
                    }
                }

                outRefs.push_back(ref);
                return true;
            }
        }
    }
    return false;
}
