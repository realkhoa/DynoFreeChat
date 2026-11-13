///////////////////////////////////////////////////////////////////////////////
// VinaBIM Native SDK — Public API
// Selection Types
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "../VinaBIMApiExport.h"
#include "Base/BmObjectId.h"
#include "Ge/GePoint3d.h"
#include "Ge/GeVector3d.h"
#include "Database/Entities/BmGeomRef.h"
#include "DbBaseSubentId.h"
#include "Gs/Gs.h"

#include <cstdint>
#include <vector>

// Opt-in interactive lifetime contract. Borrowed observers are detached before
// EndSession returns. Existing IVBimSelectionFilter vtables remain unchanged.
using VBimSelectionSessionToken = unsigned long long;
/**
 * @brief Observer interface for selection session lifecycle and keyboard cycling events.
 */
class IVBimSelectionSessionObserver
{
public:
    virtual ~IVBimSelectionSessionObserver() = default;

    /**
     * @brief Called once by Host when the session is invalidated while original view/device is still alive.
     * @note Plugins should detach previews and clean up transient state here; must not throw exceptions.
     */
    virtual void OnInvalidated() noexcept = 0;

    /**
     * @brief Handles Tab / Shift+Tab cycling requests during interactive selection.
     * @param backwards True if Shift+Tab (cycle backwards); false for forward cycling.
     * @return true if key was handled and reference cycled; false to delegate to default picker.
     * @note If an exception is thrown, Host catches it, invalidates the session, and treats key as handled.
     */
    virtual bool OnTab(bool backwards) = 0;
};

#if __has_include("Core/contracts/snap/ISnapService.h")
#include "Core/contracts/snap/ISnapService.h"
#else
// Plugin-build copies of the Core snap enums. Values must stay identical to
// Core/contracts/snap/ISnapService.h: the App fills VBimPickResult::snapKind
// with the Core values (for example Nearest = 5).
enum class SnapKind : std::uint8_t
{
    None          = 0,
    Endpoint      = 1,
    Midpoint      = 2,
    Grid          = 3,
    Perpendicular = 4,
    Nearest       = 5,
};

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

// Bitwise combine / test of SnapMode flags for plugin builds; mirrors the
// operators of Core/contracts/snap/ISnapService.h used inside the App build.
inline SnapMode operator|(SnapMode a, SnapMode b)
{
    return static_cast<SnapMode>(static_cast<std::uint32_t>(a) | static_cast<std::uint32_t>(b));
}

inline SnapMode operator&(SnapMode a, SnapMode b)
{
    return static_cast<SnapMode>(static_cast<std::uint32_t>(a) & static_cast<std::uint32_t>(b));
}
#endif

/**
 * @enum VBimObjectType
 * @brief Selection modes specifying what can be picked in an interactive pick operation.
 */
enum class VBimObjectType : std::uint8_t
{
    Nothing        = 0,  ///< Nothing.
    Element        = 1,  ///< Whole element.
    PointOnElement = 2,  ///< Any point on an element (vertex, face, or curve).
    Edge           = 3,  ///< Any model edge (B-Rep edge).
    Face           = 4,  ///< Any face (B-Rep planar/curved face).
    LinkedElement  = 5,  ///< Element inside a linked model / external reference.
    Subelement     = 6,  ///< Whole element or subelement.

    // Backward compatibility aliases for legacy code:
    Vertex         = PointOnElement,
    Xref           = LinkedElement
};

/**
 * @enum VBimObjectSnapTypes
 * @brief Bitmask specifying allowed geometric snap types during interactive pick operations.
 */
enum class VBimObjectSnapTypes : std::uint32_t
{
    None                   = 0,
    Endpoints              = 1 << 0,   ///< Snaps to endpoints of elements or curves.
    Midpoints              = 1 << 1,   ///< Snaps to midpoints of curves or edges.
    Nearest                = 1 << 2,   ///< Snaps to nearest point on edge or surface.
    WorkPlaneGrid          = 1 << 3,   ///< Snaps to work plane grid.
    Intersections          = 1 << 4,   ///< Snaps to intersections.
    Centers                = 1 << 5,   ///< Snaps to arc / circle centers.
    Perpendicular          = 1 << 6,   ///< Snaps perpendicular.
    Tangents               = 1 << 7,   ///< Snaps tangent.
    Quadrants              = 1 << 8,   ///< Snaps to quadrant points.
    Points                 = 1 << 9,   ///< Snaps to site or geometry points.
    Off                    = 0,
    All                    = Endpoints | Midpoints | Nearest
};

inline VBimObjectSnapTypes operator|(VBimObjectSnapTypes a, VBimObjectSnapTypes b)
{
    return static_cast<VBimObjectSnapTypes>(static_cast<std::uint32_t>(a) | static_cast<std::uint32_t>(b));
}

inline VBimObjectSnapTypes operator&(VBimObjectSnapTypes a, VBimObjectSnapTypes b)
{
    return static_cast<VBimObjectSnapTypes>(static_cast<std::uint32_t>(a) & static_cast<std::uint32_t>(b));
}

/**
 * @enum VBimPickBoxStyle
 * @brief Controls the style of interactive rectangle picking.
 */
enum class VBimPickBoxStyle : std::uint8_t
{
    Crossing       = 0,  ///< Crossing window selection (objects intersecting or inside the box).
    Enclosing      = 1,  ///< Enclosing window selection (objects completely inside the box).
    Directional    = 2,  ///< Direction-based selection (left-to-right window/enclosing, right-to-left crossing).

    // Backward compatibility alias:
    DirectionBased = Directional
};

/**
 * @struct VBimPickedBox
 * @brief 3D bounding box corners resulting from an interactive box pick operation.
 */
struct VBimPickedBox
{
    OdGePoint3d min = OdGePoint3d::kOrigin;  ///< Minimum corner point.
    OdGePoint3d max = OdGePoint3d::kOrigin;  ///< Maximum corner point.
    bool isValid = false;                    ///< True if box was successfully picked.
};

/**
 * @struct VBimReference
 * @brief Output container holding the complete result of an interactive Pick operation.
 */
struct VBimReference
{
    /**
     * @brief ID of the selected element in the host model.
     * When picking an Xref / LinkedElement, this receives the LinkInstance ID.
     */
    OdBmObjectId elementId;

    /**
     * @brief ID of the actual element inside the linked document (when objectType == LinkedElement).
     * Null when picking a host element.
     */
    OdBmObjectId linkedElementId;

    /**
     * @brief The object type requested or picked.
     */
    VBimObjectType objectType = VBimObjectType::Element;

    /**
     * @brief Subentity type from OdDb::SubentType (kFaceSubentType, kEdgeSubentType, kVertexSubentType).
     * kNullSubentType for full element picks.
     */
    OdDb::SubentType subentType = OdDb::kNullSubentType;

    /**
     * @brief B-Rep subentity marker / index (OdGsMarker).
     */
    OdGsMarker subentIndex = 0;

    /**
     * @brief 3D world coordinate where the user clicked / snapped.
     */
    OdGePoint3d globalPoint = OdGePoint3d::kOrigin;

    /**
     * @brief Geometric snap type applied at the pick point.
     */
    VBimObjectSnapTypes snapType = VBimObjectSnapTypes::None;

    /**
     * @brief Active snap mode filter during picking.
     */
    VBimObjectSnapTypes snapMode = VBimObjectSnapTypes::All;

    /**
     * @brief True if the user successfully picked an item; false if cancelled (Esc) or empty.
     */
    bool isValid = false;

    /**
     * @brief Persistent ODA geometry reference (OdBmGeomRef) suitable for dimensioning, aligning, and constraints.
     */
    OdBmGeomRefPtr geomRef;

    /**
     * @brief Surface outward normal (for Face) or tangent direction vector (for Edge, Curve, or Datum).
     */
    OdGeVector3d normal = OdGeVector3d::kIdentity;

    /**
     * @brief Representative geometric center (face centroid, edge midpoint, or datum anchor).
     */
    OdGePoint3d anchor = OdGePoint3d::kOrigin;

    /**
     * @brief Start point of the picked linear edge or segment in world coordinates.
     */
    OdGePoint3d segStart = OdGePoint3d::kOrigin;

    /**
     * @brief End point of the picked linear edge or segment in world coordinates.
     */
    OdGePoint3d segEnd = OdGePoint3d::kOrigin;

    /**
     * @brief True if this reference has an explicit geometric segment (segStart, segEnd).
     */
    bool hasSegment = false;

    /**
     * @brief Polyline vertices for curved boundaries or arc segments.
     */
    std::vector<OdGePoint3d> segPoints;

    /**
     * @brief True if this reference is an arc, circle, or curved segment.
     */
    bool isArc = false;

    /**
     * @brief Center point for arc or circle references.
     */
    OdGePoint3d arcCenter = OdGePoint3d::kOrigin;

    /**
     * @brief Radius for arc or circle references.
     */
    double arcRadius = 0.0;

    /**
     * @brief Ensures a valid OdBmGeomRefPtr is available, constructing it from elementId and subentIndex if not yet set.
     * When picking an element in an RVT link, constructs the reference for the target element.
     * @return Valid OdBmGeomRefPtr or null smart pointer if target element is invalid.
     */
    OdBmGeomRefPtr ensureGeomRef() const
    {
        if (!geomRef.isNull())
            return geomRef;

        const OdBmObjectId targetId = (!linkedElementId.isNull()) ? linkedElementId : elementId;
        if (targetId.isNull())
            return {};

        OdBmGeomRefPtr pRef = OdBmGeomRef::createObject();
        if (subentType == OdDb::kFaceSubentType || subentType == OdDb::kEdgeSubentType)
        {
            OdInt32Array intermediateTags;
            intermediateTags.push_back(static_cast<OdInt32>(subentIndex));
            pRef->set(targetId, intermediateTags, static_cast<OdInt32>(subentIndex));
        }
        else
        {
            pRef->set(targetId);
        }
        return pRef;
    }

    /**
     * @brief Returns an OdBmGeomRef pointing specifically to the element inside the linked document database.
     * @return OdBmGeomRefPtr if this reference points to a linked element, or null smart pointer otherwise.
     */
    OdBmGeomRefPtr ensureLinkedGeomRef() const
    {
        if (linkedElementId.isNull())
            return {};

        OdBmGeomRefPtr pRef = OdBmGeomRef::createObject();
        if (subentType == OdDb::kFaceSubentType || subentType == OdDb::kEdgeSubentType)
        {
            OdInt32Array intermediateTags;
            intermediateTags.push_back(static_cast<OdInt32>(subentIndex));
            pRef->set(linkedElementId, intermediateTags, static_cast<OdInt32>(subentIndex));
        }
        else
        {
            pRef->set(linkedElementId);
        }
        return pRef;
    }

    /**
     * @brief Returns the picked object type. Backward compatibility alias.
     * @return VBimObjectType of this reference.
     */
    VBimObjectType mode() const noexcept { return objectType; }

    /**
     * @brief Returns the picked 3D world coordinate. Backward compatibility alias.
     * @return 3D point in world space.
     */
    OdGePoint3d point() const noexcept { return globalPoint; }

    /**
     * @brief Evaluates to true if a valid element was picked.
     * @return True if valid, false otherwise.
     */
    explicit operator bool() const noexcept { return isValid && !elementId.isNull(); }
};

// Backward compatibility type aliases for code referencing legacy VBimPick* types:
using VBimPickMode = VBimObjectType;

/**
 * @struct VBimPickResult
 * @brief Legacy pick result structure preserved for 100% backward compatibility with external plugins.
 */
struct VBimPickResult
{
    OdBmObjectId elementId;
    OdBmObjectId linkedElementId;
    VBimPickMode mode = VBimPickMode::Element;
    OdDb::SubentType subentType = OdDb::kNullSubentType;
    OdGsMarker subentIndex = 0;
    OdGePoint3d point = OdGePoint3d::kOrigin;
    SnapKind snapKind = SnapKind::None;
    SnapMode snapMode = SnapMode::All;
    bool isValid = false;

    /**
     * @brief Default constructor initializing an empty/invalid pick result.
     */
    VBimPickResult() = default;

    /**
     * @brief Constructs a legacy pick result from a VBimReference.
     * @param ref Source reference structure.
     */
    VBimPickResult(const VBimReference& ref)
        : elementId(ref.elementId)
        , linkedElementId(ref.linkedElementId)
        , mode(ref.objectType)
        , subentType(ref.subentType)
        , subentIndex(ref.subentIndex)
        , point(ref.globalPoint)
        , isValid(ref.isValid)
    {
        if (ref.snapType == VBimObjectSnapTypes::Endpoints) snapKind = SnapKind::Endpoint;
        else if (ref.snapType == VBimObjectSnapTypes::Midpoints) snapKind = SnapKind::Midpoint;
        else if (ref.snapType == VBimObjectSnapTypes::Nearest) snapKind = SnapKind::Nearest;
        else snapKind = SnapKind::None;
    }

    /**
     * @brief Converts legacy pick result to a modern VBimReference.
     * @return Converted reference structure.
     */
    operator VBimReference() const
    {
        VBimReference ref;
        ref.elementId = elementId;
        ref.linkedElementId = linkedElementId;
        ref.objectType = mode;
        ref.subentType = subentType;
        ref.subentIndex = subentIndex;
        ref.globalPoint = point;
        ref.isValid = isValid;
        if (snapKind == SnapKind::Endpoint) ref.snapType = VBimObjectSnapTypes::Endpoints;
        else if (snapKind == SnapKind::Midpoint) ref.snapType = VBimObjectSnapTypes::Midpoints;
        else if (snapKind == SnapKind::Nearest) ref.snapType = VBimObjectSnapTypes::Nearest;
        return ref;
    }

    /**
     * @brief Evaluates to true if a valid element was picked.
     * @return True if valid, false otherwise.
     */
    explicit operator bool() const noexcept { return isValid && !elementId.isNull(); }
};


