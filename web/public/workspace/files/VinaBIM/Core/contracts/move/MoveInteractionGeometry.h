///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Core contract
///////////////////////////////////////////////////////////////////////////////
//
// MoveInteractionGeometry.h — Engine-neutral geometry for the Revit-style Move
// command: the dashed footprint ghost, the move vector with its listening
// dimension (distance + angle), axis tracking, and typed-distance input.
//
// Pure functions on SnapPoint (no ODA, no MFC): the Host only projects the
// results to eye space and draws them. Elements move in the XY plane and are
// only ever rotated by multiples of 90 degrees, so an element's footprint is
// the XY rectangle of its axis-aligned world bounds.
///////////////////////////////////////////////////////////////////////////////
#pragma once
#include "Core/contracts/snap/ISnapService.h"  // reuse SnapPoint
#include <cmath>
#include <vector>

/** @brief Plan outline of one moved element: an XY rectangle at the bounds' minimum Z. */
struct MoveFootprint
{
    SnapPoint corners[4]; // Counter-clockwise from (min.x, min.y).
    bool      valid = false;
};

/** @brief The move vector from the start point to the current end point, measured in XY. */
struct MoveVector
{
    bool   valid    = false;
    double distance = 0.0;  // XY length in model units.
    double angleRad = 0.0;  // Angle to the X axis line, in [0, pi] (90 degrees along Y).
    double dirX = 0.0, dirY = 0.0;   // Unit direction start -> end.
    double perpX = 0.0, perpY = 0.0; // Left-hand unit normal of dir.
    double textDirX = 0.0, textDirY = 0.0; // dir, flipped so the label never reads upside down.
};

/**
 * @brief Builds the footprint rectangle of an element's world bounds.
 * @param boxMin Minimum corner of the world bounds.
 * @param boxMax Maximum corner of the world bounds.
 * @return Four corners at boxMin.z; valid == false for non-finite or inverted bounds.
 * @note Pure: no database or UI access.
 */
inline MoveFootprint computeFootprint(const SnapPoint& boxMin, const SnapPoint& boxMax)
{
    MoveFootprint fp;
    const double v[6] = {boxMin.x, boxMin.y, boxMin.z, boxMax.x, boxMax.y, boxMax.z};
    for (double d : v)
        if (!std::isfinite(d))
            return fp;
    if (boxMin.x > boxMax.x || boxMin.y > boxMax.y || boxMin.z > boxMax.z)
        return fp;
    fp.corners[0] = {boxMin.x, boxMin.y, boxMin.z};
    fp.corners[1] = {boxMax.x, boxMin.y, boxMin.z};
    fp.corners[2] = {boxMax.x, boxMax.y, boxMin.z};
    fp.corners[3] = {boxMin.x, boxMax.y, boxMin.z};
    fp.valid = true;
    return fp;
}

/**
 * @brief Splits the segment p0-p1 into dashes, appended as point pairs.
 * @param p0 Segment start.
 * @param p1 Segment end.
 * @param dash Dash length (> 0), in the same units as the points.
 * @param gap Gap length (>= 0) between dashes.
 * @param out Receives 2 points per dash; the last dash is clipped at p1.
 * @note Appends nothing for a degenerate segment or invalid lengths. Pure.
 */
inline void appendDashedSegments(const SnapPoint& p0, const SnapPoint& p1,
                                 double dash, double gap, std::vector<SnapPoint>& out)
{
    const double dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const double length = std::sqrt(dx*dx + dy*dy + dz*dz);
    if (!std::isfinite(length) || length <= 0.0 || !std::isfinite(dash) || dash <= 0.0 ||
        !std::isfinite(gap) || gap < 0.0)
        return;
    const double ux = dx / length, uy = dy / length, uz = dz / length;
    for (double s = 0.0; s < length; s += dash + gap)
    {
        const double e = (s + dash < length) ? s + dash : length;
        out.push_back({p0.x + ux*s, p0.y + uy*s, p0.z + uz*s});
        out.push_back({p0.x + ux*e, p0.y + uy*e, p0.z + uz*e});
    }
}

/**
 * @brief Measures the move vector between two points in the XY plane.
 * @param start Move start point.
 * @param end Current end point.
 * @return valid == false when the XY length is zero or not finite.
 * @note Pure.
 */
inline MoveVector measureMoveVector(const SnapPoint& start, const SnapPoint& end)
{
    MoveVector v;
    const double dx = end.x - start.x, dy = end.y - start.y;
    const double length = std::hypot(dx, dy);
    if (!std::isfinite(length) || length <= 1e-12)
        return v;
    v.valid    = true;
    v.distance = length;
    v.dirX     = dx / length;
    v.dirY     = dy / length;
    v.perpX    = -v.dirY;
    v.perpY    = v.dirX;
    v.angleRad = std::atan2(std::abs(v.dirY), v.dirX);
    v.textDirX = v.dirX;
    v.textDirY = v.dirY;
    if (v.textDirX < -1e-9 || (std::abs(v.textDirX) <= 1e-9 && v.textDirY < 0.0))
    {
        v.textDirX = -v.textDirX;
        v.textDirY = -v.textDirY;
    }
    return v;
}

/**
 * @brief Applies axis tracking to the cursor point relative to the start point.
 * @param start Move start point.
 * @param cursor Cursor point (already object-snapped when pointSnapped).
 * @param toleranceRad Soft tracking tolerance to the nearest X/Y axis.
 * @param locked True while Constrain is held: always project onto the nearest axis.
 * @param pointSnapped True when an object snap produced the cursor point.
 * @return The cursor projected onto the nearest axis through start, or cursor unchanged.
 * @note An object snap wins over soft tracking but not over Constrain. Z is kept. Pure.
 */
inline SnapPoint constrainToAxes(const SnapPoint& start, const SnapPoint& cursor,
                                 double toleranceRad, bool locked, bool pointSnapped)
{
    const double dx = cursor.x - start.x, dy = cursor.y - start.y;
    if (!std::isfinite(dx) || !std::isfinite(dy) || std::hypot(dx, dy) <= 1e-12)
        return cursor;
    if (!locked && pointSnapped)
        return cursor;
    const bool alongX = std::abs(dx) >= std::abs(dy);
    const double off = std::atan2(alongX ? std::abs(dy) : std::abs(dx),
                                  alongX ? std::abs(dx) : std::abs(dy));
    if (!locked && off > toleranceRad)
        return cursor;
    return alongX ? SnapPoint{cursor.x, start.y, cursor.z} : SnapPoint{start.x, cursor.y, cursor.z};
}

/**
 * @brief Computes the end point for a typed move distance along the current direction.
 * @param start Move start point.
 * @param lastEnd Last tracked end point; start -> lastEnd gives the direction (XY).
 * @param distance Typed distance in model units; must be finite and > 0.
 * @param out Receives start + direction * distance (Z of start).
 * @return False when the direction is zero or the distance is not a positive finite number.
 * @note Pure.
 */
inline bool applyTypedDistance(const SnapPoint& start, const SnapPoint& lastEnd,
                               double distance, SnapPoint& out)
{
    if (!std::isfinite(distance) || distance <= 0.0)
        return false;
    const MoveVector v = measureMoveVector(start, lastEnd);
    if (!v.valid)
        return false;
    out = {start.x + v.dirX * distance, start.y + v.dirY * distance, start.z};
    return true;
}

/**
 * @brief Appends the points of a circular arc in the XY plane as a polyline.
 * @param center Arc centre (its Z is used for every point).
 * @param radius Arc radius (> 0).
 * @param fromRad Start angle from +X, counter-clockwise.
 * @param toRad End angle; the arc sweeps from fromRad to toRad in either direction.
 * @param maxStepRad Maximum angular step between points (> 0).
 * @param out Receives at least 2 points, first at fromRad and last at toRad.
 * @note Appends nothing for invalid input. Pure.
 */
inline void appendAngleArc(const SnapPoint& center, double radius, double fromRad, double toRad,
                           double maxStepRad, std::vector<SnapPoint>& out)
{
    if (!std::isfinite(radius) || radius <= 0.0 || !std::isfinite(fromRad) ||
        !std::isfinite(toRad) || !std::isfinite(maxStepRad) || maxStepRad <= 0.0)
        return;
    const double sweep = toRad - fromRad;
    int steps = static_cast<int>(std::ceil(std::abs(sweep) / maxStepRad));
    if (steps < 1)
        steps = 1;
    for (int i = 0; i <= steps; ++i)
    {
        const double a = fromRad + sweep * static_cast<double>(i) / static_cast<double>(steps);
        out.push_back({center.x + radius * std::cos(a), center.y + radius * std::sin(a), center.z});
    }
}
