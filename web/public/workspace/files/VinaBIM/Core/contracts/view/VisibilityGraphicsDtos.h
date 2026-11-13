#pragma once

#include <string>
#include <vector>
#include <map>
#include <cstdint>
#include "shared/core/VbResult.h"

namespace vbim
{
    /** Named pattern entry (id + display name) for a line- or fill-pattern combo box. */
    struct PatternDto
    {
        uint64_t id = 0;
        std::wstring name;
    };

    using NamedPatternDto = PatternDto;

    /** Single pen-style override (weight / color / line pattern) for one projection or cut side. */
    struct PenOverrideDto
    {
        int weight = -1;                 // -1 = no override, 1..16 = pen number
        uint64_t patternId = 0;          // 0 = no override
        bool isColorOverridden = false;
        uint32_t colorRGB = 0;           // 0x00RRGGBB, only valid when isColorOverridden

        bool hasOverride() const
        {
            return weight != -1 || patternId != 0 || isColorOverridden;
        }
    };

    /** Single fill-pattern override (foreground + background) for one projection or cut side. */
    struct FillOverrideDto
    {
        bool isForegroundVisible = true;
        bool isBackgroundVisible = true;
        uint64_t foregroundPatternId = 0;    // 0 = no override
        uint64_t backgroundPatternId = 0;    // 0 = no override
        bool isForegroundColorOverridden = false;
        uint32_t foregroundColorRGB = 0;     // 0x00RRGGBB, only valid when isForegroundColorOverridden
        bool isBackgroundColorOverridden = false;
        uint32_t backgroundColorRGB = 0;     // 0x00RRGGBB, only valid when isBackgroundColorOverridden

        bool hasOverride() const
        {
            return !isForegroundVisible || !isBackgroundVisible || foregroundPatternId != 0 || backgroundPatternId != 0 || isForegroundColorOverridden || isBackgroundColorOverridden;
        }
    };

    /**
     * Buffer for a single category: both its place in the Visibility/Graphics tree
     * (categoryId/parentCategoryId/name/isVisible) and its OdBmOverrideGraphicSettings
     * (halftone/detailLevel/lines/patterns/transparency).
     *
     * Tree fields and override-settings fields are read/written through separate
     * use-case entry points (see GetVisibilityGraphicsUseCase / ApplyVisibilityGraphicsUseCase)
     * because they live in different ODA storage; do not assume writing one touches the other.
     */
    struct CategoryOverrideDto
    {
        uint64_t categoryId = 0;
        uint64_t parentCategoryId = 0;   // 0 = top-level category
        std::wstring name;

        bool isVisible = true;           // checked state in the category tree (hidden-categories list)

        bool isHalftone = false;
        int detailLevel = -1;            // -1 = by view, 0 = Coarse, 1 = Medium, 2 = Fine

        PenOverrideDto projectionLines;
        FillOverrideDto projectionPatterns;
        int transparency = 0;            // 0-100

        PenOverrideDto cutLines;
        FillOverrideDto cutPatterns;
    };

    /** One tab's worth of categories plus its "Show ... categories in this view" checkbox state. */
    struct CategoryTypeDto
    {
        std::map<uint64_t, CategoryOverrideDto> categories; // key == CategoryOverrideDto::categoryId
        bool isCategoryTypeVisible = true;
        bool isEnabled = true;           // false when the active view template does not propagate this tab
    };

    struct VisibilitySettingsDto
    {
        CategoryTypeDto modelCategories;
        CategoryTypeDto annotationCategories;
        CategoryTypeDto analyticalCategories;
        bool isFamilyDocument = false;   // .rfa: hides the Analytical Model Categories tab
    };
}
