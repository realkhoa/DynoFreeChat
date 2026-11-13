///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Selection Engine
// VBimPickBBoxDrawable.cpp — 3D Bounding Box transient preview drawable.
///////////////////////////////////////////////////////////////////////////////
#include "pch.h"
#include "VBimPickBBoxDrawable.h"
#include "Gi/GiWorldDraw.h"
#include "Gi/GiViewportDraw.h"
#include "Gi/GiViewport.h"
#include "Gi/Gi.h"
#include "Ge/GeVector2d.h"

VBimPickBBoxDrawable::VBimPickBBoxDrawable()
    : m_bbox()
    , m_visible(false)
    , m_isFace(false)
{
}

void VBimPickBBoxDrawable::showBBox(
    const OdGeExtents3d& bbox,
    const OdGeVector3d& liftVector,
    double liftDistance,
    double zPlane,
    bool is2d)
{
    m_bbox         = bbox;
    m_edges.clear();
    m_polygon.clear();
    m_liftVector   = liftVector;
    m_liftDistance = liftDistance;
    m_zPlane       = zPlane;
    m_is2d         = is2d;
    m_isFace       = false;
    m_visible      = bbox.isValidExtents();
}

void VBimPickBBoxDrawable::showFace(
    const OdGeExtents3d& bbox,
    const std::vector<std::pair<OdGePoint3d, OdGePoint3d>>& edges,
    const std::vector<OdGePoint3d>& polygon,
    const OdGeVector3d& liftVector,
    double liftDistance)
{
    m_bbox         = bbox;
    m_edges        = edges;
    m_polygon      = polygon;
    m_liftVector   = liftVector;
    m_liftDistance = liftDistance;
    m_zPlane       = 0.0;
    m_is2d         = false;
    m_isFace       = true;
    m_visible      = bbox.isValidExtents() || !m_edges.empty() || !m_polygon.empty();
}

void VBimPickBBoxDrawable::showEdge(
    const std::vector<std::pair<OdGePoint3d, OdGePoint3d>>& edges,
    const OdGeVector3d& liftVector,
    double liftDistance,
    double worldPerPx)
{
    m_bbox         = OdGeExtents3d();
    m_edges        = edges;
    m_polygon.clear();
    m_liftVector   = liftVector;
    m_liftDistance = liftDistance;
    m_worldPerPx   = worldPerPx;
    m_zPlane       = 0.0;
    m_is2d         = false;
    m_isFace       = false;
    m_visible      = !m_edges.empty();
}

void VBimPickBBoxDrawable::clearBBox()
{
    m_visible    = false;
    m_isFace     = false;
    m_is2d       = false;
    m_worldPerPx = 0.0;
    m_edges.clear();
    m_polygon.clear();
}

OdUInt32 VBimPickBBoxDrawable::subSetAttributes(OdGiDrawableTraits* pTraits) const
{
    if (!m_visible)
        return kDrawableIsInvisible;

    OdGiSubEntityTraitsPtr traitsEx = OdGiSubEntityTraits::cast(pTraits);
    if (!traitsEx.get())
        return kDrawableNone;

    // High-visibility cyan color (RGB 0, 220, 220) matching reference preview
    traitsEx->setTrueColor(OdCmEntityColor(0, 220, 220));
    traitsEx->setMaterial(nullptr);
    traitsEx->setLineWeight(OdDb::kLnWt040);
    traitsEx->setFillType((m_isFace || !m_edges.empty()) ? kOdGiFillAlways : kOdGiFillNever);
    return kDrawableRegenDraw;
}

bool VBimPickBBoxDrawable::subWorldDraw(OdGiWorldDraw* pWd) const
{
    if (!m_visible || !pWd)
        return true;

    // -------------------------------------------------------------------------
    // FACE HIGHLIGHT: Translucent Cyan Surface Fill + Bold Contour
    // -------------------------------------------------------------------------
    if (m_isFace)
    {
        // Compute dominant-plane quad fallback from bbox if needed
        OdGePoint3d fallbackQuad[4];
        bool hasFallbackQuad = false;
        OdGeVector3d quadNormal(0.0, 0.0, 1.0);

        if (m_bbox.isValidExtents())
        {
            const OdGePoint3d& mn = m_bbox.minPoint();
            const OdGePoint3d& mx = m_bbox.maxPoint();
            const double dx = mx.x - mn.x;
            const double dy = mx.y - mn.y;
            const double dz = mx.z - mn.z;

            if (dx <= dy && dx <= dz)
            {
                // Normal along X axis
                const double midX = (mn.x + mx.x) * 0.5;
                fallbackQuad[0] = OdGePoint3d(midX, mn.y, mn.z);
                fallbackQuad[1] = OdGePoint3d(midX, mx.y, mn.z);
                fallbackQuad[2] = OdGePoint3d(midX, mx.y, mx.z);
                fallbackQuad[3] = OdGePoint3d(midX, mn.y, mx.z);
                quadNormal = OdGeVector3d(1.0, 0.0, 0.0);
            }
            else if (dy <= dx && dy <= dz)
            {
                // Normal along Y axis
                const double midY = (mn.y + mx.y) * 0.5;
                fallbackQuad[0] = OdGePoint3d(mn.x, midY, mn.z);
                fallbackQuad[1] = OdGePoint3d(mx.x, midY, mn.z);
                fallbackQuad[2] = OdGePoint3d(mx.x, midY, mx.z);
                fallbackQuad[3] = OdGePoint3d(mn.x, midY, mx.z);
                quadNormal = OdGeVector3d(0.0, 1.0, 0.0);
            }
            else
            {
                // Normal along Z axis
                const double midZ = (mn.z + mx.z) * 0.5;
                fallbackQuad[0] = OdGePoint3d(mn.x, mn.y, midZ);
                fallbackQuad[1] = OdGePoint3d(mx.x, mn.y, midZ);
                fallbackQuad[2] = OdGePoint3d(mx.x, mx.y, midZ);
                fallbackQuad[3] = OdGePoint3d(mn.x, mx.y, midZ);
                quadNormal = OdGeVector3d(0.0, 0.0, 1.0);
            }
            hasFallbackQuad = true;
        }

        // Calculate anti-Z-fighting lift offset (lift off wall face towards viewer)
        OdGeVector3d eyeLift = m_liftVector;
        if (eyeLift.isZeroLength())
            eyeLift = OdGeVector3d(0.0, 0.0, 1.0);
        else
            eyeLift.normalize();

        const double dist = (m_liftDistance > 1e-8) ? m_liftDistance : 0.0005;

        OdGeVector3d faceNormal = quadNormal;
        if (m_polygon.size() >= 3)
        {
            OdGeVector3d n = (m_polygon[1] - m_polygon[0]).crossProduct(m_polygon[2] - m_polygon[0]);
            if (!n.isZeroLength())
            {
                n.normalize();
                faceNormal = n;
            }
        }
        if (faceNormal.dotProduct(eyeLift) < 0.0)
            faceNormal = -faceNormal;

        // Combined lift: 70% normal to face + 30% eye direction towards camera
        OdGeVector3d liftDir = faceNormal * 0.7 + eyeLift * 0.3;
        if (!liftDir.isZeroLength())
            liftDir.normalize();
        else
            liftDir = eyeLift;

        const OdGeVector3d offset = liftDir * dist;

        // Build lifted polygon
        std::vector<OdGePoint3d> liftedPoly;
        if (m_polygon.size() >= 3)
        {
            liftedPoly.reserve(m_polygon.size());
            for (const auto& pt : m_polygon)
            {
                liftedPoly.push_back(pt + offset);
            }
        }

        OdGePoint3d liftedQuad[4];
        if (hasFallbackQuad)
        {
            for (int q = 0; q < 4; ++q)
                liftedQuad[q] = fallbackQuad[q] + offset;
        }

        // PASS 1: Translucent Cyan Surface Fill (~53% alpha / 135)
        pWd->subEntityTraits().setColor(4);
        pWd->subEntityTraits().setFillType(kOdGiFillAlways);
        pWd->subEntityTraits().setTransparency(OdCmTransparency(static_cast<OdUInt8>(135)));
        pWd->subEntityTraits().setDrawFlags(
            OdGiSubEntityTraits::kDrawBackfaces |
            OdGiSubEntityTraits::kDrawSolidFill |
            OdGiSubEntityTraits::kDrawPolygonFill |
            OdGiSubEntityTraits::kDrawNoLineWeight);

        if (!liftedPoly.empty())
        {
            pWd->geometry().polygon(static_cast<OdInt32>(liftedPoly.size()), liftedPoly.data());
        }
        else if (hasFallbackQuad)
        {
            pWd->geometry().polygon(4, liftedQuad);
        }

        // PASS 2: Crisp Bold Contour (Fully Opaque, 0.40mm line weight)
        pWd->subEntityTraits().setColor(4);
        pWd->subEntityTraits().setFillType(kOdGiFillNever);
        pWd->subEntityTraits().setTransparency(OdCmTransparency(static_cast<OdUInt8>(255)));
        pWd->subEntityTraits().setLineWeight(OdDb::kLnWt040);
        pWd->subEntityTraits().setDrawFlags(0);

        if (!m_edges.empty())
        {
            for (const auto& edge : m_edges)
            {
                const OdGePoint3d seg[2] = { edge.first + offset, edge.second + offset };
                pWd->geometry().polyline(2, seg);
            }
        }
        else if (!liftedPoly.empty())
        {
            std::vector<OdGePoint3d> loop = liftedPoly;
            loop.push_back(liftedPoly[0]);
            pWd->geometry().polyline(static_cast<OdInt32>(loop.size()), loop.data());
        }
        else if (hasFallbackQuad)
        {
            const OdGePoint3d loop[5] = {
                liftedQuad[0], liftedQuad[1], liftedQuad[2], liftedQuad[3], liftedQuad[0]
            };
            pWd->geometry().polyline(5, loop);
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // EDGE HIGHLIGHT: Dual-layer visual pipeline (solid core ribbon + segment-aligned halo)
    // -------------------------------------------------------------------------
    if (!m_edges.empty())
    {
        const bool havePx = (m_worldPerPx > 1e-9);
        const double kCurveHalf = havePx ? (m_worldPerPx * 1.5) : 0.04;
        const double kSegHaloPad = havePx ? (m_worldPerPx * 5.0) : 0.6;

        OdGeVector3d lift = m_liftVector;
        if (lift.isZeroLength())
            lift = OdGeVector3d(0.0, 0.0, 1.0);
        else
            lift.normalize();

        const double dist = (m_liftDistance > 1e-8) ? m_liftDistance : (havePx ? (m_worldPerPx * 1.5) : 0.0005);
        const OdGeVector3d offset = lift * dist;

        auto drawStrip = [&](const OdGePoint3d& a, const OdGePoint3d& b, double halfStrip)
        {
            OdGeVector3d seg = b - a;
            if (seg.isZeroLength())
                return;

            // perp must lie in the view plane facing camera: seg x lift
            OdGeVector3d perp = seg.crossProduct(lift);
            if (perp.isZeroLength())
            {
                perp = OdGeVector3d(-seg.y, seg.x, 0.0);
                if (perp.isZeroLength())
                    perp = OdGeVector3d::kYAxis;
            }
            perp.normalize();
            perp *= halfStrip;

            const OdGePoint3d quad[4] = { a - perp, b - perp, b + perp, a + perp };
            pWd->subEntityTraits().setTrueColor(OdCmEntityColor(0, 220, 220));
            pWd->subEntityTraits().setFillType(kOdGiFillAlways);
            pWd->subEntityTraits().setTransparency(OdCmTransparency(static_cast<OdUInt8>(255)));
            pWd->subEntityTraits().setDrawFlags(
                OdGiSubEntityTraits::kDrawBackfaces |
                OdGiSubEntityTraits::kDrawSolidFill |
                OdGiSubEntityTraits::kDrawPolygonFill |
                OdGiSubEntityTraits::kDrawNoLineWeight);
            pWd->geometry().polygon(4, quad);
        };

        auto drawBBox = [&](const OdGePoint3d& segA, const OdGePoint3d& segB)
        {
            OdGeVector3d along = segB - segA;
            if (along.isZeroLength())
            {
                const double minX = segA.x - kSegHaloPad, maxX = segA.x + kSegHaloPad;
                const double minY = segA.y - kSegHaloPad, maxY = segA.y + kSegHaloPad;
                const OdGePoint3d rect[5] = {
                    OdGePoint3d(minX, minY, segA.z),
                    OdGePoint3d(maxX, minY, segA.z),
                    OdGePoint3d(maxX, maxY, segA.z),
                    OdGePoint3d(minX, maxY, segA.z),
                    OdGePoint3d(minX, minY, segA.z)
                };
                pWd->subEntityTraits().setTrueColor(OdCmEntityColor(0, 220, 220));
                pWd->subEntityTraits().setFillType(kOdGiFillNever);
                pWd->subEntityTraits().setTransparency(OdCmTransparency(static_cast<OdUInt8>(255)));
                pWd->subEntityTraits().setLineWeight(OdDb::kLnWt040);
                pWd->subEntityTraits().setDrawFlags(0);
                pWd->geometry().polyline(5, rect);
                return;
            }
            along.normalize();

            OdGeVector3d perp = along.crossProduct(lift);
            if (perp.isZeroLength())
                perp = OdGeVector3d(-along.y, along.x, 0.0);
            if (perp.isZeroLength())
                perp = OdGeVector3d::kYAxis;
            perp.normalize();

            const OdGeVector3d ext   = along * kSegHaloPad;
            const OdGeVector3d width = perp  * kSegHaloPad;
            const OdGePoint3d a = segA - ext;
            const OdGePoint3d b = segB + ext;

            const OdGePoint3d rect[5] = {
                a - width,
                b - width,
                b + width,
                a + width,
                a - width
            };

            pWd->subEntityTraits().setTrueColor(OdCmEntityColor(0, 220, 220));
            pWd->subEntityTraits().setFillType(kOdGiFillNever);
            pWd->subEntityTraits().setTransparency(OdCmTransparency(static_cast<OdUInt8>(255)));
            pWd->subEntityTraits().setLineWeight(OdDb::kLnWt040);
            pWd->subEntityTraits().setDrawFlags(0);
            pWd->geometry().polyline(5, rect);
        };

        constexpr size_t kMaxRenderEdges = 128;
        const size_t numEdgesToDraw = std::min(m_edges.size(), kMaxRenderEdges);
        for (size_t eIdx = 0; eIdx < numEdgesToDraw; ++eIdx)
        {
            const auto& edge = m_edges[eIdx];
            const OdGePoint3d p0 = edge.first + offset;
            const OdGePoint3d p1 = edge.second + offset;

            // Pass 1: Solid center ribbon quad (half-width ~1.5px, total ~3px width)
            drawStrip(p0, p1, kCurveHalf);

            // Pass 2: Rotated segment-aligned bounding box halo (padding ~5px)
            drawBBox(p0, p1);

            // Pass 3: Crisp center polyline for maximum contrast
            pWd->subEntityTraits().setTrueColor(OdCmEntityColor(0, 220, 220));
            pWd->subEntityTraits().setFillType(kOdGiFillNever);
            pWd->subEntityTraits().setTransparency(OdCmTransparency(static_cast<OdUInt8>(255)));
            pWd->subEntityTraits().setLineWeight(OdDb::kLnWt040);
            pWd->subEntityTraits().setDrawFlags(0);
            const OdGePoint3d centerSeg[2] = { p0, p1 };
            pWd->geometry().polyline(2, centerSeg);
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // ELEMENT WIREFRAME (2D Bounding Loop or 3D Axis-Aligned Bounding Box Wireframe)
    // -------------------------------------------------------------------------
    if (!m_bbox.isValidExtents())
        return true;

    pWd->subEntityTraits().setColor(4);
    pWd->subEntityTraits().setFillType(kOdGiFillNever);
    pWd->subEntityTraits().setTransparency(OdCmTransparency(static_cast<OdUInt8>(255)));
    pWd->subEntityTraits().setLineWeight(OdDb::kLnWt040);
    pWd->subEntityTraits().setDrawFlags(0);

    OdGeVector3d lift = m_liftVector;
    if (lift.isZeroLength())
        lift = OdGeVector3d(0, 0, 1);
    else
        lift.normalize();
    const OdGeVector3d offset = lift * ((m_liftDistance > 1e-8) ? m_liftDistance : 0.0005);

    const OdGePoint3d& mn = m_bbox.minPoint();
    const OdGePoint3d& mx = m_bbox.maxPoint();

    if (m_is2d)
    {
        const double z = m_zPlane;
        const OdGePoint3d loop[5] = {
            OdGePoint3d(mn.x, mn.y, z) + offset,
            OdGePoint3d(mx.x, mn.y, z) + offset,
            OdGePoint3d(mx.x, mx.y, z) + offset,
            OdGePoint3d(mn.x, mx.y, z) + offset,
            OdGePoint3d(mn.x, mn.y, z) + offset
        };
        pWd->geometry().polyline(5, loop);
        return true;
    }

    // 8 vertices of the 3D bounding box with lift offset
    const OdGePoint3d pts[8] = {
        OdGePoint3d(mn.x, mn.y, mn.z) + offset,  // 0: min corner
        OdGePoint3d(mx.x, mn.y, mn.z) + offset,  // 1
        OdGePoint3d(mx.x, mx.y, mn.z) + offset,  // 2
        OdGePoint3d(mn.x, mx.y, mn.z) + offset,  // 3
        OdGePoint3d(mn.x, mn.y, mx.z) + offset,  // 4
        OdGePoint3d(mx.x, mn.y, mx.z) + offset,  // 5
        OdGePoint3d(mx.x, mx.y, mx.z) + offset,  // 6: max corner
        OdGePoint3d(mn.x, mx.y, mx.z) + offset   // 7
    };

    // Bottom loop: 0 -> 1 -> 2 -> 3 -> 0
    const OdGePoint3d bottomLoop[5] = { pts[0], pts[1], pts[2], pts[3], pts[0] };
    pWd->geometry().polyline(5, bottomLoop);

    // Top loop: 4 -> 5 -> 6 -> 7 -> 4
    const OdGePoint3d topLoop[5] = { pts[4], pts[5], pts[6], pts[7], pts[4] };
    pWd->geometry().polyline(5, topLoop);

    // 4 vertical connecting pillars
    const OdGePoint3d pillar0[2] = { pts[0], pts[4] };
    const OdGePoint3d pillar1[2] = { pts[1], pts[5] };
    const OdGePoint3d pillar2[2] = { pts[2], pts[6] };
    const OdGePoint3d pillar3[2] = { pts[3], pts[7] };

    pWd->geometry().polyline(2, pillar0);
    pWd->geometry().polyline(2, pillar1);
    pWd->geometry().polyline(2, pillar2);
    pWd->geometry().polyline(2, pillar3);

    return true;
}

void VBimPickBBoxDrawable::subViewportDraw(OdGiViewportDraw* /*pVd*/) const
{
}

