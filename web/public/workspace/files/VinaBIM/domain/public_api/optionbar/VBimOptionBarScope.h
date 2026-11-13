/**
 * @file VBimOptionBarScope.h
 * @brief RAII Scope Guard for VinaBIM Option Bar lifecycle management.
 *
 * Enables any command (OdEdCommand, VBimCommand, or high-level project command)
 * to safely display and control contextual options with guaranteed teardown upon scope exit.
 */

#pragma once

#include "../VinaBIMApiExport.h"
#include "OptionBarTypes.h"
#include "OdString.h"
#include <vector>
#include <string>

namespace vb::ui::optionbar
{
    /**
     * @class VBimOptionBarScope
     * @brief RAII Scope Guard managing Option Bar presentation and teardown.
     *
     * Displays contextual options on construction or explicit Show(), and automatically
     * releases them upon destruction (normal exit, ESC, or exception).
     *
     * Scopes nest: a newer scope suspends the older one, whose controls (with the values the
     * user last chose) come back when the newer scope closes. Closing a scope never hides
     * controls that another scope owns. HideOptionBar() drops every scope (IsActive() == false).
     * UI thread only.
     */
    class VINABIM_API VBimOptionBarScope
    {
    public:
        /**
         * @brief Default constructor creating an uninitialized/inactive scope.
         */
        VBimOptionBarScope() noexcept = default;

        /**
         * @brief Constructs and immediately displays contextual options on the Option Bar with active command name.
         * @param commandName Prominently displayed active command name (e.g. L"WALL", L"DOOR").
         * @param items List of control descriptors.
         * @param callback Callback fired when user modifies any control.
         */
        VBimOptionBarScope(const OdString& commandName,
                           const std::vector<OptionItem>& items,
                           OptionBarCallback callback);

        /**
         * @brief Constructs and immediately displays contextual options on the Option Bar without command name header.
         * @param items List of control descriptors.
         * @param callback Callback fired when user modifies any control.
         */
        VBimOptionBarScope(const std::vector<OptionItem>& items,
                           OptionBarCallback callback);

        /**
         * @brief Destructor guaranteeing Option Bar teardown if active.
         */
        ~VBimOptionBarScope();

        // Non-copyable to prevent double-teardown
        VBimOptionBarScope(const VBimOptionBarScope&) = delete;
        VBimOptionBarScope& operator=(const VBimOptionBarScope&) = delete;

        // Movable
        VBimOptionBarScope(VBimOptionBarScope&& other) noexcept;
        VBimOptionBarScope& operator=(VBimOptionBarScope&& other) noexcept;

        /**
         * @brief Displays options with an explicit command name header.
         * @param commandName Active command name.
         * @param items List of control descriptors.
         * @param callback Callback fired when user modifies any control.
         * @return eOk if displayed; error code otherwise.
         */
        OdResult Show(const OdString& commandName,
                      const std::vector<OptionItem>& items,
                      OptionBarCallback callback);

        /**
         * @brief Displays options without an explicit command name header.
         * @param items List of control descriptors.
         * @param callback Callback fired when user modifies any control.
         * @return eOk if displayed; error code otherwise.
         */
        OdResult Show(const std::vector<OptionItem>& items,
                      OptionBarCallback callback);

        /**
         * @brief Releases this scope's controls; the previous owner (if any) is shown again.
         */
        void Close();

        /**
         * @brief Checks if this scope's controls are the ones currently shown on the Option Bar.
         * @return False when closed, suspended by a newer scope, or dropped by HideOptionBar().
         */
        bool IsActive() const noexcept;

        /**
         * @brief Returns the ownership token of this scope's Option Bar entry.
         * @details Lets another object (e.g. VBimPropertiesPaneScope::BindOptionBar) refer to the
         *          entry without keeping a pointer to this scope, which may move or be destroyed:
         *          check it with VBimUIApplication::IsOptionBarOwner() before every use.
         * @return Token from VBimUIApplication::PushOptionBar(), or 0 when closed. A new Show()
         *         creates a new token.
         */
        OdUInt64 GetOwnerToken() const noexcept { return m_token; }

        /**
         * @brief Programmatically updates a control value on the Option Bar (Code -> UI); no callback fires.
         *
         * Only the value field of the control's own type is used (Text/Label/Choice: textVal,
         * Number: numVal, Check: checked); label, choices and enabled state are kept.
         * @param id Identifier of the control to update.
         * @param item Carrier of the new value; item.type must match the control (Text is
         *        accepted for Choice and Label). A Choice value must be one of its choices.
         * @return eOk; eNotApplicable if this scope is not active; eInvalidInput for an unknown
         *         id, a type mismatch or an unknown choice.
         */
        OdResult SetValue(int id, const OptionItem& item);

        /**
         * @brief Convenience helper to update text of an edit or choice control.
         * @param id Control ID.
         * @param textVal New text string.
         * @return eOk on success, error code otherwise.
         */
        OdResult SetValue(int id, const std::wstring& textVal);

        /**
         * @brief Convenience helper to update numeric value of a number control.
         * @param id Control ID.
         * @param numVal New numeric value in model units.
         * @return eOk on success, error code otherwise.
         */
        OdResult SetValue(int id, double numVal);

        /**
         * @brief Convenience helper to update checked state of a checkbox control.
         * @param id Control ID.
         * @param checked New boolean state.
         * @return eOk on success, error code otherwise.
         */
        OdResult SetValue(int id, bool checked);

        /**
         * @brief String-literal overload of SetValue(int, const std::wstring&).
         * @note Prevents L"..." from binding to the bool overload (pointer-to-bool conversion).
         * @param id Control ID.
         * @param textVal New text (null is treated as empty).
         * @return eOk on success, error code otherwise.
         */
        OdResult SetValue(int id, const wchar_t* textVal)
        {
            return SetValue(id, std::wstring(textVal ? textVal : L""));
        }

        /**
         * @brief Integer overload of SetValue(int, double); an int argument is otherwise ambiguous between double and bool.
         * @param id Control ID.
         * @param numVal New numeric value in model units.
         * @return eOk on success, error code otherwise.
         */
        OdResult SetValue(int id, int numVal)
        {
            return SetValue(id, static_cast<double>(numVal));
        }

        /**
         * @brief Enables or disables a control (Code -> UI); no callback fires.
         * @param id Control ID.
         * @param enabled New enabled state.
         * @return eOk; eNotApplicable if this scope is not active; eInvalidInput for an unknown id.
         */
        OdResult SetEnabled(int id, bool enabled);

        /**
         * @brief Updates the active command name displayed on the Option Bar.
         * @param commandName New command name string.
         * @return eOk on success, error code otherwise.
         */
        OdResult SetActiveCommand(const OdString& commandName);

    private:
        OdUInt64 m_token = 0;  ///< Ownership token from VBimUIApplication::PushOptionBar; 0 when closed.
    };
}
