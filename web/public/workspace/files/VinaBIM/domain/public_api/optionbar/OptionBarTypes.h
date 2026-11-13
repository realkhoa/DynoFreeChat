/**
 * @file OptionBarTypes.h
 * @brief Type definitions and data contracts for the VinaBIM Option Bar.
 *
 * Provides lightweight, declarative structs and callbacks for hosting dynamic
 * contextual controls on the Option Bar positioned directly below the Ribbon.
 */

#pragma once

#include <functional>
#include <string>
#include <vector>

namespace vb::ui::optionbar
{
    /**
     * @enum OptionType
     * @brief Visual control types supported on the Option Bar.
     */
    enum class OptionType
    {
        Label,     ///< Read-only static text label.
        Text,      ///< Single-line text box; reported on Enter or when it loses focus, if changed.
        Number,    ///< Numeric edit box showing numVal raw (model units, 2 decimals; no project unit
                   ///< conversion). Reported on Enter or focus loss if changed; invalid text is reverted.
        Choice,    ///< Dropdown combobox list.
        Check,     ///< Toggle checkbox.
        Separator  ///< Vertical divider separating control groups.
    };

    /**
     * @struct OptionItem
     * @brief Declarative description of a single control on the Option Bar.
     */
    struct OptionItem
    {
        int                       id = 0;             ///< Unique non-zero identifier for this control.
        OptionType                type = OptionType::Label; ///< Visual control type.
        std::wstring              label;              ///< Display label text (e.g. L"Offset:", L"Chain").
        std::wstring              textVal;            ///< Text value for Text or selected Choice item.
        double                    numVal = 0.0;       ///< Internal numeric value for Number type (model units).
        bool                      checked = false;    ///< Checked state for Checkbox type.
        std::vector<std::wstring> choices;            ///< Available items for Choice dropdown.
        bool                      enabled = true;     ///< Initial enabled state (change it later with SetEnabled).
        int                       widthPx = 0;        ///< Custom width in pixels (0 = auto-measure based on text).
    };

    /**
     * @brief Callback function type invoked when the user modifies any control on the Option Bar.
     * @param id The control ID that changed.
     * @param item The updated control state snapshot.
     */
    using OptionBarCallback = std::function<void(int id, const OptionItem& item)>;
}
