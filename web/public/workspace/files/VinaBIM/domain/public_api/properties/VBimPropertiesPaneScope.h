// VBimPropertiesPaneScope.h
//
// RAII Scope Guard managing Properties Pane Type Selector and Command Properties
// lifecycle, with bi-directional synchronization with Option Bar and active commands.
//
#pragma once

#include "../VinaBIMApiExport.h"
#include "Base/BmObjectId.h"
#include "Base/BmObjectIdArray.h"
#include "Common/BuiltIns/BmBuiltInCategory.h"
#include "OdString.h"
#include "../app/VBimUIApplication.h"
#include "../optionbar/OptionBarTypes.h"
#include <functional>
#include <vector>
#include <memory>

namespace vb::ui::optionbar
{
    class VBimOptionBarScope;
}

class OdBmDatabase;

/**
 * @class VBimPropertiesPaneScope
 * @brief RAII Scope Guard for synchronizing active commands with the Properties Pane.
 *
 * Enables placement and editing commands (Wall, Door, Window, Column, etc.) to:
 * 1. Populate the Properties Pane Type Selector with family symbols / types.
 * 2. Display interactive command properties in the Properties Pane grid (e.g. Height, Offset, Sill Height).
 * 3. Bidirectionally synchronize with the Option Bar (OptionBar <-> PropertiesPane).
 * 4. Automatically teardown and restore normal Properties Pane state upon command exit (RAII).
 * 5. Provide instant notification when new elements are placed (NotifyElementPlaced).
 *
 * Threading: All methods must be invoked from the UI / main application thread.
 */
class VINABIMCORE_DLLEXPORT VBimPropertiesPaneScope
{
public:
    /** @brief Callback invoked when user selects a different type in the Properties Pane dropdown. */
    using TypeChangedCallback = std::function<void(const OdBmObjectId& newTypeId)>;

    /** @brief Callback invoked when user edits a command property field in the Properties Pane grid. */
    using PropertyChangedCallback = std::function<bool(unsigned int id, const OdString& value, int selectedIndex)>;

    /** @brief Callback invoked when user clicks an action button in the Properties Pane. */
    using ActionCallback = std::function<void(unsigned int id)>;

    /**
     * @brief Constructs an uninitialized, inactive scope.
     */
    VBimPropertiesPaneScope() noexcept;

    /**
     * @brief Destructor guaranteeing cleanup of the Type Selector and restoration of the Properties Pane.
     */
    ~VBimPropertiesPaneScope();

    // Non-copyable (RAII ownership guard)
    VBimPropertiesPaneScope(const VBimPropertiesPaneScope&) = delete;
    VBimPropertiesPaneScope& operator=(const VBimPropertiesPaneScope&) = delete;

    // Movable
    VBimPropertiesPaneScope(VBimPropertiesPaneScope&& other) noexcept;
    VBimPropertiesPaneScope& operator=(VBimPropertiesPaneScope&& other) noexcept;

    /**
     * @brief Begins a Type Selector session with the given types and initial selection.
     * @param typeIds Array of element IDs representing types (e.g. Wall Types or Family Symbols).
     * @param selected Initially selected type ID.
     * @param onTypeChanged Callback fired whenever user selects a different type.
     * @return OdResult eOk on success, error code otherwise.
     */
    OdResult ShowTypes(
        const OdBmObjectIdArray& typeIds,
        const OdBmObjectId& selected,
        TypeChangedCallback onTypeChanged);

    /**
     * @brief Sets custom command properties displayed in the Properties Pane grid.
     * @details Every field, including its @c choices array, is copied: the caller's arrays may be
     *          released right after the call. The callback runs before the cached value changes;
     *          returning false keeps the previous value (and the bound Option Bar untouched).
     * @param fields Non-empty vector of property field descriptors (groups, labels, choices, values).
     * @param contextCaption Context header title (e.g. L"New Walls", L"Door Placement").
     * @param onPropertyChanged Callback fired when user modifies any property value. On the first
     *        publication after CreateForCategory() an empty callback keeps the one given there.
     * @param onAction Optional callback for button actions (e.g. Edit Type).
     * @return eOk on success; eNotApplicable without an active Type Selector session; eInvalidInput
     *         for an empty @p fields, a Choice without choices, or rows the Host refuses.
     */
    OdResult SetProperties(
        const std::vector<VBimCommandPropertyField>& fields,
        const OdString& contextCaption = OdString::kEmpty,
        PropertyChangedCallback onPropertyChanged = nullptr,
        ActionCallback onAction = nullptr);

    /**
     * @brief Links an Option Bar scope with this Properties Pane scope for automatic two-way synchronization.
     * @details Only the scope's entry token is kept, never the pointer: moving or destroying the
     *          Option Bar scope cannot leave a dangling reference. Accepted edits are mirrored while
     *          that entry is shown (Boolean -> Check, Number -> Number, Text/Choice -> Text, a numeric
     *          Text value also reaches a Number control). Call again after the Option Bar scope
     *          calls Show() (new token); nullptr unbinds.
     * @param pOptionBar Option Bar scope to bind, or nullptr.
     */
    void BindOptionBar(vb::ui::optionbar::VBimOptionBarScope* pOptionBar);

    /**
     * @brief Programmatically updates a property value displayed in the Properties Pane (Code -> UI).
     * @param id Field identifier.
     * @param value New value string.
     */
    void UpdatePropertyValue(unsigned int id, const OdString& value);

    /**
     * @brief Explicitly ends the Properties Pane session and restores normal active view context.
     */
    void Close();

    /**
     * @brief Checks if this scope is currently active and managing the Properties Pane.
     * @return bool True if active.
     */
    bool IsActive() const noexcept;

    // -----------------------------------------------------------------------
    // Command Presets for Wall, Door, Window, and Family Commands
    //
    // Preset labels come from the STRINGTABLE. Length defaults are display text formatted
    // with the project length units (e.g. "3000" or "9' 10 1/8"" depending on the project);
    // the change callback receives the user's text unchanged.
    // -----------------------------------------------------------------------

    /**
     * @brief Factory preset for WALL command: loads all Wall Types, sets initial type,
     * configures standard Wall placement properties, and binds callbacks.
     * @param pDb Pointer to the active ODA BIM database.
     * @param initialWallType Initially selected wall type ID (or null for default).
     * @param onTypeChanged Callback fired when user chooses a different wall type.
     * @param onParamChanged Callback fired when user modifies wall parameters (Height, Offset, etc.).
     * @return VBimPropertiesPaneScope Initialized and active scope.
     */
    static VBimPropertiesPaneScope CreateForWall(
        OdBmDatabase* pDb,
        const OdBmObjectId& initialWallType,
        TypeChangedCallback onTypeChanged,
        PropertyChangedCallback onParamChanged = nullptr);

    /**
     * @brief Factory preset for DOOR command: loads all Door family symbols, sets initial symbol,
     * configures default Door placement properties (Sill Height, etc.), and binds callbacks.
     * @param pDb Pointer to the active ODA BIM database.
     * @param initialDoorSymbol Initially selected door symbol ID (or null for default).
     * @param onTypeChanged Callback fired when user chooses a different door symbol.
     * @param onParamChanged Callback fired when user modifies door parameters.
     * @return VBimPropertiesPaneScope Initialized and active scope.
     */
    static VBimPropertiesPaneScope CreateForDoor(
        OdBmDatabase* pDb,
        const OdBmObjectId& initialDoorSymbol,
        TypeChangedCallback onTypeChanged,
        PropertyChangedCallback onParamChanged = nullptr);

    /**
     * @brief Factory preset for WINDOW command: loads all Window family symbols, sets initial symbol,
     * configures default Window placement properties (Sill Height, Head Height), and binds callbacks.
     * @param pDb Pointer to the active ODA BIM database.
     * @param initialWindowSymbol Initially selected window symbol ID (or null for default).
     * @param onTypeChanged Callback fired when user chooses a different window symbol.
     * @param onParamChanged Callback fired when user modifies window parameters.
     * @return VBimPropertiesPaneScope Initialized and active scope.
     */
    static VBimPropertiesPaneScope CreateForWindow(
        OdBmDatabase* pDb,
        const OdBmObjectId& initialWindowSymbol,
        TypeChangedCallback onTypeChanged,
        PropertyChangedCallback onParamChanged = nullptr);

    /**
     * @brief Generic factory preset for any Family category (Columns, Beams, Furniture, etc.).
     * @details Shows only the Type Selector: no generic placement rows exist for an arbitrary
     *          category and the Host refuses an empty panel. Publish the command's own rows with
     *          SetProperties(); @p contextCaption and @p onParamChanged are kept for that call.
     * @param pDb Pointer to active database.
     * @param category Built-in category enum.
     * @param initialSymbol Initially selected family symbol.
     * @param contextCaption Context label.
     * @param onTypeChanged Callback on symbol change.
     * @param onParamChanged Callback on parameter change.
     * @return VBimPropertiesPaneScope Initialized scope.
     */
    static VBimPropertiesPaneScope CreateForCategory(
        OdBmDatabase* pDb,
        OdBm::BuiltInCategory::Enum category,
        const OdBmObjectId& initialSymbol,
        const OdString& contextCaption,
        TypeChangedCallback onTypeChanged,
        PropertyChangedCallback onParamChanged = nullptr);

    // -----------------------------------------------------------------------
    // Post-Placement Notification & UI Sync
    // -----------------------------------------------------------------------

    /**
     * @brief Notifies the Properties Pane and Host application that an element was just placed.
     * @details Updates the Properties Pane to select and show the new element's instance properties.
     * @param newElementId The object ID of the created/placed element.
     */
    static void NotifyElementPlaced(const OdBmObjectId& newElementId);

    /**
     * @brief Restores the Properties Pane to display the active view properties.
     */
    static void RestoreToActiveView();

private:
    class Impl;
    std::unique_ptr<Impl> m_pImpl;
};
