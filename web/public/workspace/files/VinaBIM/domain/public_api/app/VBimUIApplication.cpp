#include "pch.h"
#include "domain/public_api/app/VBimUIApplication.h"
#include "domain/public_api/app/VBimUIDocument.h"
#include "domain/public_api/events/VBimEventManager.h"
#include "domain/public_api/ui/VBimDockablePaneRegistry.h"
#include "domain/public_api/ui/VBimProgressService.h"
#include "domain/public_api/ui/VBimTaskDialogService.h"
#include "domain/public_api/net/VBimHttp.h"
#include "shared/net/VbHttp.h"
#include "Host/services/net/BuildChannelFlags.h"
#include "Host/services/net/AppEndpoints.h"
#include "Host/services/net/NetworkServices.h"
#include "Host/application/VinaBIM.h"   // theApp (CVinaBIMApp)
#include "Host/frame/MainFrm.h"         // CMainFrame
#include "Host/Document/VinaBIMDoc.h"   // CVinaBIMDoc::ExecuteCommand
#include "Host/view/VinaBIMView.h"      // CVinaBIMView::OnCommandWnd
#include "Ed/EdCommandStack.h"          // odedRegCmds, OdEdCommandPtr
#include "Host/sdk/ChangeTracking/VBimChangeTracker.h"  // IsCommandRunning
#include "Host/sdk/ViewportPlacement/VBimViewportPlacementHost.h"  // dropped sheet view
#include "Host/ui/ribbon/RibbonCommandDispatcher.h"      // value-control handlers
#include "Host/ui/ribbon/RibbonHostApi.h"                // contextual tabs
#include "Host/ui/optionbar/VBimOptionBar.h"            // Option Bar
#include "domain/vinaBIMCore/vbedvds.h"                  // vbimGetPickFirst
#include "Database/BmElement.h"
#include "Family/Entities/BmFamily.h"
#include "Family/Entities/BmFamilySymbol.h"

#include <algorithm>
#include <functional>
#include <map>
#include <set>
#include <cmath>
#include <cwchar>
#include <cwctype>
#include <memory>
#include <optional>

// VBimUIApplication — singleton facade over CVinaBIMApp.
// All methods assume UI-thread context (no synchronization added).

namespace {

// Keyed by upper-case global command name, the form odedRegCmds() matches.
std::map<OdString, IVBimCommandAvailability*> s_availability;

// Handler of the active plugin Type Selector session; null when none.
IVBimTypeSelectorHandler* s_typeSelector = nullptr;

// ── Scope-owned Option Bar entries (VBimOptionBarScope) ─────────────────────
// A stack: back() is shown, older entries are suspended and shown again when
// every newer one is popped. Items track what the user chose so a restored
// entry shows the user's last values.
struct OptionBarEntry
{
    OdUInt64 token = 0;
    std::wstring commandName;
    std::vector<vb::ui::optionbar::OptionItem> items;
    vb::ui::optionbar::OptionBarCallback callback;
    int commandDepth = 0;   ///< ODA command nesting depth when the entry was created.
    bool legacy = false;    ///< Created by ShowOptionBar() without a scope; dropped when its command ends.
};
std::vector<OptionBarEntry> s_optionBarStack;
OdUInt64 s_nextUiToken = 1;

CVBimOptionBar* HostOptionBar()
{
    CMainFrame* pMain = theApp.GetMainFrame();
    return pMain ? pMain->GetOptionBar() : nullptr;
}

OptionBarEntry* FindOptionBarEntry(OdUInt64 token)
{
    for (auto& entry : s_optionBarStack)
    {
        if (entry.token == token)
            return &entry;
    }
    return nullptr;
}

// Copies the value field of the stored item's own type (see CVBimOptionBar::SetValue).
void MergeOptionValue(vb::ui::optionbar::OptionItem& stored, const vb::ui::optionbar::OptionItem& item)
{
    using vb::ui::optionbar::OptionType;
    switch (stored.type)
    {
    case OptionType::Number: stored.numVal = item.numVal; break;
    case OptionType::Check:  stored.checked = item.checked; break;
    default:                 stored.textVal = item.textVal; break;
    }
}

// Stores the user's choice in the entry, then forwards it to the plugin callback.
void OnScopedOptionChanged(OdUInt64 token, int id, const vb::ui::optionbar::OptionItem& item)
{
    OptionBarEntry* pEntry = FindOptionBarEntry(token);
    if (!pEntry)
        return;
    for (auto& stored : pEntry->items)
    {
        if (stored.id == id)
        {
            stored = item;
            break;
        }
    }
    // Copy: the callback may pop this entry.
    const vb::ui::optionbar::OptionBarCallback callback = pEntry->callback;
    if (callback)
        callback(id, item);
}

void ShowOptionBarEntry(CVBimOptionBar* pBar, const OptionBarEntry& entry)
{
    const OdUInt64 token = entry.token;
    pBar->Populate(entry.commandName, entry.items,
        [token](int id, const vb::ui::optionbar::OptionItem& item)
        {
            OnScopedOptionChanged(token, id, item);
        });
}

// Top entry when the running command created it (same nesting depth): the only
// entry a legacy ShowOptionBar()/SetOptionBarActiveCommand() call may modify.
// An outer command's entry is never modified by a nested command.
OptionBarEntry* CurrentDepthTopEntry()
{
    if (s_optionBarStack.empty())
        return nullptr;
    OptionBarEntry& top = s_optionBarStack.back();
    return top.commandDepth == VBimChangeTracker::CommandDepth() ? &top : nullptr;
}

// Pushes an owner-less entry for a legacy ShowOptionBar() call of the running
// command, so an outer command's controls stay stored underneath it.
void PushLegacyOptionBarEntry(CVBimOptionBar* pBar, const std::wstring& commandName,
    const std::vector<vb::ui::optionbar::OptionItem>& items, vb::ui::optionbar::OptionBarCallback callback)
{
    OptionBarEntry entry;
    entry.token = s_nextUiToken++;
    entry.commandName = commandName;
    entry.items = items;
    entry.callback = std::move(callback);
    entry.commandDepth = VBimChangeTracker::CommandDepth();
    entry.legacy = true;
    s_optionBarStack.push_back(std::move(entry));
    ShowOptionBarEntry(pBar, s_optionBarStack.back());
}

// ── Scope-owned contextual tabs (VBimContextualTabScope) ────────────────────

using ContextualControlCallback = std::function<void(const OdString&, const OdString&)>;

// >0 while a contextual control callback runs; bridges released meanwhile are
// kept alive in s_retiredBridges because the dispatcher still holds their pointer.
int s_ribbonDispatchDepth = 0;

// Routes IVBimRibbonControlHandler calls of one scope-owned tab to its callback.
class ContextualTabControlBridge final : public VBimRibbon::IVBimRibbonControlHandler
{
public:
    explicit ContextualTabControlBridge(ContextualControlCallback callback)
        : m_callback(std::move(callback))
    {
    }

    void OnValueChanged(const OdString& controlId, const OdString& value) override
    {
        // Copy: the callback may pop the entry that owns this bridge.
        const ContextualControlCallback callback = m_callback;
        struct DepthGuard
        {
            DepthGuard() { ++s_ribbonDispatchDepth; }
            ~DepthGuard() { --s_ribbonDispatchDepth; }
        } guard;
        if (callback)
            callback(controlId, value);
    }

private:
    ContextualControlCallback m_callback;
};

struct ContextualTabEntry
{
    OdUInt64 token = 0;
    bool dynamic = false;              ///< true: tabDef; false: registered contextId.
    VBimRibbon::TabDef tabDef;
    OdString contextId;
    std::shared_ptr<ContextualTabControlBridge> bridge;
    std::vector<OdString> controlIds;  ///< Value controls routed to bridge.
};
std::vector<ContextualTabEntry> s_contextualStack;
std::vector<std::shared_ptr<ContextualTabControlBridge>> s_retiredBridges;

void RetireBridge(std::shared_ptr<ContextualTabControlBridge> bridge)
{
    if (bridge && s_ribbonDispatchDepth > 0)
        s_retiredBridges.push_back(std::move(bridge));
}

void PurgeRetiredBridges()
{
    if (s_ribbonDispatchDepth == 0)
        s_retiredBridges.clear();
}

void RegisterEntryHandlers(const ContextualTabEntry& entry, bool enable)
{
    for (const auto& id : entry.controlIds)
        VBimUIApplication::Instance().RegisterRibbonControlHandler(id, enable ? entry.bridge.get() : nullptr);
}

OdResult ActivateContextualEntry(const ContextualTabEntry& entry)
{
    const OdResult res = entry.dynamic
        ? VBimUIApplication::Instance().ShowContextualTab(entry.tabDef)
        : VBimUIApplication::Instance().ShowContextualTab(entry.contextId, true);
    if (res == eOk && entry.bridge)
        RegisterEntryHandlers(entry, true);
    return res;
}

void DeactivateContextualEntry(const ContextualTabEntry& entry)
{
    if (entry.bridge)
        RegisterEntryHandlers(entry, false);
    if (entry.dynamic)
        VbimRibbon::RibbonHostApi::Instance().HideContextualTab();
    else
        VbimRibbon::RibbonHostApi::Instance().ShowContextualTab(std::wstring(entry.contextId.c_str()), false);
}

// Value controls of a dynamic tab that report to the scope callback.
std::vector<OdString> CollectValueControlIds(const VBimRibbon::TabDef& tabDef)
{
    std::vector<OdString> ids;
    for (const auto& panel : tabDef.panels)
    {
        for (const auto& btn : panel.buttons)
        {
            if (btn.commandName.isEmpty())
                continue;
            if (btn.kind == VBimRibbon::ButtonKind::ComboBox ||
                btn.kind == VBimRibbon::ButtonKind::TextBox ||
                btn.kind == VBimRibbon::ButtonKind::CheckBox ||
                btn.kind == VBimRibbon::ButtonKind::RadioButtonGroup)
            {
                ids.push_back(btn.commandName);
            }
        }
    }
    return ids;
}

OdResult PushContextualEntry(ContextualTabEntry entry, OdUInt64& outToken)
{
    PurgeRetiredBridges();
    entry.token = s_nextUiToken++;

    // The Host shows one contextual tab at a time: suspend the current owner.
    if (!s_contextualStack.empty() && s_contextualStack.back().bridge)
        RegisterEntryHandlers(s_contextualStack.back(), false);

    const OdResult res = ActivateContextualEntry(entry);
    if (res != eOk)
    {
        if (!s_contextualStack.empty())
            ActivateContextualEntry(s_contextualStack.back());
        return res;
    }
    outToken = entry.token;
    s_contextualStack.push_back(std::move(entry));
    return eOk;
}

bool IsFiniteCommandPropertyNumber(const wchar_t* text)
{
    wchar_t* end = nullptr;
    const double number = std::wcstod(text, &end);
    if (end == text || !std::isfinite(number))
        return false;
    while (*end && std::iswspace(*end))
        ++end;
    return *end == 0;
}

// Stage the complete snapshot before replacing any displayed rows or callback metadata.
bool CopyCommandPropertyPanel(const VBimCommandPropertyPanel& panel, std::vector<VbPropertyRow>& rows,
    std::map<unsigned int, VBimCommandPropertyKind>& kinds)
{
    if (!panel.fields || !panel.count)
        return false;
    std::vector<VbPropertyRow> copied;
    std::map<unsigned int, VBimCommandPropertyKind> copiedKinds;
    for (unsigned int i = 0; i < panel.count; ++i)
    {
        const VBimCommandPropertyField& field = panel.fields[i];
        if (!field.id || field.label.isEmpty() || !copiedKinds.emplace(field.id, field.kind).second)
            return false;
        VbPropertyRow row;
        row.stableKey.Format(L"param:%u", field.id);
        row.groupName = field.group.c_str();
        row.displayName = field.label.c_str();
        row.displayValue = field.value.c_str();
        row.readOnly = field.readOnly;
        row.isCommandProperty = true;
        switch (field.kind)
        {
        case VBimCommandPropertyKind::Text:
            row.editorType = VbPropertyEditorType::TextEdit;
            break;
        case VBimCommandPropertyKind::Number:
            if (!IsFiniteCommandPropertyNumber(field.value.c_str()))
                return false;
            row.valueType = VbPropertyValueType::Double;
            row.editorType = VbPropertyEditorType::NumberEdit;
            break;
        case VBimCommandPropertyKind::Choice:
            if (!field.choices || !field.choiceCount || field.selectedIndex < 0
                || static_cast<unsigned int>(field.selectedIndex) >= field.choiceCount)
                return false;
            row.valueType = VbPropertyValueType::Enum;
            row.editorType = VbPropertyEditorType::ComboBox;
            row.selectedOptionIndex = field.selectedIndex;
            row.displayValue = field.choices[field.selectedIndex].c_str();
            for (unsigned int j = 0; j < field.choiceCount; ++j)
            {
                VbPropertyOption option;
                option.key.Format(L"%u", j);
                option.text = field.choices[j].c_str();
                row.options.push_back(std::move(option));
            }
            break;
        case VBimCommandPropertyKind::Boolean:
            row.valueType = VbPropertyValueType::Bool;
            row.editorType = VbPropertyEditorType::CheckBox;
            row.boolValue = field.boolValue;
            break;
        case VBimCommandPropertyKind::Action:
            row.editorType = VbPropertyEditorType::Button;
            break;
        default:
            return false;
        }
        copied.push_back(std::move(row));
    }
    rows = std::move(copied);
    kinds = std::move(copiedKinds);
    return true;
}

OdString CommandKey(const OdString& commandName)
{
    OdString key(commandName);
    key.makeUpper();
    return key;
}

bool IsRegistered(const OdString& commandName)
{
    return !odedRegCmds()->lookupCmd(commandName).isNull();
}

bool IsBusy()
{
    return VBimChangeTracker::IsCommandRunning() || theApp.IsSomeCommandActive();
}

// Runs the command queued by RequestPostCommand. Driven by the external event
// dispatcher, so it only executes at a safe idle point on the UI thread.
class PostedCommandRunner : public IVBimExternalEventHandler
{
public:
    OdString pending;

    void Execute(VBimUIApplication& app) override
    {
        const OdString cmd = pending;
        pending.empty();
        if (cmd.isEmpty())
            return;
        CVinaBIMDoc* pDoc = theApp.GetActiveDocument();
        if (!pDoc || !IsRegistered(cmd) || !app.IsCommandAvailable(cmd))
        {
            CString msg;
            msg.Format(L"[SDK] Posted command %s dropped: no document or no longer available.", cmd.c_str());
            LOG(msg);
            return;
        }
        pDoc->ExecuteCommand(cmd);
    }
};

PostedCommandRunner s_postedCommand;
VBimExternalEventId s_postedCommandEventId = 0;

} // namespace

VBimUIApplication& VBimUIApplication::Instance()
{
    static VBimUIApplication s_instance;
    return s_instance;
}

VBimUIDocument* VBimUIApplication::ActiveUIDocument()
{
    CVinaBIMDoc* pDoc = theApp.GetActiveDocument();
    if (!pDoc)
        return nullptr;

    // Proxy pattern: single static instance reused per call.
    // Caller must NOT cache the returned pointer.
    static VBimUIDocument s_proxy;
    s_proxy.SetInternalDoc(pDoc);
    return &s_proxy;
}

bool VBimUIApplication::PostCommand(const OdString& commandName)
{
    CVinaBIMDoc* pDoc = theApp.GetActiveDocument();
    if (!pDoc || !CanPostCommand(commandName))
        return false;

    pDoc->ExecuteCommand(commandName);
    return true;
}

bool VBimUIApplication::CanPostCommand(const OdString& commandName) const
{
    // lookupCmd uses kGlobal|kLocal by default.
    return IsRegistered(commandName) && IsCommandAvailable(commandName) && !IsBusy();
}

OdResult VBimUIApplication::SetCommandAvailability(const OdString& commandName,
    IVBimCommandAvailability* availability)
{
    if (!availability)
    {
        s_availability.erase(CommandKey(commandName));
        return eOk;
    }
    if (!IsRegistered(commandName))
        return eInvalidInput;
    s_availability[CommandKey(commandName)] = availability;
    return eOk;
}

bool VBimUIApplication::IsCommandAvailable(const OdString& commandName) const
{
    const auto it = s_availability.find(CommandKey(commandName));
    if (it == s_availability.end())
        return true;
    // A check whose command was already removed belongs to a plugin that may be
    // unloading; do not call into it.
    if (!IsRegistered(commandName))
        return false;
    try
    {
        return it->second->IsCommandAvailable(VBimUIApplication::Instance());
    }
    catch (...)
    {
        CString msg;
        msg.Format(L"[SDK] Availability check of %s threw; treated as unavailable.", commandName.c_str());
        LOG(msg);
        return false;
    }
}

OdResult VBimUIApplication::RegisterRibbonControlHandler(const OdString& controlId,
    VBimRibbon::IVBimRibbonControlHandler* handler)
{
    if (controlId.isEmpty())
        return eInvalidInput;
    VbimRibbon::RibbonCommandDispatcher::SetValueHandler(std::wstring(controlId.c_str()), handler);
    return eOk;
}

OdResult VBimUIApplication::RequestPostCommand(const OdString& commandName)
{
    if (!IsRegistered(commandName))
        return eInvalidInput;
    if (!theApp.GetActiveDocument())
        return eNoDatabase;
    if (!IsCommandAvailable(commandName) || !s_postedCommand.pending.isEmpty())
        return eNotApplicable;

    if (s_postedCommandEventId == 0)
        s_postedCommandEventId = RegisterExternalEvent(&s_postedCommand);
    s_postedCommand.pending = commandName;
    const OdResult res = RaiseExternalEvent(s_postedCommandEventId);
    if (res != eOk)
        s_postedCommand.pending.empty();
    return res;
}

bool VBimUIApplication::IsWaitingForCommandInput() const
{
    CVinaBIMView* pView = theApp.GetActiveView();
    return pView && pView->isWaitingForInput();
}

OdResult VBimUIApplication::TakeDroppedSheetView(OdBmObjectId& viewId)
{
    return VBimTakePendingSheetViewDrop(theApp.GetActiveDocument(), viewId) ? eOk : eNotApplicable;
}

OdResult VBimUIApplication::TakeBrowserTargetSheet(OdBmObjectId& sheetViewId)
{
    return VBimTakePendingBrowserTargetSheet(theApp.GetActiveDocument(), sheetViewId) ? eOk : eNotApplicable;
}

OdResult VBimUIApplication::SubmitCommandInput(const OdString& input)
{
    if (!IsWaitingForCommandInput())
        return eNotApplicable;
    // Same path as the command-line window, so prompts and keywords behave alike.
    theApp.GetActiveView()->OnCommandWnd(input, FALSE, FALSE);
    return eOk;
}

OdResult VBimUIApplication::CancelWaitingCommand()
{
    if (!IsWaitingForCommandInput())
        return eNotApplicable;
    theApp.GetActiveView()->OnCommandWnd(OdString(), TRUE, TRUE);
    return eOk;
}

OdResult VBimUIApplication::SetRibbonComboItems(const OdString& controlId, const std::vector<OdString>& items,
    int selectedIndex)
{
    std::vector<std::wstring> texts;
    texts.reserve(items.size());
    for (const OdString& item : items)
        texts.emplace_back(item.c_str());
    return VbimRibbon::RibbonCommandDispatcher::SetComboItems(std::wstring(controlId.c_str()), texts, selectedIndex)
        ? eOk : eInvalidInput;
}

OdResult VBimUIApplication::SetRibbonComboKeyedItems(const OdString& controlId, const std::vector<OdString>& keys,
    const std::vector<OdString>& labels, const OdString& selectedKey)
{
    std::vector<std::wstring> keyTexts;
    std::vector<std::wstring> labelTexts;
    keyTexts.reserve(keys.size());
    labelTexts.reserve(labels.size());
    for (const OdString& key : keys)
        keyTexts.emplace_back(key.c_str());
    for (const OdString& label : labels)
        labelTexts.emplace_back(label.c_str());
    return VbimRibbon::RibbonCommandDispatcher::SetComboKeyedItems(std::wstring(controlId.c_str()), keyTexts,
        labelTexts, std::wstring(selectedKey.c_str())) ? eOk : eInvalidInput;
}

OdResult VBimUIApplication::SetRibbonComboSelectedKey(const OdString& controlId, const OdString& key)
{
    return VbimRibbon::RibbonCommandDispatcher::SetComboSelectedKey(std::wstring(controlId.c_str()),
        std::wstring(key.c_str())) ? eOk : eInvalidInput;
}

OdResult VBimUIApplication::RegisterRibbonComboKeyHandler(const OdString& controlId,
    VBimRibbon::IVBimRibbonComboKeyHandler* handler)
{
    if (controlId.isEmpty())
        return eInvalidInput;
    VbimRibbon::RibbonCommandDispatcher::SetComboKeyHandler(std::wstring(controlId.c_str()), handler);
    return eOk;
}

OdResult VBimUIApplication::SetRibbonControlText(const OdString& controlId, const OdString& text)
{
    return VbimRibbon::RibbonCommandDispatcher::SetEditText(std::wstring(controlId.c_str()),
        std::wstring(text.c_str())) ? eOk : eInvalidInput;
}

OdResult VBimUIApplication::SetRibbonControlEnabled(const OdString& controlId, bool enabled)
{
    const std::wstring name(controlId.c_str());
    if (VbimRibbon::RibbonCommandDispatcher::FindCommandId(name) == 0)
        return eInvalidInput;
    VbimRibbon::RibbonCommandDispatcher::SetCommandEnabled(name, enabled);
    return eOk;
}

OdResult VBimUIApplication::SetRibbonControlChecked(const OdString& controlId, bool checked)
{
    return VbimRibbon::RibbonCommandDispatcher::SetChecked(std::wstring(controlId.c_str()), checked)
        ? eOk : eInvalidInput;
}

OdResult VBimUIApplication::BeginTypeSelection(const OdBmObjectIdArray& typeIds, const OdBmObjectId& selected,
    IVBimTypeSelectorHandler* handler)
{
    if (!handler)
        return eInvalidInput;
    // One owner at a time: the same handler may refresh its list, another one
    // (e.g. a nested command) must wait until the owner ends its session.
    if (!IsBusy() || (s_typeSelector && s_typeSelector != handler))
        return eNotApplicable;
    CMainFrame* pMain = theApp.GetMainFrame();
    if (!pMain)
        return eNotApplicable;

    std::vector<CDockableProperties::ExternalTypeItem> items;
    for (const OdBmObjectId& id : typeIds)
    {
        const OdBmElementPtr element = OdBmElement::cast(id.openObject());
        if (element.isNull())
            continue;
        CDockableProperties::ExternalTypeItem item;
        const OdBmFamilySymbolPtr symbol = OdBmFamilySymbol::cast(element);
        const OdBmFamilyPtr family = symbol.isNull() ? OdBmFamilyPtr() : OdBmFamily::cast(symbol->getFamilyId().openObject());
        item.displayText = family.isNull()
            ? std::wstring(element->getElementName().c_str())
            : std::wstring((family->getElementName() + L" : " + element->getTypeName()).c_str());
        item.typeIdToken = static_cast<std::uint64_t>(OBJID2DWORDPTR(id));
        items.push_back(std::move(item));
    }
    if (items.empty())
        return eInvalidInput;

    const bool shown = pMain->BeginExternalTypeSelection(items, static_cast<std::uint64_t>(OBJID2DWORDPTR(selected)),
        [](std::uint64_t token)
        {
            IVBimTypeSelectorHandler* pHandler = s_typeSelector;
            if (!pHandler)
                return;
            try
            {
                pHandler->OnTypeChanged(DWORDPTR2OBJID(static_cast<DWORD_PTR>(token)));
            }
            catch (...)
            {
                LOG(L"[SDK] Type Selector handler threw an exception.");
            }
        });
    if (!shown)
    {
        // A replaced list that failed leaves no session in the pane.
        s_typeSelector = nullptr;
        return eNotApplicable;
    }
    s_typeSelector = handler;
    return eOk;
}

OdResult VBimUIApplication::SetCommandProperties(IVBimTypeSelectorHandler* owner,
    const VBimCommandProperty* rows, unsigned int count, IVBimCommandPropertiesHandler* handler)
{
    if (!owner || !rows || !count || !handler)
        return eInvalidInput;
    if (!IsBusy() || s_typeSelector != owner)
        return eNotApplicable;
    CMainFrame* pMain = theApp.GetMainFrame();
    if (!pMain)
        return eNotApplicable;
    std::vector<VbPropertyRow> copied;
    std::set<unsigned int> keys;
    for (unsigned int i = 0; i < count; ++i)
    {
        const VBimCommandProperty& field = rows[i];
        if (!field.id || !keys.insert(field.id).second || field.label.isEmpty())
            return eInvalidInput;
        if (field.choiceCount && (!field.choices || field.selectedIndex < 0
            || static_cast<unsigned int>(field.selectedIndex) >= field.choiceCount))
            return eInvalidInput;
        VbPropertyRow row;
        row.stableKey.Format(L"param:%u", field.id);
        row.groupName = field.group.c_str();
        row.displayName = field.label.c_str();
        row.displayValue = field.value.c_str();
        row.editorType = field.choiceCount ? VbPropertyEditorType::ComboBox : VbPropertyEditorType::TextEdit;
        for (unsigned int j = 0; j < field.choiceCount; ++j)
        {
            VbPropertyOption choice;
            choice.key.Format(L"%u", j);
            choice.text = field.choices[j].c_str();
            row.options.push_back(choice);
        }
        if (field.choiceCount)
            row.displayValue = field.choices[field.selectedIndex].c_str();
        copied.push_back(std::move(row));
    }
    const bool shown = pMain->SetExternalCommandProperties(copied,
        [handler](unsigned int id, const std::wstring& value, int index)
        {
            try { return handler->OnPropertyChanged(id, OdString(value.c_str()), index); }
            catch (...) { LOG(L"[SDK] Command Properties handler threw an exception."); return false; }
        });
    return shown ? eOk : eNotApplicable;
}

OdResult VBimUIApplication::SetCommandPropertyPanel(IVBimTypeSelectorHandler* owner,
    IVBimCommandPropertyPanelHandler* handler)
{
    if (!owner || !handler)
        return eInvalidInput;
    if (!IsBusy() || s_typeSelector != owner)
        return eNotApplicable;
    CMainFrame* pMain = theApp.GetMainFrame();
    if (!pMain)
        return eNotApplicable;
    // Callback metadata belongs to Host. The DLL handler itself remains a borrowed observer.
    auto kinds = std::make_shared<std::map<unsigned int, VBimCommandPropertyKind>>();
    const auto refresh = [owner, handler, kinds](std::vector<VbPropertyRow>& rows,
        std::wstring& caption, bool& editType)
    {
        if (s_typeSelector != owner)
            return false;
        try
        {
            VBimCommandPropertyPanel panel;
            if (!handler->GetProperties(panel) || !CopyCommandPropertyPanel(panel, rows, *kinds))
                return false;
            caption = panel.contextLabel.c_str();
            editType = panel.editTypeEnabled;
            return true;
        }
        catch (...) { LOG(L"[SDK] Properties provider threw an exception."); return false; }
    };
    std::vector<VbPropertyRow> copied;
    std::wstring caption;
    bool editType = false;
    if (!refresh(copied, caption, editType))
        return eInvalidInput;
    const bool shown = pMain->SetExternalCommandProperties(copied,
        [owner, handler, kinds](unsigned int id, const std::wstring& value, int index)
        {
            if (s_typeSelector != owner)
                return false;
            const auto found = kinds->find(id);
            if (found == kinds->end())
                return false;
            VBimCommandPropertyEdit edit;
            edit.id = id;
            edit.kind = found->second;
            edit.value = value.c_str();
            edit.selectedIndex = index;
            edit.boolValue = value == L"1";
            try { return handler->OnPropertyChanged(edit); }
            catch (...) { LOG(L"[SDK] Typed Properties handler threw an exception."); return false; }
        }, refresh,
        [owner, handler](unsigned int id)
        {
            if (s_typeSelector != owner)
                return;
            try { handler->OnAction(id); }
            catch (...) { LOG(L"[SDK] Properties action handler threw an exception."); }
        }, caption, editType);
    return shown ? eOk : eNotApplicable;
}

bool VBimUIApplication::IsTypeSelectionOwner(const IVBimTypeSelectorHandler* handler) const noexcept
{
    return handler != nullptr && s_typeSelector == handler;
}

void VBimUIApplication::EndTypeSelection()
{
    if (!s_typeSelector)
        return;
    s_typeSelector = nullptr;
    CMainFrame* pMain = theApp.GetMainFrame();
    if (!pMain)
        return;
    pMain->EndExternalTypeSelection();
    // Give Properties back its normal context: the first selected element,
    // or the active view when nothing is selected.
    const OdBmObjectIdArray pickFirst = vbimGetPickFirst();
    pMain->UpdateProperties(pickFirst.isEmpty() ? OdBmObjectId::kNull : pickFirst.first());
}

OdResult VBimUIApplication::ShowContextualTab(const OdString& contextId, bool show)
{
    return VbimRibbon::RibbonHostApi::Instance().ShowContextualTab(std::wstring(contextId.c_str()), show)
        ? eOk : eInvalidInput;
}

OdResult VBimUIApplication::ShowContextualTab(const VBimRibbon::TabDef& tabDef)
{
    VbimRibbon::TabDef hostDef;
    hostDef.name = tabDef.name.c_str();
    hostDef.isContextual = true;
    hostDef.contextId = tabDef.contextId.c_str();
    hostDef.returnTab = tabDef.returnTab.c_str();
    hostDef.order = tabDef.order;

    for (const auto& p : tabDef.panels)
    {
        VbimRibbon::PanelDef hostPanel;
        hostPanel.name = p.name.c_str();
        hostPanel.order = p.order;

        for (const auto& b : p.buttons)
        {
            VbimRibbon::ButtonDef hostBtn;
            hostBtn.commandName = b.commandName.c_str();
            hostBtn.text = b.text.c_str();
            hostBtn.tooltip = b.tooltip.c_str();
            hostBtn.longDescription = b.longDescription.c_str();
            hostBtn.iconPath = b.iconPath.c_str();
            hostBtn.iconSmallPath = b.smallIconPath.c_str();
            hostBtn.iconLargePath = b.largeIconPath.c_str();
            hostBtn.iconResId = b.iconResId;
            hostBtn.hCustomIcon = b.hCustomIcon;
            hostBtn.hCustomSmallIcon = b.hCustomSmallIcon;
            hostBtn.size = static_cast<VbimRibbon::ButtonSize>(b.size);
            hostBtn.kind = static_cast<VbimRibbon::ButtonKind>(b.kind);
            hostBtn.responsive = b.responsive;
            hostBtn.visible = b.visible;
            hostBtn.enabled = b.enabled;
            hostBtn.checked = b.checked;
            hostBtn.isStacked = b.isStacked;
            hostBtn.isSlideOut = b.isSlideOut;
            hostBtn.groupName = b.groupName.c_str();
            hostBtn.comboSelectedIndex = b.comboSelectedIndex;
            hostBtn.order = b.order;
            hostBtn.helpUrl = b.helpUrl.c_str();

            for (const auto& item : b.comboItems)
                hostBtn.comboItems.push_back(item.c_str());

            for (const auto& sub : b.subItems)
            {
                VbimRibbon::ButtonDef hostSub;
                hostSub.commandName = sub.commandName.c_str();
                hostSub.text = sub.text.c_str();
                hostSub.tooltip = sub.tooltip.c_str();
                hostSub.longDescription = sub.longDescription.c_str();
                hostSub.iconPath = sub.iconPath.c_str();
                hostSub.iconSmallPath = sub.smallIconPath.c_str();
                hostSub.iconLargePath = sub.largeIconPath.c_str();
                hostSub.iconResId = sub.iconResId;
                hostSub.hCustomIcon = sub.hCustomIcon;
                hostSub.hCustomSmallIcon = sub.hCustomSmallIcon;
                hostSub.size = static_cast<VbimRibbon::ButtonSize>(sub.size);
                hostSub.kind = static_cast<VbimRibbon::ButtonKind>(sub.kind);
                hostSub.responsive = sub.responsive;
                hostSub.visible = sub.visible;
                hostSub.enabled = sub.enabled;
                hostSub.checked = sub.checked;
                hostSub.order = sub.order;
                hostBtn.subItems.push_back(std::move(hostSub));
            }

            hostPanel.buttons.push_back(std::move(hostBtn));
        }
        hostDef.panels.push_back(std::move(hostPanel));
    }

    return VbimRibbon::RibbonHostApi::Instance().ShowContextualTab(hostDef)
        ? eOk : eInvalidInput;
}

OdResult VBimUIApplication::ShowContextualTab(const OdString& tabName,
                                             const std::vector<VBimRibbon::PanelDef>& panels,
                                             const OdString& returnTab)
{
    VBimRibbon::TabDef tabDef;
    tabDef.name = tabName;
    tabDef.panels = panels;
    tabDef.returnTab = returnTab;
    tabDef.isContextual = true;
    return ShowContextualTab(tabDef);
}

OdResult VBimUIApplication::HideContextualTab()
{
    // Drops every scope owner too: their tabs and callbacks must not come back.
    if (!s_contextualStack.empty() && s_contextualStack.back().bridge)
        RegisterEntryHandlers(s_contextualStack.back(), false);
    for (auto& entry : s_contextualStack)
        RetireBridge(std::move(entry.bridge));
    s_contextualStack.clear();

    return VbimRibbon::RibbonHostApi::Instance().HideContextualTab()
        ? eOk : eInvalidInput;
}

OdResult VBimUIApplication::PushContextualTab(const VBimRibbon::TabDef& tabDef,
    std::function<void(const OdString&, const OdString&)> callback, OdUInt64& outToken)
{
    outToken = 0;
    if (tabDef.name.isEmpty())
        return eInvalidInput;

    ContextualTabEntry entry;
    entry.dynamic = true;
    entry.tabDef = tabDef;
    entry.tabDef.isContextual = true;
    if (callback)
    {
        entry.bridge = std::make_shared<ContextualTabControlBridge>(std::move(callback));
        entry.controlIds = CollectValueControlIds(entry.tabDef);
    }
    return PushContextualEntry(std::move(entry), outToken);
}

OdResult VBimUIApplication::PushContextualTab(const OdString& contextId, OdUInt64& outToken)
{
    outToken = 0;
    if (contextId.isEmpty())
        return eInvalidInput;

    ContextualTabEntry entry;
    entry.contextId = contextId;
    return PushContextualEntry(std::move(entry), outToken);
}

void VBimUIApplication::PopContextualTab(OdUInt64 token) noexcept
{
    try
    {
        PurgeRetiredBridges();
        const auto it = std::find_if(s_contextualStack.begin(), s_contextualStack.end(),
            [token](const ContextualTabEntry& entry) { return entry.token == token; });
        if (it == s_contextualStack.end())
            return;

        const bool wasTop = (it + 1 == s_contextualStack.end());
        ContextualTabEntry entry = std::move(*it);
        s_contextualStack.erase(it);

        if (wasTop)
        {
            DeactivateContextualEntry(entry);
            if (!s_contextualStack.empty())
                ActivateContextualEntry(s_contextualStack.back());
        }
        RetireBridge(std::move(entry.bridge));
    }
    catch (...)
    {
        LOG(CString(L"[SDK] PopContextualTab failed to restore the contextual tab."));
    }
}

bool VBimUIApplication::IsContextualTabOwned(OdUInt64 token) const noexcept
{
    if (token == 0)
        return false;
    for (const auto& entry : s_contextualStack)
    {
        if (entry.token == token)
            return true;
    }
    return false;
}

VBimEventManager* VBimUIApplication::EventManager()
{
    static VBimEventManager s_manager;
    return &s_manager;
}

VBimDockablePaneRegistry* VBimUIApplication::DockablePaneRegistry()
{
    static VBimDockablePaneRegistry s_registry;
    return &s_registry;
}

VBimProgressService* VBimUIApplication::ProgressService()
{
    static VBimProgressService s_progress;
    return &s_progress;
}

VBimTaskDialogService* VBimUIApplication::TaskDialogService()
{
    static VBimTaskDialogService s_taskDialog;
    return &s_taskDialog;
}

namespace {

/**
 * @brief Sandboxed HTTP client exposed to plugins.
 *
 * Enforces security boundaries:
 * 1. Restricts AuthMode::Bearer to official VinaBIM API hosts (vina-cad.com and subdomains, exact tgl-cloud.com backend hosts; localhost in debug or staging)
 *    to prevent third-party plugins from exfiltrating the logged-in user's Bearer token.
 * 2. Neutralizes Shutdown(): plugins cannot shut down the Host's shared connection pool.
 */
class PluginHttpClient final : public vb::net::IHttpClient
{
public:
	explicit PluginHttpClient(vb::net::IHttpClient& inner)
		: m_inner(inner)
	{
	}

	vb::net::HttpResult Send(const vb::net::Request& request) override
	{
		if (auto blocked = CheckPluginSecurity(request))
			return *blocked;
		return m_inner.Send(request);
	}

	vb::net::HttpResult Download(const vb::net::Request& request, const std::wstring& outputPath, vb::net::ProgressFn progress) override
	{
		if (auto blocked = CheckPluginSecurity(request))
			return *blocked;
		return m_inner.Download(request, outputPath, std::move(progress));
	}

	vb::net::HttpResult Upload(const vb::net::Request& request, std::vector<vb::net::MultipartPart> parts, vb::net::ProgressFn progress) override
	{
		if (auto blocked = CheckPluginSecurity(request))
			return *blocked;
		return m_inner.Upload(request, std::move(parts), std::move(progress));
	}

	bool Shutdown(std::chrono::milliseconds) override
	{
		// Plugins cannot shut down the process-wide HTTP runtime.
		return true;
	}

private:
	static std::optional<vb::net::HttpResult> CheckPluginSecurity(const vb::net::Request& request)
	{
		const std::optional<std::string> parsedHost = vb::net::UrlHost(request.url());
		if (!parsedHost)
		{
			vb::net::HttpResult err;
			err.error.kind = vb::net::ErrorKind::InvalidRequest;
			err.error.message = "Plugin requests must use an absolute URL (e.g. 'https://api.vina-cad.com/...').";
			return err;
		}

		if (request.auth() == vb::net::AuthMode::Bearer)
		{
			const bool isStaging = vb::endpoints::IsStagingActive();
			if (!vb::net::IsAllowedBearerHost(request.url(), isStaging))
			{
				vb::net::HttpResult err;
				err.error.kind = vb::net::ErrorKind::InvalidRequest;
				err.error.message = "Plugin Bearer authorization is restricted to VinaBIM API domains.";
				return err;
			}
		}
		return std::nullopt;
	}

	vb::net::IHttpClient& m_inner;
};

} // namespace

vb::net::IHttpClient* VBimUIApplication::NetworkClient()
{
	static PluginHttpClient s_pluginClient(vb::host::net::HostHttp());
	return &s_pluginClient;
}

HWND VBimUIApplication::MainWindowHandle() const
{
    CMainFrame* pMain = theApp.GetMainFrame();
    return pMain ? pMain->m_hWnd : nullptr;
}

OdResult VBimUIApplication::ShowOptionBar(const OdString& commandName,
    const std::vector<vb::ui::optionbar::OptionItem>& items,
    vb::ui::optionbar::OptionBarCallback callback)
{
    CVBimOptionBar* pOptionBar = HostOptionBar();
    if (!pOptionBar)
        return eNotApplicable;

    // An entry of the running command (scope-owned or legacy) is modified in place.
    if (OptionBarEntry* pTop = CurrentDepthTopEntry())
    {
        pTop->commandName = commandName.c_str();
        pTop->items = items;
        pTop->callback = std::move(callback);
        ShowOptionBarEntry(pOptionBar, *pTop);
        return eOk;
    }

    // Inside a command, or above an outer command's entry: push an own entry so the
    // outer controls are restored when this command ends (the Host drops it then).
    if (VBimChangeTracker::CommandDepth() > 0 || !s_optionBarStack.empty())
    {
        PushLegacyOptionBarEntry(pOptionBar, commandName.c_str(), items, std::move(callback));
        return eOk;
    }

    pOptionBar->Populate(commandName.c_str(), items, std::move(callback));
    return eOk;
}

OdResult VBimUIApplication::ShowOptionBar(const std::vector<vb::ui::optionbar::OptionItem>& items,
    vb::ui::optionbar::OptionBarCallback callback)
{
    CVBimOptionBar* pOptionBar = HostOptionBar();
    if (!pOptionBar)
        return eNotApplicable;

    if (OptionBarEntry* pTop = CurrentDepthTopEntry())
    {
        pTop->items = items;
        pTop->callback = std::move(callback);
        ShowOptionBarEntry(pOptionBar, *pTop);
        return eOk;
    }

    if (VBimChangeTracker::CommandDepth() > 0 || !s_optionBarStack.empty())
    {
        // No name given: keep the command name currently shown (the running command's).
        PushLegacyOptionBarEntry(pOptionBar, pOptionBar->GetActiveCommand(), items, std::move(callback));
        return eOk;
    }

    pOptionBar->Populate(items, std::move(callback));
    return eOk;
}

OdResult VBimUIApplication::SetOptionBarActiveCommand(const OdString& commandName)
{
    CVBimOptionBar* pOptionBar = HostOptionBar();
    if (!pOptionBar)
        return eNotApplicable;

    // CVBimOptionBar::SetActiveCommand drops the controls; keep the running command's
    // entry. An outer command's entry is left alone and restored when this command ends.
    if (OptionBarEntry* pTop = CurrentDepthTopEntry())
    {
        pTop->commandName = commandName.c_str();
        ShowOptionBarEntry(pOptionBar, *pTop);
        return eOk;
    }

    pOptionBar->SetActiveCommand(commandName.c_str());
    return eOk;
}

OdResult VBimUIApplication::SetOptionBarValue(int id, const vb::ui::optionbar::OptionItem& item)
{
    CVBimOptionBar* pOptionBar = HostOptionBar();
    if (!pOptionBar)
        return eNotApplicable;

    if (!pOptionBar->SetValue(id, item))
        return eInvalidInput;

    if (!s_optionBarStack.empty())
    {
        for (auto& stored : s_optionBarStack.back().items)
        {
            if (stored.id == id)
            {
                MergeOptionValue(stored, item);
                break;
            }
        }
    }
    return eOk;
}

OdResult VBimUIApplication::SetOptionBarEnabled(int id, bool enabled)
{
    CVBimOptionBar* pOptionBar = HostOptionBar();
    if (!pOptionBar)
        return eNotApplicable;

    if (!pOptionBar->SetEnabled(id, enabled))
        return eInvalidInput;

    if (!s_optionBarStack.empty())
    {
        for (auto& stored : s_optionBarStack.back().items)
        {
            if (stored.id == id)
            {
                stored.enabled = enabled;
                break;
            }
        }
    }
    return eOk;
}

void VBimUIApplication::HideOptionBar()
{
    s_optionBarStack.clear();
    if (CVBimOptionBar* pOptionBar = HostOptionBar())
        pOptionBar->Clear();
}

OdResult VBimUIApplication::PushOptionBar(const OdString& commandName,
    const std::vector<vb::ui::optionbar::OptionItem>& items,
    vb::ui::optionbar::OptionBarCallback callback, OdUInt64& outToken)
{
    outToken = 0;
    CVBimOptionBar* pOptionBar = HostOptionBar();
    if (!pOptionBar)
        return eNotApplicable;

    OptionBarEntry entry;
    entry.token = s_nextUiToken++;
    entry.commandName = commandName.isEmpty()
        ? pOptionBar->GetActiveCommand() : std::wstring(commandName.c_str());
    entry.items = items;
    entry.callback = std::move(callback);
    entry.commandDepth = VBimChangeTracker::CommandDepth();
    s_optionBarStack.push_back(std::move(entry));

    ShowOptionBarEntry(pOptionBar, s_optionBarStack.back());
    outToken = s_optionBarStack.back().token;
    return eOk;
}

void VBimUIApplication::PopOptionBar(OdUInt64 token) noexcept
{
    try
    {
        const auto it = std::find_if(s_optionBarStack.begin(), s_optionBarStack.end(),
            [token](const OptionBarEntry& entry) { return entry.token == token; });
        if (it == s_optionBarStack.end())
            return;

        const bool wasTop = (it + 1 == s_optionBarStack.end());
        s_optionBarStack.erase(it);
        if (!wasTop)
            return;

        CVBimOptionBar* pOptionBar = HostOptionBar();
        if (!pOptionBar)
            return;
        if (s_optionBarStack.empty())
            pOptionBar->Clear();
        else
            ShowOptionBarEntry(pOptionBar, s_optionBarStack.back());
    }
    catch (...)
    {
        LOG(CString(L"[SDK] PopOptionBar failed to restore the Option Bar."));
    }
}

bool VBimUIApplication::IsOptionBarOwner(OdUInt64 token) const noexcept
{
    return token != 0 && !s_optionBarStack.empty() && s_optionBarStack.back().token == token;
}

void VBimUIApplication::DropEndedCommandOptionBarEntries(int commandDepth) noexcept
{
    try
    {
        s_optionBarStack.erase(std::remove_if(s_optionBarStack.begin(), s_optionBarStack.end(),
            [commandDepth](const OptionBarEntry& entry)
            {
                return entry.legacy && entry.commandDepth > commandDepth;
            }), s_optionBarStack.end());
    }
    catch (...)
    {
        LOG(CString(L"[SDK] DropEndedCommandOptionBarEntries failed."));
    }
}

bool VBimUIApplication::RestoreOptionBarOwner()
{
    if (s_optionBarStack.empty())
        return false;
    CVBimOptionBar* pOptionBar = HostOptionBar();
    if (!pOptionBar)
        return false;
    ShowOptionBarEntry(pOptionBar, s_optionBarStack.back());
    return true;
}

