#pragma once

#include <cstdint>
#include <vector>
#include "shared/core/VbResult.h"
#include "VisibilityGraphicsDtos.h"

/**
 * Read/write access to one view's Visibility/Graphics settings (category tree,
 * per-category graphic overrides, and the line/fill pattern catalogs used to
 * populate the override combo boxes), bound to a single engine view at
 * construction. Implemented in Infrastructure so Application/Host never open
 * ODA objects or manage transactions directly for this feature.
 */
class IVisibilityGraphicsPort
{
public:
    virtual ~IVisibilityGraphicsPort() = default;

    // Builds the category tree (Model/Annotation/Analytical) and per-type tab
    // enablement/visibility for the main Visibility/Graphics dialog.
    virtual vb::Result<vbim::VisibilitySettingsDto> GetSettings() = 0;

    // Reads the graphic-override settings for a single built-in category
    // (halftone, detail level, line/fill overrides, transparency).
    // Returns an error for non-built-in categories, which do not support overrides.
    virtual vb::Result<vbim::CategoryOverrideDto> GetCategoryOverride(std::uint64_t categoryId) = 0;

    // Lists the line patterns available for the override-lines combo box.
    virtual vb::Result<std::vector<vbim::NamedPatternDto>> GetLinePatterns() = 0;

    // Lists the fill patterns available for the override-fill-pattern combo boxes.
    virtual vb::Result<std::vector<vbim::NamedPatternDto>> GetFillPatterns() = 0;

    // Applies the modified visibility and graphic overrides to the bound view.
    // Commits all changes in a single transaction (all-or-nothing).
    virtual vb::Result<vb::Void> ApplySettings(const vbim::VisibilitySettingsDto& settings) = 0;
};
