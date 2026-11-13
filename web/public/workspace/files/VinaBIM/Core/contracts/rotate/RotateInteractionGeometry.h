///////////////////////////////////////////////////////////////////////////////
// VinaBIM - Core contract
///////////////////////////////////////////////////////////////////////////////
//
// RotateInteractionGeometry.h - Engine-neutral geometry for the Revit-style
// Rotate command: center of rotation, start ray, current ray, listening
// dimension (angle arc + angle text), and typed-angle input.
//
// Pure functions on SnapPoint (no ODA, no MFC): the Host only projects the
// results to eye space and draws them. Elements rotate in the XY plane
// around a user-defined or centroid-derived center point.
///////////////////////////////////////////////////////////////////////////////
#pragma once
#include "Core/contracts/snap/ISnapService.h" // reuse SnapPoint
#include "Core/contracts/move/MoveInteractionGeometry.h" // reuse appendAngleArc
#include <cmath>
#include <vector>

/**
 * @brief State of a rotate interaction in model coordinates (XY plane).
 */
struct RotateInteractionState
{
    SnapPoint center;         /**< Center of rotation in world coordinates. */
    SnapPoint startRay;       /**< First reference point clicked by user (start ray). */
    SnapPoint currentRay;     /**< Current cursor position or end ray point. */
    double    radius = 0.0;   /**< Radius of rotation arc: ||startRay - center||. */
    double    angleRad = 0.0; /**< Signed rotation angle in radians [-pi, pi]. */
    bool      valid = false;  /**< True when center and rays define a non-zero radius. */
};

/**
 * @brief Measures the signed rotation angle and radius between startRay and currentRay around center.
 * @param center Center of rotation in world coordinates.
 * @param startRay Baseline point defining the start vector.
 * @param currentRay Target point defining the current direction.
 * @param[out] outRadius Receives the distance ||startRay - center||.
 * @param[out] outAngleRad Receives the signed angle in radians from startRay to currentRay.
 * @return True if center, startRay and currentRay are finite and have non-zero lengths.
 * @note Pure function: no ODA, no UI, thread-safe.
 */
inline bool measureRotateMetrics(
    const SnapPoint& center,
    const SnapPoint& startRay,
    const SnapPoint& currentRay,
    double& outRadius,
    double& outAngleRad)
{
    const double bdx = startRay.x - center.x;
    const double bdy = startRay.y - center.y;
    const double bLen = std::hypot(bdx, bdy);

    const double cdx = currentRay.x - center.x;
    const double cdy = currentRay.y - center.y;
    const double cLen = std::hypot(cdx, cdy);

    if (!std::isfinite(bLen) || bLen <= 1e-6 || !std::isfinite(cLen) || cLen <= 1e-6)
    {
        outRadius = 0.0;
        outAngleRad = 0.0;
        return false;
    }

    outRadius = bLen;

    const double startAngle = std::atan2(bdy, bdx);
    const double currAngle  = std::atan2(cdy, cdx);
    double diff = currAngle - startAngle;

    // Normalize to [-pi, pi]
    constexpr double kPi = 3.14159265358979323846;
    constexpr double kTwoPi = 2.0 * kPi;
    while (diff > kPi)  diff -= kTwoPi;
    while (diff < -kPi) diff += kTwoPi;

    outAngleRad = diff;
    return true;
}
