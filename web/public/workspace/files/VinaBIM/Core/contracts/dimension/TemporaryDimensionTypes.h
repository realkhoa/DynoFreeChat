///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Core contract
///////////////////////////////////////////////////////////////////////////////
//
// TemporaryDimensionTypes.h — Engine-neutral Temporary Dimension DTOs.
//
// Named after Revit's "Temporary Dimensions" (auto witness-line + distance
// readout shown while creating/dragging an element) — NOT Revit's separate,
// narrower "Listening Dimensions" (typed-value-while-sketching a line/arc).
// This feature was originally named "Listening Dimension" in this codebase;
// renamed 2026-09 after fact-checking against Autodesk Help confirmed the
// behavior matches Temporary Dimensions instead. See
// docs/research/software-behavior/temporary-dimension.md for the full
// comparison and correction history.
//
// All types here are plain C++ (no ODA, no MFC) so Application-layer
// UseCases and Infrastructure adapters share one stable ABI.
///////////////////////////////////////////////////////////////////////////////
#pragma once
#include "Core/contracts/snap/ISnapService.h"  // reuse SnapPoint
#include <cstdint>
#include <cmath>
#include <vector>

/**
 * @brief Priority-ordered reference type for a temporary witness line.
 *
 * Lower values have higher display priority. This pass supports grids,
 * curve-element centerlines, and bounding-box surface fallbacks.
 */
enum class TemporaryDimensionReferenceKind : std::uint8_t
{
    None           = 0,
    Grid           = 1,
    Centerline     = 2,
    NearbyElement  = 3,
    ReferencePlane = 4, // Project reference plane; only produced by the frozen (body-drag) mode.
};

/** @brief Independent direction in the orthonormal placement plane. */
enum class TemporaryDimensionAxis : std::uint8_t { None, X, Y };

/** @brief One engine-neutral witness-line target near a placement origin. */
struct TemporaryDimensionReference
{
    SnapPoint                       referencePoint;                                // Nearest point on the reference, in WCS.
    TemporaryDimensionReferenceKind kind     = TemporaryDimensionReferenceKind::None;
    double                          distance = 0.0;                                // World-unit distance from origin to referencePoint.
    SnapPoint                       subjectPoint;
    TemporaryDimensionAxis          axis = TemporaryDimensionAxis::None;
    std::uint64_t                   sourceId = 0; // Stable within the owning DB/session.
    bool                            approximate = false; // Envelope, not a verified physical face.
    /** @brief Axis projection used for the measured span, never a physical hit. */
    SnapPoint                       measurementPoint;
    /** @brief True when referencePoint lies exactly on the reference line, so the
     *  reference-side witness line may start there instead of at measurementPoint. */
    bool                            anchorOnReferenceLine = false;
};

/** @brief Chooses at most one reference per placement axis, returned X then Y.
 * @param candidates Actual WCS reference anchors; copied, never projected in place.
 * @param origin WCS insertion anchor.
 * @param axisX Unit X direction of the placement plane.
 * @param axisY Unit Y direction, perpendicular to X.
 * @return Kind-priority then axis-distance winners, with source ID breaking ties.
 * @note Pure value computation. Rejects invalid frames, off-plane/zero distances
 * and deltas more than 15 degrees from either axis. No DB or UI access.
 */
inline std::vector<TemporaryDimensionReference> selectTemporaryDimensionAxes(
    const std::vector<TemporaryDimensionReference>& candidates, const SnapPoint& origin,
    const SnapPoint& axisX, const SnapPoint& axisY)
{
    const auto dot = [](const SnapPoint& a, const SnapPoint& b) {
        return a.x*b.x + a.y*b.y + a.z*b.z;
    };
    const double xx = dot(axisX,axisX), yy = dot(axisY,axisY), xy = dot(axisX,axisY);
    if (!std::isfinite(xx) || !std::isfinite(yy) || !std::isfinite(xy) ||
        std::abs(xx-1) > 1e-6 || std::abs(yy-1) > 1e-6 || std::abs(xy) > 1e-6)
        return {};
    TemporaryDimensionReference winners[2];
    constexpr double tan15 = 0.2679491924311227;
    for (auto ref : candidates)
    {
        const SnapPoint delta{ref.referencePoint.x-origin.x,
            ref.referencePoint.y-origin.y,ref.referencePoint.z-origin.z};
        const double dx = dot(delta,axisX), dy = dot(delta,axisY);
        const double rx = delta.x - dx*axisX.x - dy*axisY.x;
        const double ry = delta.y - dx*axisX.y - dy*axisY.y;
        const double rz = delta.z - dx*axisX.z - dy*axisY.z;
        const double residual = std::hypot(std::hypot(rx, ry), rz);
        if (!std::isfinite(dx) || !std::isfinite(dy) || !std::isfinite(residual) ||
            residual > 1e-6 || ref.kind == TemporaryDimensionReferenceKind::None)
            continue;
        const double ax = std::abs(dx), ay = std::abs(dy);
        const int index = ax > 1e-9 && ay <= ax*tan15 ? 0
            : ay > 1e-9 && ax <= ay*tan15 ? 1 : -1;
        if (index < 0)
            continue;
        ref.subjectPoint = origin;
        ref.axis = index == 0 ? TemporaryDimensionAxis::X : TemporaryDimensionAxis::Y;
        ref.distance = index == 0 ? ax : ay;
        const SnapPoint& direction = index == 0 ? axisX : axisY;
        const double signedDistance = index == 0 ? dx : dy;
        ref.measurementPoint = {origin.x + direction.x * signedDistance,
            origin.y + direction.y * signedDistance, origin.z + direction.z * signedDistance};
        auto& best = winners[index];
        const bool better = best.axis == TemporaryDimensionAxis::None || ref.kind < best.kind ||
            (ref.kind == best.kind && (ref.distance < best.distance ||
                (ref.distance == best.distance && ref.sourceId < best.sourceId)));
        if (better)
            best = ref;
    }
    std::vector<TemporaryDimensionReference> result;
    for (const auto& best : winners)
        if (best.axis != TemporaryDimensionAxis::None)
            result.push_back(best);
    return result;
}

// ---------------------------------------------------------------------------
// "Frozen" mode for the selection body-drag (Revit parity, temporary-dimension.md §6):
// references are chosen once at drag start and kept for the whole drag, and the
// dragged side is measured from the faces of the ghost's world bounds. Objects are
// only rotated by multiples of 90 degrees, so every usable reference is a line
// parallel to world X or Y.
// ---------------------------------------------------------------------------

/** @brief One world-axis-aligned reference line, captured by value at drag start. */
struct TemporaryDimensionReferenceLine
{
    /** @brief Axis this line constrains: X means the line x = coordinate, Y means y = coordinate. */
    TemporaryDimensionAxis          axis       = TemporaryDimensionAxis::None;
    double                          coordinate = 0.0;
    /** @brief Extent of the reference along the other axis, used to anchor its witness line. */
    double                          spanMin    = 0.0;
    double                          spanMax    = 0.0;
    TemporaryDimensionReferenceKind kind       = TemporaryDimensionReferenceKind::None;
    std::uint64_t                   sourceId   = 0; // Stable within the owning DB/session.
};

/** @brief Appends the four edges of an axis-aligned box as reference lines.
 * @param minimum WCS minimum corner.
 * @param maximum WCS maximum corner.
 * @param kind Reference kind recorded on every emitted line.
 * @param sourceId Owning element identity recorded on every emitted line.
 * @param out Receives two X lines (min/max x) then two Y lines (min/max y).
 * @note Pure value computation. Appends nothing for a non-finite or inverted box. For an
 *       axis-aligned wall the edges are its two faces and its two ends.
 */
inline void appendBoxReferenceLines(const SnapPoint& minimum, const SnapPoint& maximum,
    TemporaryDimensionReferenceKind kind, std::uint64_t sourceId,
    std::vector<TemporaryDimensionReferenceLine>& out)
{
    if (!std::isfinite(minimum.x) || !std::isfinite(minimum.y) ||
        !std::isfinite(maximum.x) || !std::isfinite(maximum.y) ||
        minimum.x > maximum.x || minimum.y > maximum.y)
        return;
    const auto line = [&](TemporaryDimensionAxis axis, double coordinate, double lo, double hi) {
        TemporaryDimensionReferenceLine l;
        l.axis = axis; l.coordinate = coordinate; l.spanMin = lo; l.spanMax = hi;
        l.kind = kind; l.sourceId = sourceId;
        out.push_back(l);
    };
    line(TemporaryDimensionAxis::X, minimum.x, minimum.y, maximum.y);
    line(TemporaryDimensionAxis::X, maximum.x, minimum.y, maximum.y);
    line(TemporaryDimensionAxis::Y, minimum.y, minimum.x, maximum.x);
    line(TemporaryDimensionAxis::Y, maximum.y, minimum.x, maximum.x);
}

namespace temporary_dimension_detail
{
    /** @brief Classifies a reference line against the box range [lo, hi] on its axis.
     * @return +1 beyond the max face, -1 beyond the min face, 0 when the line crosses
     *         or touches the box; distance is set to the face-to-line gap.
     */
    inline int faceSide(double coordinate, double lo, double hi, double& distance)
    {
        distance = 0.0;
        if (coordinate > hi) { distance = coordinate - hi; return 1; }
        if (coordinate < lo) { distance = lo - coordinate; return -1; }
        return 0;
    }

    inline bool isUsableBox(const SnapPoint& mn, const SnapPoint& mx)
    {
        return std::isfinite(mn.x) && std::isfinite(mn.y) && std::isfinite(mn.z) &&
               std::isfinite(mx.x) && std::isfinite(mx.y) && std::isfinite(mx.z) &&
               mn.x <= mx.x && mn.y <= mx.y;
    }
} // namespace temporary_dimension_detail

/** @brief Chooses, once at drag start, the nearest reference line per axis to a box.
 * @param lines Candidate lines from the view (see collectTemporaryDimensionReferenceLines()).
 * @param boxMin World minimum of the dragged object's bounds.
 * @param boxMax World maximum of the dragged object's bounds.
 * @return At most one line per axis, X then Y. Nearest by face-to-line distance; ties go
 *         to the higher-priority kind, then the lower source ID. No distance limit and no
 *         requirement that the line spans the object (Revit measures to a far wall end).
 * @note Pure value computation. Lines crossing the box, and non-finite input, are skipped.
 */
inline std::vector<TemporaryDimensionReferenceLine> selectFrozenTemporaryDimensionReferences(
    const std::vector<TemporaryDimensionReferenceLine>& lines,
    const SnapPoint& boxMin, const SnapPoint& boxMax)
{
    std::vector<TemporaryDimensionReferenceLine> result;
    if (!temporary_dimension_detail::isUsableBox(boxMin, boxMax))
        return result;

    TemporaryDimensionReferenceLine winners[2];
    double winnerDistance[2] = {0.0, 0.0};
    for (const TemporaryDimensionReferenceLine& line : lines)
    {
        if (line.axis == TemporaryDimensionAxis::None || !std::isfinite(line.coordinate) ||
            !std::isfinite(line.spanMin) || !std::isfinite(line.spanMax))
            continue;
        const bool alongX = line.axis == TemporaryDimensionAxis::X;
        double distance = 0.0;
        if (temporary_dimension_detail::faceSide(line.coordinate,
                alongX ? boxMin.x : boxMin.y, alongX ? boxMax.x : boxMax.y, distance) == 0)
            continue;
        const int index = alongX ? 0 : 1;
        TemporaryDimensionReferenceLine& best = winners[index];
        const bool better = best.axis == TemporaryDimensionAxis::None ||
            distance < winnerDistance[index] ||
            (distance == winnerDistance[index] && (line.kind < best.kind ||
                (line.kind == best.kind && line.sourceId < best.sourceId)));
        if (better)
        {
            best = line;
            winnerDistance[index] = distance;
        }
    }
    for (const TemporaryDimensionReferenceLine& best : winners)
        if (best.axis != TemporaryDimensionAxis::None)
            result.push_back(best);
    return result;
}

/** @brief Measures the frozen references against the dragged object's current bounds.
 * @param frozen Lines returned by selectFrozenTemporaryDimensionReferences(), X then Y.
 * @param boxMin Current world minimum of the dragged object's bounds.
 * @param boxMax Current world maximum of the dragged object's bounds.
 * @return One reference per line whose axis is still clear of the box, in input order.
 *         subjectPoint is the corner of the measured face on the side facing the other
 *         axis's reference (the + side when there is none), measurementPoint projects it onto
 *         the line, and referencePoint is the nearest point on the reference's own span.
 * @note Pure value computation, called every drag tick; never touches the database. The face
 *       switches when the object passes the line; a line inside the box yields no dimension.
 */
inline std::vector<TemporaryDimensionReference> measureFrozenTemporaryDimensions(
    const std::vector<TemporaryDimensionReferenceLine>& frozen,
    const SnapPoint& boxMin, const SnapPoint& boxMax)
{
    std::vector<TemporaryDimensionReference> result;
    if (!temporary_dimension_detail::isUsableBox(boxMin, boxMax))
        return result;

    for (const TemporaryDimensionReferenceLine& line : frozen)
    {
        if (line.axis == TemporaryDimensionAxis::None)
            continue;
        const bool alongX = line.axis == TemporaryDimensionAxis::X;
        double distance = 0.0;
        const int side = temporary_dimension_detail::faceSide(line.coordinate,
            alongX ? boxMin.x : boxMin.y, alongX ? boxMax.x : boxMax.y, distance);
        if (side == 0)
            continue;
        const double face = side > 0 ? (alongX ? boxMax.x : boxMax.y) : (alongX ? boxMin.x : boxMin.y);

        // Corner on the other axis: toward that axis's frozen reference, so the dimension
        // sits between the object and its references the way Revit places it.
        const double otherLo = alongX ? boxMin.y : boxMin.x;
        const double otherHi = alongX ? boxMax.y : boxMax.x;
        double corner = otherHi;
        for (const TemporaryDimensionReferenceLine& other : frozen)
        {
            if (other.axis == TemporaryDimensionAxis::None || other.axis == line.axis)
                continue;
            double ignored = 0.0;
            if (temporary_dimension_detail::faceSide(other.coordinate, otherLo, otherHi, ignored) < 0)
                corner = otherLo;
        }
        const double anchor = corner < line.spanMin ? line.spanMin
            : corner > line.spanMax ? line.spanMax : corner;

        const double z = boxMin.z;
        TemporaryDimensionReference ref;
        ref.axis = line.axis;
        ref.kind = line.kind;
        ref.sourceId = line.sourceId;
        ref.distance = distance;
        ref.approximate = line.kind == TemporaryDimensionReferenceKind::NearbyElement;
        ref.subjectPoint     = alongX ? SnapPoint{face, corner, z} : SnapPoint{corner, face, z};
        ref.measurementPoint = alongX ? SnapPoint{line.coordinate, corner, z}
                                      : SnapPoint{corner, line.coordinate, z};
        ref.referencePoint   = alongX ? SnapPoint{line.coordinate, anchor, z}
                                      : SnapPoint{anchor, line.coordinate, z};
        ref.anchorOnReferenceLine = true;
        result.push_back(ref);
    }
    return result;
}

// No abstract service interface here: there is exactly one caller
// (ViewSnapController) and one implementation
// (collectTemporaryDimensionReferences(), Infrastructure/Oda/dimension/), so
// a polymorphic contract would be an unused abstraction. These DTOs exist
// only to keep that call boundary engine-neutral, matching how
// BmSnapCandidateCollector.h exposes a plain free function rather than an
// ISnapCandidateCollector interface.
