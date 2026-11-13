// VBimUIApplication.h
//
// Application-level facade for VinaBIM SDK developers.
//
// Threading: All methods must be called from the UI thread.
// Lifetime:  Instance() is valid after VinaBIM startup completes
//            and before ExitInstance() is called.
//
#pragma once

#include "../VinaBIMApiExport.h"
#include "../events/ExternalEvent/VBimExternalEvent.h"
#include "../command/Availability/IVBimCommandAvailability.h"

#include "Base/BmObjectId.h"
#include "Base/BmObjectIdArray.h"
#include "OdResult.h"
#include "OdString.h"

#include <vector>
#include "../optionbar/OptionBarTypes.h"
#include "../ribbon/VBimRibbonTypes.h"

#ifndef _WINDEF_
struct HWND__; typedef struct HWND__* HWND;
#endif

class VBimUIDocument;
class VBimEventManager;
class VBimDockablePaneRegistry;
class VBimProgressService;
class VBimTaskDialogService;
namespace vb { namespace net { class IHttpClient; } }
namespace VBimRibbon { class IVBimRibbonControlHandler; class IVBimRibbonComboKeyHandler; }

// Receives the user's choice in the Properties Type Selector during a plugin
// command (VBimUIApplication::BeginTypeSelection). Implemented by the plugin.
//
class IVBimTypeSelectorHandler
{
public:
    virtual ~IVBimTypeSelectorHandler() = default;

    // Called on the UI thread while the owning command waits for input (inside
    // the getPoint/getString message loop). Do not start a transaction or a
    // command here: store typeId, then call vbimRefreshActiveJigPreview() to
    // update the preview. An exception is caught and logged by the Host.
    //
    virtual void OnTypeChanged(const OdBmObjectId& typeId) = 0;
};

// Facade over the VinaBIM application singleton (CVinaBIMApp theApp).
//
// Note: VBimUIApplication covers application-level and UI-level roles.
// VBimApplication is intentionally omitted in Phase 1.
//
/** @brief One command-owned Properties row. Strings and choices are copied by SetCommandProperties. */
struct VBimCommandProperty
{
    unsigned int id = 0; ///< Nonzero key unique within this command's rows.
    OdString group; ///< Localized group heading.
    OdString label; ///< Localized field label, including units where applicable.
    OdString value; ///< Initial text; ignored when choiceCount is nonzero.
    const OdString* choices = nullptr; ///< Borrowed array, needed only during publication.
    unsigned int choiceCount = 0; ///< Zero creates a text editor; otherwise a choice editor.
    int selectedIndex = -1; ///< Selected choice index, required for a choice editor.
};

/** @brief Receives placement-option edits on the UI thread without a database transaction. */
class IVBimCommandPropertiesHandler
{
public:
    virtual ~IVBimCommandPropertiesHandler() = default;
    /** @brief Accepts an edit; false restores the previous value. Never start commands or DB writes here.
     * @param id Published field key.
     * @param value Edited text, or selected choice label. Borrowed for this call.
     * @param selectedIndex Choice index, or -1 for text. Use the index for identity, not the label.
     * @return True when the command has accepted the value. Do not republish rows inside this callback.
     */
    virtual bool OnPropertyChanged(unsigned int id, const OdString& value, int selectedIndex) = 0;
};

/** @brief Editor kinds for the separate DLL-owned panel contract; existing row ABI is unchanged. */
enum class VBimCommandPropertyKind { Text, Number, Choice, Boolean, Action };

/** @brief One localized placement row. Host copies every string/choice on publication; UI thread only. */
struct VBimCommandPropertyField
{
    unsigned int id = 0; ///< Unique nonzero key; zero is reserved for Edit Type actions.
    OdString group; ///< Localized collapsible section heading, in publication order.
    OdString label; ///< Localized name including units for numeric fields.
    VBimCommandPropertyKind kind = VBimCommandPropertyKind::Text; ///< Editor, never an ODA parameter type.
    OdString value; ///< Text or finite numeric text; action button caption is localized by DLL.
    const OdString* choices = nullptr; ///< Borrowed until GetProperties is copied; Choice only.
    unsigned int choiceCount = 0; ///< Number of choices; must be nonzero for Choice.
    int selectedIndex = -1; ///< Choice identity; duplicate display labels are allowed.
    bool boolValue = false; ///< Boolean state independent of display text/localization.
    bool readOnly = false; ///< Blocks editing and actions; readonly booleans remain visible.
};

/** @brief Borrowed authoritative UI snapshot; no database elements or STL ownership cross this boundary. */
struct VBimCommandPropertyPanel
{
    OdString contextLabel; ///< Localized context caption, for example New Walls.
    const VBimCommandPropertyField* fields = nullptr; ///< DLL-owned array, copied before Host returns control.
    unsigned int count = 0; ///< Nonzero number of fields.
    bool editTypeEnabled = false; ///< Enables Edit Type only when the DLL supplies a working action.
};

/** @brief Typed edit borrowed for one callback. Number/text are not converted to model units by Host. */
struct VBimCommandPropertyEdit
{
    unsigned int id = 0; ///< Published key.
    VBimCommandPropertyKind kind = VBimCommandPropertyKind::Text; ///< Published editor kind.
    OdString value; ///< Edited text or choice label, never the identity of a choice.
    int selectedIndex = -1; ///< Choice index, otherwise -1.
    bool boolValue = false; ///< Checkbox state, independent of localized text.
};

/** @brief Separate DLL interface; keep alive until Type Selector ends. All calls use the UI thread.
 * Callbacks edit command options only: no transactions, nested commands or reentrant publication.
 * After each callback Host queries the accepted snapshot, including dependent values/readonly states.
 */
class IVBimCommandPropertyPanelHandler
{
public:
    virtual ~IVBimCommandPropertyPanelHandler() = default;
    /** @brief Returns a valid snapshot of accepted values without model writes.
     * @param panel Output borrows DLL data valid until the next handler call; Host immediately copies it.
     * @return False if unavailable. Failed/invalid snapshots leave the previous display intact.
     */
    virtual bool GetProperties(VBimCommandPropertyPanel& panel) = 0;
    /** @brief Validates an edit before updating accepted command state.
     * @param edit Borrowed typed input; use selectedIndex for choices.
     * @return True if accepted; false must leave accepted state unchanged.
     */
    virtual bool OnPropertyChanged(const VBimCommandPropertyEdit& edit) = 0;
    /** @brief Requests a button action; queue command input for work requiring a safe command point.
     * @param id Field key, or zero for Edit Type. No database writes or modal/nested commands here.
     */
    virtual void OnAction(unsigned int id) = 0;
};

class VINABIMCORE_DLLEXPORT VBimUIApplication
{
public:

    // Returns the application singleton.
    // Always valid after VinaBIM startup completes.
    //
    static VBimUIApplication& Instance();

    // Returns a proxy for the currently active document.
    // Returns nullptr when no document is open.
    //
    // Proxy pattern: do NOT cache the returned pointer.
    // The same VBimUIDocument object is reused across document switches.
    // Call ActiveUIDocument() fresh each time it is needed.
    //
    // Analogous to UIApplication.ActiveUIDocument.
    //
    VBimUIDocument* ActiveUIDocument();

    // Runs a registered ODA command on the active document immediately.
    // Returns true if the command was dispatched. Returns false if no document
    // is open, commandName is not registered, its availability check rejects
    // the context, or a command is already running (no nested execution — use
    // RequestPostCommand() from inside a command).
    //
    // Internally calls CVinaBIMDoc::ExecuteCommand().
    //
    bool PostCommand(const OdString& commandName);

    // Returns true if commandName is registered in the ODA command stack
    // (odedRegCmds()->lookupCmd), is available (IsCommandAvailable) and no
    // command is running.
    //
    // Analogous to UIApplication.CanPostCommand().
    //
    bool CanPostCommand(const OdString& commandName) const;

    // Attaches a plugin-owned availability check to commandName, which the
    // plugin registered with odedRegCmds(). Replaces an earlier check for the
    // same name; nullptr removes it. The plugin keeps ownership and must remove
    // the check (pass nullptr) before destroying it, at the latest in uninitApp.
    //
    // Returns eOk, or eInvalidInput when commandName is not registered.
    // UI thread only.
    //
    OdResult SetCommandAvailability(const OdString& commandName, IVBimCommandAvailability* availability);

    // Returns the result of the availability check attached to commandName, or
    // true when none is attached. Used by the ribbon to enable plugin buttons.
    // UI thread only.
    //
    bool IsCommandAvailable(const OdString& commandName) const;

    // Queues commandName to run on the active document at the next safe idle
    // point (after the current command ended), instead of running it nested.
    // At most one command is pending at a time.
    //
    // Returns eOk when queued, eInvalidInput when not registered, eNoDatabase
    // without a document, or eNotApplicable when unavailable or when another
    // command is already pending. Availability is checked again before it
    // runs; a command that became unavailable is dropped and logged.
    // UI thread only.
    //
    // Analogous to UIApplication.PostCommand() in Revit, which also defers.
    //
    OdResult RequestPostCommand(const OdString& commandName);

    // Delivers input to the command blocked in getPoint/getString on the active
    // view, exactly as if the user had typed it on the command line: getPoint
    // raises OdEdOtherInput(input) (a keyword), getString returns input.
    // Lets plugin UI (a pane button, a CommandInput ribbon button) finish or
    // switch a running command without starting a nested one.
    //
    // Returns eOk, or eNotApplicable when no command is waiting for input.
    // The command wakes after the caller returns to the message loop.
    // UI thread only.
    //
    OdResult SubmitCommandInput(const OdString& input);

    // Cancels the command blocked in getPoint/getString on the active view, as
    // ESC does (the command sees OdEdCancel). Returns eOk, or eNotApplicable
    // when no command is waiting for input. UI thread only.
    //
    OdResult CancelWaitingCommand();

    // Returns true while a command is blocked in getPoint/getString on the
    // active view, i.e. while SubmitCommandInput() would be accepted. Use it to
    // enable a plugin pane's Finish/Cancel buttons. UI thread only.
    //
    bool IsWaitingForCommandInput() const;

    /**
     * @brief Takes the view the user dropped from the Project Browser onto the open sheet
     *        when that drop started the running command (the Host starts PLACE_VIEW for it).
     * @details Lets PLACE_VIEW skip its view dialog and go straight to
     *          VBimSelection::PickViewportLocation(). The drop is consumed by the call; pending
     *          drops are discarded when the outermost command ends. No callback is raised and
     *          nothing is written to the database. UI thread only.
     * @param[out] viewId Receives the dropped view id on success; untouched otherwise.
     * @return eOk once per drop; eNotApplicable when the command was not started by a drop
     *         or the drop was already taken.
     */
    OdResult TakeDroppedSheetView(OdBmObjectId& viewId);

    /**
     * @brief Takes the sheet (OdBmDBViewDrafting id) a Project Browser menu action targeted
     *        when it started the running command (Rename, Duplicate or Delete on a sheet item).
     * @details Lets a sheet command act on that sheet instead of the sheet open in the active
     *          view. The target is consumed by the call; pending targets are discarded when the
     *          outermost command ends. No callback is raised and nothing is written to the
     *          database. UI thread only.
     * @param[out] sheetViewId Receives the targeted sheet view id on success; untouched otherwise.
     * @return eOk once per target; eNotApplicable when the command was not started from the
     *         Project Browser or the target was already taken.
     */
    OdResult TakeBrowserTargetSheet(OdBmObjectId& sheetViewId);

    // Replaces the items of the plugin ribbon ComboBox whose ButtonDef::commandName
    // is controlId, and selects selectedIndex (no selection when out of range),
    // e.g. to list the levels or types of the active document. Updates the display
    // only; the control handler is not called.
    //
    // Returns eOk, or eInvalidInput when controlId is not a built ComboBox.
    // UI thread only.
    //
    OdResult SetRibbonComboItems(const OdString& controlId, const std::vector<OdString>& items,
        int selectedIndex);

    // Keyed variant: shows labels[i] and remembers keys[i] for item i, then selects
    // the item whose key is selectedKey (no selection when absent). A user choice
    // reports the key to the IVBimRibbonComboKeyHandler of controlId (and the label
    // to IVBimRibbonControlHandler as before), so items with equal labels — e.g. two
    // levels named alike — stay distinct. Display only; no callback.
    //
    // Returns eOk, or eInvalidInput when controlId is not a built ComboBox or the
    // two vectors differ in size. A later SetRibbonComboItems() drops the keys.
    // UI thread only.
    //
    OdResult SetRibbonComboKeyedItems(const OdString& controlId, const std::vector<OdString>& keys,
        const std::vector<OdString>& labels, const OdString& selectedKey);

    // Selects the item with key in the keyed ComboBox controlId. No callback.
    // Returns eOk, or eInvalidInput for an unknown control / key. UI thread only.
    //
    OdResult SetRibbonComboSelectedKey(const OdString& controlId, const OdString& key);

    // Attaches a plugin-owned key handler to the keyed ComboBox controlId; nullptr
    // removes it. The plugin keeps ownership and removes it before destroying it.
    // Returns eOk, or eInvalidInput for an empty controlId. UI thread only.
    //
    OdResult RegisterRibbonComboKeyHandler(const OdString& controlId,
        VBimRibbon::IVBimRibbonComboKeyHandler* handler);

    // Sets the text shown in the ribbon TextBox controlId, e.g. the value the
    // command uses. No callback. Returns eOk, or eInvalidInput when controlId is
    // not a built TextBox. UI thread only.
    //
    OdResult SetRibbonControlText(const OdString& controlId, const OdString& text);

    // Enables or disables the plugin ribbon control controlId (button, ComboBox,
    // TextBox, Toggle, radio choice); applied on the next ribbon idle update.
    // Plugin availability (IVBimCommandAvailability) can still narrow it.
    // Returns eOk, or eInvalidInput for an unknown control. UI thread only.
    //
    OdResult SetRibbonControlEnabled(const OdString& controlId, bool enabled);

    // Sets the checked state of a plugin Toggle, or (checked = true) makes a radio
    // choice the checked one of its group; applied on the next ribbon idle update.
    // No callback. A Toggle the plugin never set keeps the default MFC state.
    // Returns eOk, or eInvalidInput for an unknown control. UI thread only.
    //
    OdResult SetRibbonControlChecked(const OdString& controlId, bool checked);

    // Shows and activates (show=true) or hides the plugin ribbon tab declared
    // with TabDef::isContextual and this TabDef::contextId. Contextual tabs stay
    // hidden until shown here; on hide, TabDef::returnTab is activated when set.
    // The Host also hides every shown contextual tab when the outermost command
    // ends (normally, on ESC or on error).
    //
    // Returns eOk, or eInvalidInput when no contextual tab has this contextId.
    // UI thread only.
    //
    OdResult ShowContextualTab(const OdString& contextId, bool show);

    /**
     * @brief Shows a dynamic contextual tab with custom panels and controls on the fly.
     * @param tabDef Tab definition containing custom panels, buttons, and returnTab.
     * @return eOk if contextual panels were merged into Modify; eInvalidInput on error.
     */
    OdResult ShowContextualTab(const VBimRibbon::TabDef& tabDef);

    /**
     * @brief Shows a dynamic contextual tab with custom panels and controls on the fly.
     * @param tabName Contextual tab title (e.g. "Modify | My Tool").
     * @param panels List of panel definitions containing custom controls.
     * @param returnTab Category name to return to upon dismissal (default "Architecture").
     * @return eOk if contextual panels were merged into Modify; eInvalidInput on error.
     */
    OdResult ShowContextualTab(const OdString& tabName,
                               const std::vector<VBimRibbon::PanelDef>& panels,
                               const OdString& returnTab = OD_T("Architecture"));

    /**
     * @brief Hides the currently active contextual tab and restores the Modify category.
     * @note Also drops every scope-owned contextual tab (VBimContextualTabScope) and its control
     *       callbacks; those scopes report IsActive() == false afterwards. UI thread only.
     * @return eOk if context was reverted; eInvalidInput if no contextual tab was active.
     */
    OdResult HideContextualTab();

    /**
     * @brief Shows a dynamic contextual tab owned by a scope (used by VBimContextualTabScope).
     *
     * Scope-owned tabs form a stack: the newest one is shown, an older one is suspended and
     * shown again (with its control callbacks) when every newer one is popped.
     * ComboBox, TextBox, CheckBox/Toggle and RadioButtonGroup controls with a commandName report
     * value changes to @p callback while this entry is on top.
     * @param tabDef Tab definition (name must be non-empty).
     * @param callback Optional control value callback; copied, invoked on the UI thread.
     * @param[out] outToken Ownership token, 0 on failure.
     * @return eOk if shown; eInvalidInput for an empty name or when the ribbon refused the tab.
     */
    OdResult PushContextualTab(const VBimRibbon::TabDef& tabDef,
        std::function<void(const OdString&, const OdString&)> callback, OdUInt64& outToken);

    /**
     * @brief Shows a registered contextual tab (TabDef::contextId) owned by a scope.
     * @param contextId Context identifier of a tab registered with isContextual = true.
     * @param[out] outToken Ownership token, 0 on failure.
     * @return eOk if shown; eInvalidInput when no contextual tab has this contextId.
     */
    OdResult PushContextualTab(const OdString& contextId, OdUInt64& outToken);

    /**
     * @brief Releases a scope-owned contextual tab. Hides it when it is on top and shows the
     *        next older entry again; a suspended entry is just dropped. Unknown tokens are ignored.
     * @param token Token returned by PushContextualTab.
     */
    void PopContextualTab(OdUInt64 token) noexcept;

    /**
     * @brief Checks whether a scope-owned contextual tab is still owned (shown or suspended).
     * @param token Token returned by PushContextualTab.
     * @return True while the entry exists.
     */
    bool IsContextualTabOwned(OdUInt64 token) const noexcept;

    // Shows typeIds (wall types, door/window family symbols, ...) in the
    // Properties Type Selector for the running command and selects `selected`
    // (none when not in the list). Family types are shown as "Family : Type",
    // other types by element name. Choosing a type calls handler->OnTypeChanged.
    // While the session is active, selection and active-view updates of the
    // Properties pane leave this list alone. Calling it again with the same
    // handler replaces the list; another handler is refused until the owner
    // ends. The handler is borrowed: the Host drops it when the outermost
    // command ends (normally, on ESC or on error) or on EndTypeSelection();
    // call EndTypeSelection() yourself before destroying the handler.
    //
    // Returns eOk when the list is shown; eNotApplicable when no command is
    // running, another handler owns the session or the Properties pane could
    // not show any item; eInvalidInput for a null handler or when no id opens
    // as an element. UI thread only.
    //
    OdResult BeginTypeSelection(const OdBmObjectIdArray& typeIds, const OdBmObjectId& selected,
        IVBimTypeSelectorHandler* handler);

    // Ends the Type Selector session, clears the type list and gives the
    // Properties pane back its normal context (first selected element, or the
    // active view). No-op when none is active. UI thread only.
    //
    void EndTypeSelection();

    /**
     * @brief Checks whether @p handler owns the active Type Selector session.
     * @details Lets a scope end only its own session: call EndTypeSelection() only when this
     *          returns true, so another owner's (e.g. an outer command's) session is left alone.
     * @param handler Handler passed to BeginTypeSelection(); nullptr returns false.
     * @return True while @p handler is the current session owner. UI thread only.
     */
    bool IsTypeSelectionOwner(const IVBimTypeSelectorHandler* handler) const noexcept;

    /**
     * @brief Displays controls on the Option Bar situated directly below the Ribbon, displaying the active command.
     * @param commandName Name of the active command to display prominently.
     * @param items List of control descriptors to create and display.
     * @param callback Callback invoked when any control value is modified by the user.
     * @return eOk if Option Bar was populated; eNotApplicable if host window is unavailable.
     */
    OdResult ShowOptionBar(const OdString& commandName,
        const std::vector<vb::ui::optionbar::OptionItem>& items,
        vb::ui::optionbar::OptionBarCallback callback);

    /**
     * @brief Displays controls on the Option Bar situated directly below the Ribbon.
     * @param items List of control descriptors to create and display.
     * @param callback Callback invoked when any control value is modified by the user.
     * @return eOk if Option Bar was populated; eNotApplicable if host window is unavailable.
     */
    OdResult ShowOptionBar(const std::vector<vb::ui::optionbar::OptionItem>& items,
        vb::ui::optionbar::OptionBarCallback callback);

    /**
     * @brief Sets or updates the active command name displayed on the Option Bar.
     * @param commandName Active command name.
     * @return eOk on success, eNotApplicable if Option Bar is unavailable.
     */
    OdResult SetOptionBarActiveCommand(const OdString& commandName);

    /**
     * @brief Updates the value of an existing control on the Option Bar (Code -> UI).
     * @param id Identifier of the control to update.
     * @param item New control state snapshot.
     * @return eOk on success, eNotApplicable if control or Option Bar is unavailable.
     */
    OdResult SetOptionBarValue(int id, const vb::ui::optionbar::OptionItem& item);

    /**
     * @brief Clears all controls from the Option Bar and restores it to the idle empty state.
     * @note Also drops every scope-owned Option Bar entry (VBimOptionBarScope); those scopes
     *       report IsActive() == false afterwards. UI thread only.
     */
    void HideOptionBar();

    /**
     * @brief Shows Option Bar controls owned by a scope (used by VBimOptionBarScope).
     *
     * Scope-owned entries form a stack: the newest is shown; an older one is suspended and
     * shown again, with the values the user last chose, when every newer one is popped.
     * ShowOptionBar() / SetOptionBarValue() called while an entry is on top modify that entry;
     * ShowOptionBar() called by a nested command instead shows a new entry of its own, which the
     * Host drops when that command ends, so the outer command's controls come back unchanged.
     * @param commandName Command name shown at the left; empty keeps the currently shown name.
     * @param items Control descriptors (copied).
     * @param callback Change callback (copied), invoked on the UI thread after the entry's
     *        stored values are updated. It may push/pop entries or call SetValue safely.
     * @param[out] outToken Ownership token, 0 on failure.
     * @return eOk if shown; eNotApplicable if the Option Bar window is unavailable.
     */
    OdResult PushOptionBar(const OdString& commandName,
        const std::vector<vb::ui::optionbar::OptionItem>& items,
        vb::ui::optionbar::OptionBarCallback callback, OdUInt64& outToken);

    /**
     * @brief Releases a scope-owned Option Bar entry. When it is on top the next older entry is
     *        shown again, or the bar is cleared; a suspended entry is just dropped.
     * @param token Token returned by PushOptionBar; unknown tokens are ignored.
     */
    void PopOptionBar(OdUInt64 token) noexcept;

    /**
     * @brief Checks whether a scope-owned Option Bar entry is the one currently shown.
     * @param token Token returned by PushOptionBar.
     * @return True if the entry exists and is on top.
     */
    bool IsOptionBarOwner(OdUInt64 token) const noexcept;

    /**
     * @brief Enables or disables an Option Bar control (Code -> UI); no callback is fired.
     * @param id Control ID.
     * @param enabled New enabled state.
     * @return eOk on success; eInvalidInput for an unknown id; eNotApplicable without Option Bar.
     */
    OdResult SetOptionBarEnabled(int id, bool enabled);

    /**
     * @brief Host-internal: re-shows the top scope-owned Option Bar entry after the Host replaced
     *        the bar content (e.g. a nested command ended). UI thread only.
     * @return True if an entry was shown; false when no scope owns the bar.
     */
    bool RestoreOptionBarOwner();

    /**
     * @brief Host-internal: drops the Option Bar entries that legacy ShowOptionBar() calls created
     *        inside commands deeper than @p commandDepth, i.e. commands that have just ended.
     *        Scope-owned entries are kept (their scope pops them). Call before
     *        RestoreOptionBarOwner() so an outer command gets its own controls back. UI thread only.
     * @param commandDepth Command nesting depth after the ended command was removed (0 = none running).
     */
    void DropEndedCommandOptionBarEntries(int commandDepth) noexcept;

    /** @brief Replaces the Properties grid with command options owned by the active Type Selector.
     * @param owner Must be the handler that successfully began the current Type Selector session.
     * @param rows Borrowed descriptors, copied before return; no database objects are created.
     * @param count Number of rows, nonzero.
     * @param handler Borrowed callback; keep alive until EndTypeSelection or command completion.
     * @return eOk on display, eInvalidInput for malformed rows, eNotApplicable for another owner or missing pane.
     * @pre UI thread, running command. EndTypeSelection releases both contexts. No STL ownership crosses this API.
     */
    OdResult SetCommandProperties(IVBimTypeSelectorHandler* owner, const VBimCommandProperty* rows,
        unsigned int count, IVBimCommandPropertiesHandler* handler);

    /** @brief Publishes a typed grouped panel owned by the active Type Selector, replacing its grid only.
     * @param owner Handler that successfully acquired BeginTypeSelection; borrowed until session end.
     * @param handler DLL provider of copied rows and callbacks; must outlive the session.
     * @return eOk, eInvalidInput for malformed snapshots, eNotApplicable for missing/wrong context or reentrancy.
     * @pre UI thread, running command, same MSVC/CRT and ODA major. No DB writes or MFC types cross this API.
     * @note Refreshes dependent rows after callbacks. EndTypeSelection/command teardown drops all callbacks.
     */
    OdResult SetCommandPropertyPanel(IVBimTypeSelectorHandler* owner, IVBimCommandPropertyPanelHandler* handler);

    // Returns the application event manager for subscribing to SDK events.
    // Returns a valid pointer after VinaBIM startup completes; never nullptr.
    //
    VBimEventManager* EventManager();

    // Returns the dockable pane registry for registering SDK-owned panes.
    // RegisterPane() must be called early (before the main frame is shown).
    // ShowPane() triggers lazy pane creation if the main frame is ready.
    //
    VBimDockablePaneRegistry* DockablePaneRegistry();

    // Returns the application progress service (loading dialog facade).
    // Returns the same process-lifetime object on every call; never nullptr.
    //
    // UI-thread only. BeginProgress()/EndProgress() must stay balanced; the
    // main window is disabled while a session is active.
    //
    VBimProgressService* ProgressService();

    // Returns the application task dialog service (modal message dialogs
    // parented to the main frame). Returns the same process-lifetime object
    // on every call; never nullptr.
    //
    // UI-thread only. Every Show*() call runs a modal loop.
    //
    // Analogous to Autodesk.Revit.UI.TaskDialog.
    //
    VBimTaskDialogService* TaskDialogService();

    /**
     * @brief Returns the Host's shared HTTP client for network communication.
     * @details Pre-configured with Host bearer authentication, connection pooling,
     *          and channel TLS policies. Safe to call concurrently from any thread.
     *          Network requests block the calling thread; do not call Send/Download/Upload
     *          from the UI thread (use a worker thread instead).
     * @note Security boundary: AuthMode::Bearer is restricted to official VinaBIM API domains.
     *       Requests to third-party endpoints must use AuthMode::None.
     *       Shutdown() on the returned client is ignored; plugins must cancel operations via
     *       their own cancellation tokens or timeouts.
     * @return Pointer to IHttpClient; never nullptr after VinaBIM startup completes.
     */
    vb::net::IHttpClient* NetworkClient();

    /**
     * @brief Returns the Win32 window handle of the Host main frame window.
     *
     * Provides a safe parent window handle for modal dialogs and message boxes
     * instantiated by plugins, ensuring proper z-order and taskbar behavior.
     *
     * @return HWND The Win32 window handle of CMainFrame, or nullptr if not available.
     * @note UI-thread only. Non-owning handle.
     *       Analogous to Autodesk.Revit.UI.UIApplication.MainWindowHandle.
     */
    HWND MainWindowHandle() const;

    // Registers a plugin-owned external event handler and returns its id.
    // Returns 0 for a null handler or a handler that is already registered.
    //
    // The plugin keeps ownership; call UnregisterExternalEvent() before
    // destroying the handler, and in any case from uninitApp. UI thread only.
    //
    VBimExternalEventId RegisterExternalEvent(IVBimExternalEventHandler* handler);

    // Requests one Execute() call of the handler at the next safe UI idle point.
    // Callable from any thread. At most one request per id is pending: raising
    // again before it runs does not queue a second call.
    //
    // Returns eOk when queued or already pending, eNotApplicable for an unknown
    // or unregistered id and after application shutdown began.
    //
    OdResult RaiseExternalEvent(VBimExternalEventId id) noexcept;

    // Unregisters the handler and cancels its pending request. After return the
    // Host never calls the handler again, so it may be destroyed. Safe to call
    // from inside the handler's own Execute(). No-op for unknown ids.
    // UI thread only.
    //
    void UnregisterExternalEvent(VBimExternalEventId id) noexcept;

    // Attaches a plugin-owned handler to the ribbon ComboBox / TextBox /
    // RadioButtonGroup whose ButtonDef::commandName is controlId; nullptr
    // removes it. May be called before or after the ribbon item is built.
    // The plugin keeps ownership and removes the handler before unloading.
    //
    // Returns eOk, or eInvalidInput for an empty controlId. UI thread only.
    //
    OdResult RegisterRibbonControlHandler(const OdString& controlId,
        VBimRibbon::IVBimRibbonControlHandler* handler);

    // Non-copyable singleton.
    VBimUIApplication(const VBimUIApplication&)            = delete;
    VBimUIApplication& operator=(const VBimUIApplication&) = delete;

private:
    VBimUIApplication() = default;
};
