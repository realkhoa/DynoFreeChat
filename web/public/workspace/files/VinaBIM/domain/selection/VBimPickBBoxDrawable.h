///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Selection Engine
// VBimPickBBoxDrawable.h — 3D Bounding Box transient preview drawable.
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "Gi/GiDrawableImpl.h"
#include "Ge/GeExtents3d.h"
#include "CmColorBase.h"
#include <vector>
#include <utility>

/**
 * @class VBimPickBBoxDrawable
 * @brief OdGi transient drawable that renders a 3D wireframe bounding box or
 * face contour wireframe around the currently hovered element or B-Rep subentity.
 */
class VBimPickBBoxDrawable : public OdGiDrawableImpl<>
{
public:
    VBimPickBBoxDrawable();
    ~VBimPickBBoxDrawable() override = default;

    /**
     * @brief Updates the bounding box extents and marks the drawable visible.
     */
    void showBBox(
        const OdGeExtents3d& bbox,
        const OdGeVector3d& liftVector = OdGeVector3d::kZAxis,
        double liftDistance = 0.0005,
        double zPlane = 0.0,
        bool is2d = false);

    /**
     * @brief Updates the drawable with face geometry: tight extents, boundary edges, and boundary polygon.
     */
    void showFace(
        const OdGeExtents3d& bbox,
        const std::vector<std::pair<OdGePoint3d, OdGePoint3d>>& edges,
        const std::vector<OdGePoint3d>& polygon = {},
        const OdGeVector3d& liftVector = OdGeVector3d::kZAxis,
        double liftDistance = 0.0005);

    /**
     * @brief Updates the drawable with edge geometry: renders a bold cyan ribbon core with segment-aligned bounding box halo.
     * @param edges Vector of segment endpoint pairs representing the candidate edges.
     * @param liftVector View normal lift vector towards camera to avoid z-fighting.
     * @param liftDistance Magnitude of lift displacement.
     * @param worldPerPx World units per device pixel for resolution-independent halo and ribbon widths.
     */
    void showEdge(
        const std::vector<std::pair<OdGePoint3d, OdGePoint3d>>& edges,
        const OdGeVector3d& liftVector = OdGeVector3d::kZAxis,
        double liftDistance = 0.0005,
        double worldPerPx = 0.0);

    /**
     * @brief Sets the world units per device pixel scale for resolution-independent highlights.
     * @param worldPerPx World units per device pixel.
     */
    void setPixelScale(double worldPerPx) noexcept { m_worldPerPx = worldPerPx; }

    /**
     * @brief Hides the bounding box and clears edges/polygon without detaching from the view.
     */
    void clearBBox();

    /**
     * @brief Returns true if the bounding box or face contour is currently visible.
     */
    bool isVisible() const noexcept { return m_visible; }

    /**
     * @brief Returns true if the current display is a face highlight.
     */
    bool isFace() const noexcept { return m_isFace; }

    /**
     * @brief Returns the current bounding box extents.
     */
    const OdGeExtents3d& extents() const noexcept { return m_bbox; }

    /**
     * @brief Sets Gi traits for rendering the 3D bounding box / face wireframe.
     */
    OdUInt32 subSetAttributes(OdGiDrawableTraits* pTraits) const override;

    /**
     * @brief Generates the 3D wireframe box polyline segments in world coordinates.
     */
    bool     subWorldDraw(OdGiWorldDraw* pWd)              const override;

    /**
     * @brief Viewport-specific draw pass (no-op for bounding box).
     */
    void     subViewportDraw(OdGiViewportDraw* pVd)        const override;

private:
    OdGeExtents3d m_bbox;
    std::vector<std::pair<OdGePoint3d, OdGePoint3d>> m_edges;
    std::vector<OdGePoint3d> m_polygon;
    OdGeVector3d  m_liftVector   = OdGeVector3d::kZAxis;
    double        m_liftDistance = 0.0005;
    double        m_worldPerPx   = 0.0;
    double        m_zPlane       = 0.0;
    bool          m_visible      = false;
    bool          m_isFace       = false;
    bool          m_is2d         = false;
};
