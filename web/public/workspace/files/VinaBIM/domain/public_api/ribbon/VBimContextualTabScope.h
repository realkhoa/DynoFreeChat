/**
 * @file VBimContextualTabScope.h
 * @brief RAII Scope Guard for VinaBIM Contextual Ribbon Tab lifecycle management.
 *
 * Enables any command (OdEdCommand, VBimCommand, or high-level project command)
 * to safely display, activate, and dismiss contextual ribbon tabs with guaranteed
 * teardown upon scope exit.
 */

#pragma once

#include "../VinaBIMApiExport.h"
#include "OdString.h"
#include "OdResult.h"
#include "VBimRibbonTypes.h"
#include <vector>
#include <functional>

namespace vb::ui::ribbon
{
    /**
     * @brief Callback invoked when a user changes a value control on the contextual tab.
     *
     * ComboBox: selected item text. TextBox: edited text (on Enter). CheckBox/Toggle: "1" or "0"
     * (with a callback these report values instead of running commandName as a command).
     * RadioButtonGroup: commandName of the chosen sub item, reported with the group's commandName.
     * The callback may close or replace the scope. Exceptions are caught and logged by the Host.
     * @param controlId The commandName identifier of the control.
     * @param value The new value as described above.
     */
    using RibbonControlCallback = std::function<void(const OdString& controlId, const OdString& value)>;

    /**
     * @class VBimContextualTabScope
     * @brief RAII Scope Guard managing contextual ribbon tab activation and teardown.
     *
     * Shows and activates the specified contextual tab on construction or explicit Show(),
     * routes control events to an optional callback, and automatically restores the previous
     * ribbon tab on destruction (normal exit, ESC, or exception).
     *
     * Scopes nest: the Host shows one contextual tab at a time, so a newer scope suspends the
     * older one (tab and callbacks), which comes back when the newer scope closes. Closing a
     * scope never hides a tab another scope owns. HideContextualTab() drops every scope.
     * UI thread only.
     */
    class VINABIM_API VBimContextualTabScope
    {
    public:
        /**
         * @brief Default constructor creating an uninitialized/inactive scope.
         */
        VBimContextualTabScope() noexcept = default;

        /**
         * @brief Constructs and displays the contextual ribbon tab with the given contextId (legacy).
         * @param contextId Identifier matching TabDef::contextId of a tab registered with isContextual = true.
         * @param autoShow If true and contextId is non-empty, immediately shows and activates the tab.
         */
        explicit VBimContextualTabScope(const OdString& contextId, bool autoShow = true);

        /**
         * @brief Constructs and displays a dynamic contextual ribbon tab with custom panels and controls on the fly.
         * @param tabDef Tab definition containing custom panels, buttons, and returnTab.
         * @param callback Optional callback invoked when any control value is modified by the user.
         */
        explicit VBimContextualTabScope(const VBimRibbon::TabDef& tabDef, RibbonControlCallback callback = nullptr);

        /**
         * @brief Constructs and displays a dynamic contextual ribbon tab on the fly.
         * @param tabName Contextual tab title (e.g. "Modify | My Tool").
         * @param panels List of panel definitions containing custom controls.
         * @param returnTab Category name to return to upon dismissal (default "Architecture").
         * @param callback Optional callback invoked when any control value is modified by the user.
         */
        VBimContextualTabScope(const OdString& tabName,
                               const std::vector<VBimRibbon::PanelDef>& panels,
                               const OdString& returnTab = OD_T("Architecture"),
                               RibbonControlCallback callback = nullptr);

        /**
         * @brief Destructor guaranteeing contextual tab teardown and tab restoration if active.
         */
        ~VBimContextualTabScope();

        // Non-copyable to prevent double-teardown
        VBimContextualTabScope(const VBimContextualTabScope&) = delete;
        VBimContextualTabScope& operator=(const VBimContextualTabScope&) = delete;

        // Movable
        VBimContextualTabScope(VBimContextualTabScope&& other) noexcept;
        VBimContextualTabScope& operator=(VBimContextualTabScope&& other) noexcept;

        /**
         * @brief Shows a dynamic contextual tab with custom panels and controls on the fly.
         * @param tabDef Tab definition containing custom panels, buttons, and returnTab.
         * @param callback Optional callback invoked when any control value is modified by the user.
         * @return eOk if displayed; error code otherwise.
         */
        OdResult Show(const VBimRibbon::TabDef& tabDef, RibbonControlCallback callback = nullptr);

        /**
         * @brief Shows a dynamic contextual tab with custom panels and controls on the fly.
         * @param tabName Contextual tab title (e.g. "Modify | My Tool").
         * @param panels List of panel definitions containing custom controls.
         * @param returnTab Category name to return to upon dismissal (default "Architecture").
         * @param callback Optional callback invoked when any control value is modified by the user.
         * @return eOk if displayed; error code otherwise.
         */
        OdResult Show(const OdString& tabName,
                      const std::vector<VBimRibbon::PanelDef>& panels,
                      const OdString& returnTab = OD_T("Architecture"),
                      RibbonControlCallback callback = nullptr);

        /**
         * @brief Shows and activates the contextual ribbon tab with an explicit contextId (legacy).
         * @param contextId Context identifier matching TabDef::contextId.
         * @return eOk if displayed; eInvalidInput if contextId is not registered or empty.
         */
        OdResult Show(const OdString& contextId);

        /**
         * @brief Shows and activates the contextual ribbon tab using the stored contextId.
         * @return eOk if displayed; eInvalidInput if contextId is not registered or empty.
         */
        OdResult Show();

        /**
         * @brief Hides the contextual ribbon tab and restores the previous active tab.
         */
        void Hide();

        /**
         * @brief Alias for Hide() for parity with other scope guards.
         */
        void Close() { Hide(); }

        /**
         * @brief Checks if this scope still owns a contextual tab (shown, or suspended by a newer scope).
         * @return False when hidden, never shown, or dropped by HideContextualTab().
         */
        bool IsActive() const noexcept;

        /**
         * @brief Gets the context identifier managed by this scope (legacy).
         * @return Reference to OdString containing the contextId.
         */
        const OdString& GetContextId() const noexcept { return m_contextId; }

    private:
        OdString m_contextId;  ///< Legacy contextId (Show(contextId) / Show()).
        OdUInt64 m_token = 0;  ///< Ownership token from VBimUIApplication::PushContextualTab; 0 when hidden.
    };
}

namespace VBimRibbon
{
    using VBimContextualTabScope = vb::ui::ribbon::VBimContextualTabScope;
}
