/**
 * @file VBimCommand.h
 * @brief Base class for VinaBIM commands, providing lifecycle extensions, Option Bar, Contextual Tab, and UI initialization.
 *
 * Provides a modern C++ wrapper around ODA's @c OdEdCommand, adding the @c init() lifecycle
 * hook for declarative Ribbon UI registration, automatic Option Bar and Contextual Tab management,
 * and RAII Transaction scoping modeled after Autodesk Revit UI API.
 */

#pragma once

#include "../VinaBIMApiExport.h"
#include "Ed/EdCommandStack.h"
#include "OdString.h"
#include "../app/VBimUIApplication.h"
#include "../app/VBimUIDocument.h"
#include "../optionbar/OptionBarTypes.h"
#include "../ribbon/VBimRibbonTypes.h"
#include "../ribbon/VBimContextualTabScope.h"
#include <vector>
#include <string>
#include <memory>

namespace vb::commands
{
    /**
     * @enum CommandResult
     * @brief Result code returned by VBimCommand::Execute.
     */
    enum class CommandResult
    {
        Succeeded, ///< Command completed successfully; commits automatic transaction.
        Cancelled, ///< User cancelled (e.g. pressed ESC). Automatic: rolls back the transaction and
                   ///< ends the command as cancelled (execute() throws OdEdCancel). Manual/ReadOnly:
                   ///< ends the command normally, keeping the transactions it committed.
        Failed     ///< Command failed due to invalid data or error; rolls back transaction and
                   ///< ends the command as failed (execute() throws OdError, shown by the Host).
    };

    /**
     * @enum TransactionMode
     * @brief Transaction scoping policy for commands.
     */
    enum class TransactionMode
    {
        /**
         * @brief Automatically wraps Execute() in a single RAII OdExplicitTransaction.
         * @warning Automatic mode is strictly NON-INTERACTIVE. Commands using Automatic mode
         *          MUST NOT invoke interactive picking, user prompts (e.g. via GetUserIO()->getPoint(),
         *          select(), getString()), modal UI, or message loops during Execute().
         *          Prompts running inside an active transaction violate transaction boundaries, allow
         *          concurrent modifications from dockable panes, and leave orphaned undo states on ESC.
         *          Commands requiring point picking, entity selection, or modal interaction MUST use Manual mode.
         */
        Automatic,

        /**
         * @brief Command manages its own fine-grained transactions.
         * @details Required for interactive commands: collect all prompts/picks outside open transactions,
         *          and open short, scoped transactions only to apply verified model modifications.
         *          ESC / Cancelled ends the command normally: committed transactions stay and are
         *          reported by DocumentChanged; a transaction the command rolled back is not.
         */
        Manual,

        /**
         * @brief Read-only command mode. No modification transaction is opened.
         */
        ReadOnly
    };
}

using CommandResult = vb::commands::CommandResult;
using TransactionMode = vb::commands::TransactionMode;

class OdBmDatabase;
class OdBmUserIO;

/**
 * @class VBimExecutionContext
 * @brief Strongly-typed execution context passed to VBimCommand::Execute().
 *
 * Provides safe access to the active BIM Database, active View, Level, and User IO
 * without exposing raw Host UI types.
 */
class VBimExecutionContext
{
public:
    virtual ~VBimExecutionContext() = default;

    /**
     * @brief Gets the underlying active OdBmDatabase.
     * @return Database pointer or nullptr.
     */
    virtual OdBmDatabase* GetDatabase() const noexcept = 0;

    /**
     * @brief Gets the active UI document wrapper.
     * @return Pointer to VBimUIDocument or nullptr.
     */
    virtual VBimUIDocument* GetUIDocument() const noexcept = 0;

    /**
     * @brief Gets the element ID of the active model view (OdBmDBView).
     * @details The base DB view of the OdBmDBDrawing shown in the active view window, i.e. the id
     *          to open as OdBmDBView (plan, section, 3D, sheet ...), not the drawing id itself.
     * @return Active view OdBmObjectId, or kNull when no view is active.
     */
    virtual OdBmObjectId GetActiveViewId() const noexcept = 0;

    /**
     * @brief Gets the element ID of the level associated with the active view.
     * @details Read from OdBmDBView::getGenElemId() of the active view; kept only when it opens as
     *          an OdBmLevel.
     * @return Active level OdBmObjectId, or kNull if the view is not level-bound (3D, sections, sheets).
     */
    virtual OdBmObjectId GetActiveLevelId() const noexcept = 0;

    /**
     * @brief Gets the ODA BimRv User IO interface for interactive picking and input.
     * @note When using GetUserIO() for interactive prompts (getPoint, select, etc.), the command
     *       MUST use TransactionMode::Manual to ensure prompts execute outside active transactions.
     * @return Pointer to OdBmUserIO or nullptr.
     */
    virtual OdBmUserIO* GetUserIO() const noexcept = 0;

    /**
     * @brief Sets status-bar text in the application.
     * @param text Text string to display.
     */
    virtual void SetStatusText(const OdString& text) = 0;
};

/**
 * @class VBimCommand
 * @brief Unified base class for VinaBIM commands supporting Revit-style lifecycle, Option Bar, Contextual Tab, and UI registration.
 *
 * Subclasses implement standard ODA methods:
 *   - @ref groupName()
 *   - @ref globalName()
 *
 * And choose ONE of two execution models:
 *   1. Modern High-Level Lifecycle (Recommended):
 *      Override @ref Execute(VBimExecutionContext&) and optional declarative hooks
 *      (@ref GetOptions, @ref OnOptionChanged, @ref GetContextualTabId, @ref GetTransactionMode).
 *      The base class @ref execute(OdEdCommandContext*) automatically manages Option Bar,
 *      Contextual Tab, and RAII Transaction scoping.
 *
 *   2. Classic / Raw ODA Lifecycle (100% Backward Compatible):
 *      Override @ref execute(OdEdCommandContext*) directly to implement custom low-level workflows.
 *
 * Subclasses may optionally override @ref init() to register UI elements
 * (Ribbon tabs, panels, push buttons, icons) via Revit-style RibbonControl API.
 */
class VINABIM_API VBimCommand : public OdEdCommand
{
public:
    using CommandResult = vb::commands::CommandResult;
    using TransactionMode = vb::commands::TransactionMode;

    virtual ~VBimCommand() = default;

    // ── High-Level Command Execution Contract ─────────────────────────────────

    /**
     * @brief High-level command execution logic implemented by subclasses.
     * @param ctx Safe execution context providing DB, View, Level, and IO.
     * @return CommandResult indicating success, cancellation, or failure.
     */
    virtual CommandResult Execute(VBimExecutionContext& ctx);

    // ── Standard ODA Command Pure Virtuals ────────────────────────────────────

    /**
     * @brief Gets the command group name.
     * @return Group name as OdString.
     */
    virtual const OdString groupName() const override = 0;

    /**
     * @brief Gets the unique global name for the command.
     * @return Global command name as OdString.
     */
    virtual const OdString globalName() const override = 0;

    /**
     * @brief Executes the command logic within the supplied context.
     *
     * Default implementation provides the complete high-level lifecycle:
     * environment validation, Option Bar, Contextual Tab, RAII Transaction scoping,
     * and dispatches to @ref Execute(VBimExecutionContext&).
     *
     * In TransactionMode::Automatic a Cancelled result or an OdEdCancel from Execute() rolls back
     * and rethrows OdEdCancel. In Manual and ReadOnly mode they end the command normally, because
     * transactions the command already committed stay in the model and must be reported.
     * A Failed result, an OdError, a std::exception or an unknown exception rolls back (Automatic)
     * and throws OdError in every mode. ODA then fires commandCancelled / commandFailed (not
     * commandEnded), so the DocumentChanged event does not report ids of a rolled-back
     * Automatic transaction. The Host command boundary catches these exceptions and shows the
     * error description.
     *
     * Subclasses can override this directly for raw low-level ODA workflows.
     *
     * @param pCmdCtx Pointer to ODA command execution context.
     */
    virtual void execute(OdEdCommandContext* pCmdCtx) override;

    // ── Standard ODA Defaults ────────────────────────────────────────────────

    /**
     * @brief Gets command execution flags.
     * @return Execution flags bitmask.
     */
    virtual OdInt32 flags() const override { return 0; }

    /**
     * @brief Gets the localized command display name.
     * @return Localized command name as OdString.
     */
    virtual const OdString localName() const override { return globalName(); }

    /**
     * @brief Extension initialization method called when the command/module is loaded.
     * Subclasses can override this to create and configure Ribbon UI elements.
     * Default implementation is empty (no-op).
     */
    virtual void init() {}

    // ── Environment Support Hooks (RVT & RFA) ────────────────────────────────

    /**
     * @brief Indicates whether this command is allowed to run in a Project (.rvt) model.
     * @return True if permitted in Project environment (defaults to true).
     */
    virtual bool AllowInProject() const;

    /**
     * @brief Indicates whether this command is allowed to run in Family Editor (.rfa).
     * @return True if permitted in Family environment (defaults to true).
     */
    virtual bool AllowInFamily() const;

    // ── Option Bar Declarative Contract ─────────────────────────────────────

    /**
     * @brief Declares the list of controls to display on the Option Bar during command execution.
     * @return Vector of OptionItem descriptors; empty vector leaves the Option Bar blank.
     */
    virtual std::vector<vb::ui::optionbar::OptionItem> GetOptions();

    /**
     * @brief Invoked when the user modifies any control on the Option Bar (UI -> Code).
     * @param id Identifier of the modified control.
     * @param item Updated state snapshot of the control.
     */
    virtual void OnOptionChanged(int id, const vb::ui::optionbar::OptionItem& item);

    // ── Contextual Ribbon Tab Contract ──────────────────────────────────────

    /**
     * @brief Declares the dynamic contextual ribbon tab (with panels, buttons, combos, mode controls) for this command.
     * @return TabDef containing customized panels, groups, controls, and returnTab. Empty name means no contextual tab.
     */
    virtual VBimRibbon::TabDef GetContextualTab() const;

    /**
     * @brief Invoked when the user modifies any control (ComboBox, TextBox) on the contextual ribbon tab.
     * @param controlId Command name / ID of the modified control.
     * @param value Updated value string (selected item or edited text).
     */
    virtual void OnContextualControlChanged(const OdString& controlId, const OdString& value);

    /**
     * @brief Declares the contextual ribbon tab identifier to display during command execution (legacy).
     * @return Context ID matching TabDef::contextId (e.g. L"VinaBIM.WallTest"), or OdString::kEmpty if none.
     */
    virtual OdString GetContextualTabId() const;

    // ── Type Selector Contract ──────────────────────────────────────────────

    /**
     * @brief Returns the BuiltInCategory ID for the Type Selector in the Properties palette.
     * @return BuiltInCategory integer, or 0 if Type Selector is not used.
     */
    virtual int GetTargetCategory() const;

    /**
     * @brief Invoked when the user selects a different element type in the Type Selector.
     * @param newTypeId Element ID of the newly selected type.
     */
    virtual void OnTypeChanged(const OdBmObjectId& newTypeId);

    // ── Transaction Policy ──────────────────────────────────────────────────

    /**
     * @brief Gets the transaction management policy for this command.
     * @details Defaults to TransactionMode::Automatic for batch/direct model mutations.
     *          If your command performs interactive prompts or picking (GetUserIO()),
     *          you MUST override this and return TransactionMode::Manual so that prompts
     *          occur outside of open transactions.
     * @return TransactionMode policy (default is Automatic).
     */
    virtual TransactionMode GetTransactionMode() const;

    /**
     * @brief Gets the descriptive name for the Undo step recorded in the database.
     * @return Undo name string (defaults to globalName()).
     */
    virtual OdString GetTransactionName() const;

    /**
     * @brief Gets the user-facing shorthand display name for this command on the Option Bar.
     * @return OdString representing the shorthand name. Defaults to globalName().
     */
    virtual OdString GetDisplayName() const;

    // ── Undo / Redo Recording Helpers ────────────────────────────────────────

    /**
     * @brief Helper to record creation of elements for Undo (Ctrl+Z).
     * @param ids Array of created element IDs.
     * @param name Descriptive action name (defaults to L"Create").
     */
    static void RecordCreated(const OdBmObjectIdArray& ids, const OdString& name = L"Create")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordCreated(ids, name);
    }

    /**
     * @brief Helper to record creation of a single element for Undo (Ctrl+Z).
     * @param id Created element ID.
     * @param name Descriptive action name.
     */
    static void RecordCreated(const OdBmObjectId& id, const OdString& name = L"Create")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordCreated(id, name);
    }

    /**
     * @brief Helper to record creation of elements from a vector for Undo (Ctrl+Z).
     * @param ids Vector of created element IDs.
     * @param name Descriptive action name (defaults to L"Create").
     */
    static void RecordCreated(const std::vector<OdBmObjectId>& ids, const OdString& name = L"Create")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordCreated(ids, name);
    }

    /**
     * @brief Helper to record geometric translation of elements for Undo (Ctrl+Z).
     * @param ids Array of moved element IDs.
     * @param delta Translation vector applied.
     * @param name Descriptive action name (defaults to L"Move").
     */
    static void RecordMoved(const OdBmObjectIdArray& ids, const OdGeVector3d& delta, const OdString& name = L"Move")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordMoved(ids, delta, name);
    }

    /**
     * @brief Helper to record geometric translation of a single element for Undo (Ctrl+Z).
     * @param id Moved element ID.
     * @param delta Translation vector applied.
     * @param name Descriptive action name (defaults to L"Move").
     */
    static void RecordMoved(const OdBmObjectId& id, const OdGeVector3d& delta, const OdString& name = L"Move")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordMoved(id, delta, name);
    }

    /**
     * @brief Helper to record geometric translation of elements from a vector for Undo (Ctrl+Z).
     * @param ids Vector of moved element IDs.
     * @param delta Translation vector applied.
     * @param name Descriptive action name (defaults to L"Move").
     */
    static void RecordMoved(const std::vector<OdBmObjectId>& ids, const OdGeVector3d& delta, const OdString& name = L"Move")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordMoved(ids, delta, name);
    }

    /**
     * @brief Helper to record geometric rotation of an element for Undo (Ctrl+Z).
     * @param id Element ID rotated.
     * @param center Rotation center point.
     * @param axis Rotation axis vector.
     * @param angle Rotation angle in radians.
     * @param name Descriptive action name (defaults to L"Rotate").
     */
    static void RecordRotated(const OdBmObjectId& id, const OdGePoint3d& center, const OdGeVector3d& axis, double angle, const OdString& name = L"Rotate")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordRotated(id, center, axis, angle, name);
    }

    /**
     * @brief Helper to record pre-image snapshot before deletion of elements for Undo (Ctrl+Z).
     * @note Must be called BEFORE deleting elements from the database!
     * @param ids Array of element IDs about to be deleted.
     * @param name Descriptive action name (defaults to L"Delete").
     */
    static void RecordErased(const OdBmObjectIdArray& ids, const OdString& name = L"Delete")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordErased(ids, name);
    }

    /**
     * @brief Helper to record pre-image snapshot before deletion of a single element for Undo (Ctrl+Z).
     * @note Must be called BEFORE deleting element from the database!
     * @param id Element ID about to be deleted.
     * @param name Descriptive action name (defaults to L"Delete").
     */
    static void RecordErased(const OdBmObjectId& id, const OdString& name = L"Delete")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordErased(id, name);
    }

    /**
     * @brief Helper to record pre-image snapshot before deletion of elements from a vector for Undo (Ctrl+Z).
     * @note Must be called BEFORE deleting elements from the database!
     * @param ids Vector of element IDs about to be deleted.
     * @param name Descriptive action name (defaults to L"Delete").
     */
    static void RecordErased(const std::vector<OdBmObjectId>& ids, const OdString& name = L"Delete")
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordErased(ids, name);
    }

    /**
     * @brief Helper to record an arbitrary undoable action for Undo (Ctrl+Z).
     * @param action Shared pointer to reversible action.
     */
    static void RecordUndo(std::shared_ptr<IUndoableAction> action)
    {
        if (auto* pDoc = VBimUIApplication::Instance().ActiveUIDocument())
            pDoc->RecordUndoAction(action);
    }

    // ── Asset & Resource Helpers ─────────────────────────────────────────────

    /**
     * @brief Helper to get the directory of the calling plugin DLL/module.
     * @return Path containing trailing backslash, e.g. "D:\\MyPlugin\\bin\\"
     */
    static std::wstring GetCurrentModuleDirectory()
    {
        HMODULE hModule = nullptr;
        if (::GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                                 reinterpret_cast<LPCWSTR>(&VBimCommand::GetCurrentModuleDirectory), &hModule) && hModule)
        {
            wchar_t path[MAX_PATH] = { 0 };
            if (::GetModuleFileNameW(hModule, path, MAX_PATH))
            {
                std::wstring s = path;
                const size_t pos = s.find_last_of(L"\\/");
                if (pos != std::wstring::npos)
                    return s.substr(0, pos + 1);
            }
        }
        return L"";
    }

    /**
     * @brief Helper to resolve a resource path relative to this command plugin's DLL directory.
     * @param relativePath Relative path, e.g. L"res\\icons\\MyIcon.png"
     * @return Absolute path on disk.
     */
    static std::wstring GetResourcePath(const std::wstring& relativePath)
    {
        return GetCurrentModuleDirectory() + relativePath;
    }

    // ── Option Bar Integration Helpers ───────────────────────────────────────

    /**
     * @brief Displays controls on the Option Bar situated directly below the Ribbon, displaying the active command.
     * @param commandName Name of the active command to display prominently.
     * @param items List of control descriptors to create and display.
     * @param callback Callback invoked when any control value is modified by the user.
     * @return eOk if Option Bar was populated; error code otherwise.
     */
    static OdResult ShowOptionBar(const OdString& commandName,
        const std::vector<vb::ui::optionbar::OptionItem>& items,
        vb::ui::optionbar::OptionBarCallback callback)
    {
        return VBimUIApplication::Instance().ShowOptionBar(commandName, items, std::move(callback));
    }

    /**
     * @brief Displays controls on the Option Bar situated directly below the Ribbon without command name header.
     * @param items List of control descriptors to create and display.
     * @param callback Callback invoked when any control value is modified by the user.
     * @return eOk if Option Bar was populated; error code otherwise.
     */
    static OdResult ShowOptionBar(const std::vector<vb::ui::optionbar::OptionItem>& items,
        vb::ui::optionbar::OptionBarCallback callback)
    {
        return VBimUIApplication::Instance().ShowOptionBar(items, std::move(callback));
    }

    /**
     * @brief Clears all controls from the Option Bar and restores it to the idle empty state.
     */
    static void HideOptionBar()
    {
        VBimUIApplication::Instance().HideOptionBar();
    }

    /**
     * @brief Sets or updates the active command name displayed on the Option Bar.
     * @param commandName Active command name string.
     * @return eOk on success, error code otherwise.
     */
    static OdResult SetOptionBarActiveCommand(const OdString& commandName)
    {
        return VBimUIApplication::Instance().SetOptionBarActiveCommand(commandName);
    }

    /**
     * @brief Updates the value of an existing control on the Option Bar (Code -> UI).
     * @param id Identifier of the control to update.
     * @param item New control state snapshot.
     * @return eOk on success, error code otherwise.
     */
    static OdResult SetOptionBarValue(int id, const vb::ui::optionbar::OptionItem& item)
    {
        return VBimUIApplication::Instance().SetOptionBarValue(id, item);
    }

    /**
     * @brief Convenience helper to update text of an edit or choice control on the Option Bar.
     * @param id Identifier of the control to update.
     * @param textVal New text string.
     * @return eOk on success, error code otherwise.
     */
    static OdResult SetOptionBarValue(int id, const std::wstring& textVal)
    {
        vb::ui::optionbar::OptionItem item;
        item.id = id;
        item.type = vb::ui::optionbar::OptionType::Text;
        item.textVal = textVal;
        return SetOptionBarValue(id, item);
    }

    /**
     * @brief Convenience helper to update numeric value of a number control on the Option Bar.
     * @param id Identifier of the control to update.
     * @param numVal New numeric value in model units.
     * @return eOk on success, error code otherwise.
     */
    static OdResult SetOptionBarValue(int id, double numVal)
    {
        vb::ui::optionbar::OptionItem item;
        item.id = id;
        item.type = vb::ui::optionbar::OptionType::Number;
        item.numVal = numVal;
        return SetOptionBarValue(id, item);
    }

    /**
     * @brief Convenience helper to update checked state of a checkbox control on the Option Bar.
     * @param id Identifier of the control to update.
     * @param checked New boolean state.
     * @return eOk on success, error code otherwise.
     */
    static OdResult SetOptionBarValue(int id, bool checked)
    {
        vb::ui::optionbar::OptionItem item;
        item.id = id;
        item.type = vb::ui::optionbar::OptionType::Check;
        item.checked = checked;
        return SetOptionBarValue(id, item);
    }

    /**
     * @brief String-literal overload of SetOptionBarValue(int, const std::wstring&).
     * @note Prevents L"..." from binding to the bool overload (pointer-to-bool conversion).
     * @param id Identifier of the control to update.
     * @param textVal New text (null is treated as empty).
     * @return eOk on success, error code otherwise.
     */
    static OdResult SetOptionBarValue(int id, const wchar_t* textVal)
    {
        return SetOptionBarValue(id, std::wstring(textVal ? textVal : L""));
    }

    /**
     * @brief Integer overload of SetOptionBarValue(int, double); an int argument is otherwise ambiguous.
     * @param id Identifier of the control to update.
     * @param numVal New numeric value in model units.
     * @return eOk on success, error code otherwise.
     */
    static OdResult SetOptionBarValue(int id, int numVal)
    {
        return SetOptionBarValue(id, static_cast<double>(numVal));
    }

    // ── Contextual Ribbon Tab Helpers ────────────────────────────────────────

    /**
     * @brief Shows a dynamic contextual tab with custom panels and controls on the fly.
     * @param tabDef Tab definition containing custom panels, buttons, and returnTab.
     * @return eOk on success, error code otherwise.
     */
    static OdResult ShowContextualTab(const VBimRibbon::TabDef& tabDef)
    {
        return VBimUIApplication::Instance().ShowContextualTab(tabDef);
    }

    /**
     * @brief Shows a dynamic contextual tab on the fly with custom panels and return tab.
     * @param tabName Contextual tab title (e.g. "Modify | Place Wall").
     * @param panels List of panel definitions containing custom controls.
     * @param returnTab Category name to return to upon dismissal (default "Architecture").
     * @return eOk on success, error code otherwise.
     */
    static OdResult ShowContextualTab(const OdString& tabName,
                                      const std::vector<VBimRibbon::PanelDef>& panels,
                                      const OdString& returnTab = OD_T("Architecture"))
    {
        return VBimUIApplication::Instance().ShowContextualTab(tabName, panels, returnTab);
    }

    /**
     * @brief Hides the currently active dynamic contextual tab.
     * @return eOk on success, error code otherwise.
     */
    static OdResult HideContextualTab()
    {
        return VBimUIApplication::Instance().HideContextualTab();
    }

    /**
     * @brief Shows and activates (show=true) or hides the contextual ribbon tab with the specified contextId (legacy).
     * @param contextId Identifier matching TabDef::contextId of a tab registered with TabDef::isContextual = true.
     * @param show True to display and activate; false to hide.
     * @return eOk if contextual tab was shown/hidden; eInvalidInput if contextId is not registered.
     */
    static OdResult ShowContextualTab(const OdString& contextId, bool show = true)
    {
        return VBimUIApplication::Instance().ShowContextualTab(contextId, show);
    }

    /**
     * @brief Hides the contextual ribbon tab with the specified contextId (legacy).
     * @param contextId Identifier matching TabDef::contextId.
     * @return eOk if hidden; error code otherwise.
     */
    static OdResult HideContextualTab(const OdString& contextId)
    {
        return VBimUIApplication::Instance().ShowContextualTab(contextId, false);
    }
};
