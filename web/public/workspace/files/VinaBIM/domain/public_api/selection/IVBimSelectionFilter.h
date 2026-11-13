///////////////////////////////////////////////////////////////////////////////
// VinaBIM Native SDK — Public API
// Selection Filter
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "VBimSelectionTypes.h"
#include "Base/BmObjectId.h"
#include "Ge/GePoint3d.h"

/**
 * @class IVBimSelectionFilter
 * @brief Interface that provides the ability to filter objects during an interactive selection operation.
 */
class IVBimSelectionFilter
{
public:
    virtual ~IVBimSelectionFilter() = default;

    /**
     * @brief Determines whether a candidate element should be allowed to be picked or pre-highlighted.
     * @param elementId The candidate BIM element ID.
     * @return true if allowed; false to ignore.
     */
    virtual bool AllowElement(const OdBmObjectId& elementId)
    {
        (void)elementId;
        return true;
    }

    /**
     * @brief Determines whether a candidate geometric reference (subentity) should be allowed to be picked.
     * @param reference The candidate reference containing subentity info.
     * @param position 3D position where cursor is currently pointing.
     * @return true if allowed; false to ignore.
     */
    virtual bool AllowReference(const VBimReference& reference, const OdGePoint3d& position)
    {
        (void)reference;
        (void)position;
        return true;
    }
};

/** Optional companion implemented alongside IVBimSelectionFilter. Existing
 * filters keep their original vtable and hit/highlight behavior. The resolver
 * may replace the accepted hit with another persistent reference on the SAME
 * element, so preview and click describe the same reference. UI thread only.
 * For these opt-in filters, AllowReference's position is the unsnapped cursor
 * in world coordinates; reference.globalPoint remains the geometric snap.
 * Legacy filters keep receiving the snapped position.
 */
class IVBimSelectionReferenceResolver
{
public:
    virtual ~IVBimSelectionReferenceResolver() = default;
    /**
     * @brief Optionally replaces an accepted hit with another persistent reference on the same element.
     * @param[in,out] acceptedReference Input accepted hit reference; modified in place if resolved.
     * @return true if hit was resolved to a valid reference on the same element; false to keep original hit.
     * @note Only applied when elementId and linkedElementId remain unchanged, geomRef is non-null,
     *       and objectType is Element or hasSegment is true or segPoints contains >= 2 points.
     */
    virtual bool ResolveReference(VBimReference& acceptedReference) = 0;
    // Called when the cursor loses its hit, not during tracker cleanup after
    // a successful pick: the command still needs its selected reference then.
    virtual void OnReferenceHoverCleared() noexcept = 0;
};
