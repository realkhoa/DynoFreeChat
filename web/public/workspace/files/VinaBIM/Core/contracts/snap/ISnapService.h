///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Core contract
///////////////////////////////////////////////////////////////////////////////
//
// ISnapService — Engine-neutral snap contract.
//
// All types in this interface are plain C++ (no ODA, no MFC) so that
// Application-layer UseCases and Infrastructure adapters share one stable ABI.
//
///////////////////////////////////////////////////////////////////////////////
#pragma once
#include <cstdint>

// SnapKind — geometric snap type returned by evaluate().
// Priority order (highest to lowest) is defined by snapKindHigherPriority()
// in BmSnapTypes.h: Endpoint > Midpoint > Grid > Perpendicular > Nearest.
enum class SnapKind : std::uint8_t
{
    None         = 0,
    Endpoint     = 1,
    Midpoint     = 2,
    Grid         = 3,  // Intersection of two grid axis lines.
    Perpendicular = 4, // Foot of perpendicular from cursor onto a curve element.
    Nearest      = 5,
};

// SnapMode — bitmask selecting which kinds are active.
enum class SnapMode : std::uint32_t
{
    Off           = 0,
    Endpoint      = 1 << 0,
    Midpoint      = 1 << 1,
    Nearest       = 1 << 2,
    Grid          = 1 << 3,
    Perpendicular = 1 << 4,
    All           = Endpoint | Midpoint | Nearest | Grid | Perpendicular,
};

inline SnapMode operator|(SnapMode a, SnapMode b)
{
    return static_cast<SnapMode>(static_cast<std::uint32_t>(a) |
                                  static_cast<std::uint32_t>(b));
}
inline SnapMode operator&(SnapMode a, SnapMode b)
{
    return static_cast<SnapMode>(static_cast<std::uint32_t>(a) &
                                  static_cast<std::uint32_t>(b));
}

// SnapPoint — engine-neutral 3-D point (no OdGePoint3d in Core).
struct SnapPoint
{
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

// SnapContext — describes the pick ray; engine-neutral.
struct SnapContext
{
    SnapPoint  cursorWorld;    // Cursor position projected to work plane (WCS).
    SnapPoint  viewDirection;  // Normalized view direction vector.
    double     radiusWorld;    // Snap search radius in world units.
    SnapMode   mode;           // Active snap types requested by the caller.
};

// SnapResult — output of ISnapService::evaluate().
struct SnapResult
{
    SnapPoint  snappedPoint;   // The adjusted point (== cursorWorld when kind==None).
    SnapKind   kind;           // Which snap type was applied.
    bool       snapped;        // true when kind != None.
};

// ISnapService — evaluates a cursor world point and returns the nearest snap.
//
// Implemented by BmSnapService (Infrastructure/Oda/snap/).
// Called from VinaBIMView during kGetPoint mode when isEnabled() is true.
//
// Thread safety: must be called from the UI/main thread (all ODA access).
class ISnapService
{
public:
    /** @brief Destroys the engine-neutral snap service through its interface. */
    virtual ~ISnapService() = default;

    /**
     * @brief Evaluates the nearest enabled snap point for the supplied context.
     * @param ctx Engine-neutral cursor, view direction, radius, and mode.
     * @return A non-snapped result at cursorWorld when no candidate is in range.
     */
    virtual SnapResult evaluate(const SnapContext& ctx) = 0;

    /** @brief Returns true when snap evaluation is globally enabled. */
    virtual bool isEnabled() const = 0;

    /** @brief Enables or disables snap evaluation for subsequent cursor samples. */
    virtual void setEnabled(bool enabled) = 0;

    /** @brief Returns the active engine-neutral snap mode bitmask. */
    virtual SnapMode activeMode() const = 0;

    /** @brief Replaces the active snap mode bitmask. */
    virtual void setActiveMode(SnapMode mode) = 0;
};
