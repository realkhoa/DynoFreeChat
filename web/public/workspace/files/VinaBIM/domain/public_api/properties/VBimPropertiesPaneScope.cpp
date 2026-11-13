// VBimPropertiesPaneScope.cpp
//
// Implementation of VBimPropertiesPaneScope.
//
#include "pch.h"
#include "domain/public_api/properties/VBimPropertiesPaneScope.h"
#include "domain/public_api/optionbar/VBimOptionBarScope.h"
#include "Host/frame/MainFrm.h"
#include "Host/ui/dockables/DockableProperties.h"
#include "Infrastructure/Oda/sdk_includes/BmSdkCompat.h"
#include "Database/BmDatabase.h"
#include "Database/PE/BmLabelUtilsPE.h"
#include "Base/BmSpecTypeId.h"
#include "HostObj/Entities/BmWallType.h"
#include "Family/Entities/BmFamily.h"
#include "Family/Entities/BmFamilySymbol.h"
#include "Database/Managers/BmSymbolIdMgr.h"
#include "Database/Managers/BmElementTrackingData.h"
#include "domain/vinaBIMCore/vbedvds.h"
#include "OdaCommon.h"

#include <algorithm>
#include <cmath>
#include <cwchar>
#include <cwctype>

namespace
{
    /** Loads a STRINGTABLE entry of the Host module. */
    OdString LoadPaneString(UINT id)
    {
        CString text;
        text.LoadString(id);
        return OdString(static_cast<LPCTSTR>(text));
    }

    /** Strict number parse: the whole text (surrounding blanks allowed) must be one finite number. */
    bool ParseFiniteNumber(const OdString& text, double& out)
    {
        const wchar_t* p = text.c_str();
        while (*p && std::iswspace(static_cast<wint_t>(*p)))
            ++p;
        if (!*p)
            return false;
        wchar_t* end = nullptr;
        const double value = std::wcstod(p, &end);
        if (end == p)
            return false;
        while (*end && std::iswspace(static_cast<wint_t>(*end)))
            ++end;
        if (*end || !std::isfinite(value))
            return false;
        out = value;
        return true;
    }

    /**
     * Formats a preset length given in millimetres with the project length units
     * (the formatter the Properties pane uses); falls back to a fixed mm text.
     */
    OdString FormatPresetLength(OdBmDatabase* pDb, double millimetres)
    {
        constexpr double kMillimetresPerFoot = 304.8; // ODA internal length unit is the foot.
        try
        {
            const OdBmLabelUtilsPEPtr pLabelUtils = ODBM_LABELUTILS();
            if (pDb && !pLabelUtils.isNull())
            {
                const OdString text = pLabelUtils->format(pDb, OdBmSpecTypeId::kLength,
                    millimetres / kMillimetresPerFoot, false);
                if (!text.isEmpty())
                    return text;
            }
        }
        catch (const OdError& e)
        {
            (void)e;
            ODA_TRACE1("VBimPropertiesPaneScope preset length format OdError: %ls\n", e.description().c_str());
        }
        OdString fallback;
        fallback.format(L"%.1f mm", millimetres);
        return fallback;
    }

    /** Builds one preset field. */
    VBimCommandPropertyField MakeField(unsigned int id, UINT groupId, UINT labelId,
        VBimCommandPropertyKind kind, const OdString& value)
    {
        VBimCommandPropertyField field;
        field.id = id;
        field.group = LoadPaneString(groupId);
        field.label = LoadPaneString(labelId);
        field.kind = kind;
        field.value = value;
        return field;
    }

    /** Publishes preset fields and logs a refused publication (the scope keeps its Type Selector). */
    void PublishPreset(VBimPropertiesPaneScope& scope, const std::vector<VBimCommandPropertyField>& fields,
        UINT captionId, VBimPropertiesPaneScope::PropertyChangedCallback onParamChanged)
    {
        const OdResult res = scope.SetProperties(fields, LoadPaneString(captionId), std::move(onParamChanged));
        if (res != eOk)
        {
            ODA_TRACE1("VBimPropertiesPaneScope preset SetProperties failed: %d\n", static_cast<int>(res));
        }
    }
}

class VBimPropertiesPaneScope::Impl
    : public IVBimTypeSelectorHandler
    , public IVBimCommandPropertyPanelHandler
{
public:
    TypeChangedCallback                     m_onTypeChanged;
    PropertyChangedCallback                 m_onPropertyChanged;
    ActionCallback                          m_onAction;
    /// Token of the bound Option Bar entry (never a scope pointer: the scope may move or die).
    OdUInt64                                m_boundOptionBarToken = 0;

    OdString                                m_contextCaption;
    std::vector<VBimCommandPropertyField>   m_fields;
    /// Owned copies of every field's choices; VBimCommandPropertyField::choices points here.
    std::vector<std::vector<OdString>>      m_choiceStorage;
    bool                                    m_active = false;
    /// Expires when this Impl is destroyed; lets a handler tell whether its callback
    /// replaced or destroyed the scope (and with it this Impl).
    std::shared_ptr<int>                    m_lifetime = std::make_shared<int>(0);

    Impl() = default;
    ~Impl() override = default;

    // IVBimTypeSelectorHandler:
    void OnTypeChanged(const OdBmObjectId& typeId) override
    {
        if (m_onTypeChanged)
        {
            // Call a copy: the callback may reassign or destroy the scope that owns this Impl.
            const TypeChangedCallback onTypeChanged = m_onTypeChanged;
            try
            {
                onTypeChanged(typeId);
            }
            catch (const OdError& e)
            {
                (void)e;
                ODA_TRACE1("VBimPropertiesPaneScope::OnTypeChanged OdError: %ls\n", e.description().c_str());
            }
            catch (const std::exception& e)
            {
                (void)e;
                ODA_TRACE1("VBimPropertiesPaneScope::OnTypeChanged exception: %hs\n", e.what());
            }
        }
    }

    // IVBimCommandPropertyPanelHandler:
    bool GetProperties(VBimCommandPropertyPanel& panel) override
    {
        panel.contextLabel = m_contextCaption;
        panel.fields = m_fields.empty() ? nullptr : m_fields.data();
        panel.count = static_cast<unsigned int>(m_fields.size());
        panel.editTypeEnabled = true;
        return true;
    }

    bool OnPropertyChanged(const VBimCommandPropertyEdit& edit) override
    {
        // The command validates first: a refused edit must leave the accepted state unchanged.
        bool accepted = true;
        const std::weak_ptr<int> alive = m_lifetime;
        if (m_onPropertyChanged)
        {
            // Call a copy: the callback may reassign or destroy the scope that owns this Impl.
            const PropertyChangedCallback onPropertyChanged = m_onPropertyChanged;
            try
            {
                accepted = onPropertyChanged(edit.id, edit.value, edit.selectedIndex);
            }
            catch (const OdError& e)
            {
                (void)e;
                ODA_TRACE1("VBimPropertiesPaneScope::OnPropertyChanged callback OdError: %ls\n", e.description().c_str());
                accepted = false;
            }
            catch (const std::exception& e)
            {
                (void)e;
                ODA_TRACE1("VBimPropertiesPaneScope::OnPropertyChanged callback exception: %hs\n", e.what());
                accepted = false;
            }
        }
        if (!accepted)
            return false;
        if (alive.expired())
            return true; // The scope was replaced or destroyed; its fields are gone.

        // Update cached field
        for (auto& f : m_fields)
        {
            if (f.id == edit.id)
            {
                f.value = edit.value;
                f.selectedIndex = edit.selectedIndex;
                f.boolValue = edit.boolValue;
                break;
            }
        }

        SyncOptionBar(edit);
        return true;
    }

    void OnAction(unsigned int id) override
    {
        if (m_onAction)
        {
            // Call a copy: the callback may reassign or destroy the scope that owns this Impl.
            const ActionCallback onAction = m_onAction;
            try
            {
                onAction(id);
            }
            catch (const OdError& e)
            {
                (void)e;
                ODA_TRACE1("VBimPropertiesPaneScope::OnAction OdError: %ls\n", e.description().c_str());
            }
            catch (const std::exception& e)
            {
                (void)e;
                ODA_TRACE1("VBimPropertiesPaneScope::OnAction exception: %hs\n", e.what());
            }
        }
    }

private:
    // Two-way synchronization with the bound Option Bar entry, while it is the one shown.
    // The value is sent in the control's own type: Check for booleans, Number for numeric
    // controls (CVBimOptionBar rejects a Text carrier for them), Text for text and choices.
    void SyncOptionBar(const VBimCommandPropertyEdit& edit)
    {
        VBimUIApplication& app = VBimUIApplication::Instance();
        if (m_boundOptionBarToken == 0 || !app.IsOptionBarOwner(m_boundOptionBarToken))
            return;

        using vb::ui::optionbar::OptionItem;
        using vb::ui::optionbar::OptionType;
        const int id = static_cast<int>(edit.id);
        try
        {
            OptionItem item;
            item.id = id;
            OdResult res = eOk;
            double number = 0.0;
            const bool isNumber = ParseFiniteNumber(edit.value, number);
            switch (edit.kind)
            {
            case VBimCommandPropertyKind::Boolean:
                item.type = OptionType::Check;
                item.checked = edit.boolValue;
                res = app.SetOptionBarValue(id, item);
                break;
            case VBimCommandPropertyKind::Number:
                if (!isNumber)
                {
                    ODA_TRACE1("VBimPropertiesPaneScope: Number field %u is not numeric; Option Bar not synced.\n", edit.id);
                    return;
                }
                item.type = OptionType::Number;
                item.numVal = number;
                res = app.SetOptionBarValue(id, item);
                break;
            case VBimCommandPropertyKind::Action:
                return;
            default:
                item.type = OptionType::Text;
                item.textVal = edit.value.c_str();
                res = app.SetOptionBarValue(id, item);
                // A text field mirrored by a numeric control: retry with the parsed number.
                if (res == eInvalidInput && edit.kind == VBimCommandPropertyKind::Text && isNumber)
                {
                    item.type = OptionType::Number;
                    item.textVal.clear();
                    item.numVal = number;
                    res = app.SetOptionBarValue(id, item);
                }
                break;
            }
            if (res != eOk)
            {
                ODA_TRACE2("VBimPropertiesPaneScope: Option Bar sync of field %u failed (%d).\n",
                    edit.id, static_cast<int>(res));
            }
        }
        catch (const OdError& e)
        {
            (void)e;
            ODA_TRACE1("VBimPropertiesPaneScope::OnPropertyChanged OptionBar sync OdError: %ls\n", e.description().c_str());
        }
        catch (const std::exception& e)
        {
            (void)e;
            ODA_TRACE1("VBimPropertiesPaneScope::OnPropertyChanged OptionBar sync exception: %hs\n", e.what());
        }
    }
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

VBimPropertiesPaneScope::VBimPropertiesPaneScope() noexcept
    : m_pImpl(std::make_unique<Impl>())
{
}

VBimPropertiesPaneScope::~VBimPropertiesPaneScope()
{
    Close();
}

// The Impl object is what the Host holds (as Type Selector / panel handler); moving the
// unique_ptr keeps its address, so the Host's borrowed pointer stays valid.
VBimPropertiesPaneScope::VBimPropertiesPaneScope(VBimPropertiesPaneScope&& other) noexcept = default;

VBimPropertiesPaneScope& VBimPropertiesPaneScope::operator=(VBimPropertiesPaneScope&& other) noexcept
{
    if (this != &other)
    {
        // End this scope's session before its Impl (still held by the Host) is destroyed.
        Close();
        m_pImpl = std::move(other.m_pImpl);
    }
    return *this;
}

void VBimPropertiesPaneScope::Close()
{
    if (m_pImpl && m_pImpl->m_active)
    {
        try
        {
            // Only end the session this scope owns; another owner's session is left alone.
            VBimUIApplication& app = VBimUIApplication::Instance();
            if (app.IsTypeSelectionOwner(m_pImpl.get()))
                app.EndTypeSelection();
        }
        catch (const OdError& e)
        {
            (void)e;
            ODA_TRACE1("VBimPropertiesPaneScope::Close OdError: %ls\n", e.description().c_str());
        }
        catch (const std::exception& e)
        {
            (void)e;
            ODA_TRACE1("VBimPropertiesPaneScope::Close exception: %hs\n", e.what());
        }
        m_pImpl->m_active = false;
        m_pImpl->m_boundOptionBarToken = 0;
    }
}

bool VBimPropertiesPaneScope::IsActive() const noexcept
{
    return m_pImpl && m_pImpl->m_active;
}

OdResult VBimPropertiesPaneScope::ShowTypes(
    const OdBmObjectIdArray& typeIds,
    const OdBmObjectId& selected,
    TypeChangedCallback onTypeChanged)
{
    if (!m_pImpl)
        m_pImpl = std::make_unique<Impl>();

    m_pImpl->m_onTypeChanged = std::move(onTypeChanged);

    const OdResult res = VBimUIApplication::Instance().BeginTypeSelection(typeIds, selected, m_pImpl.get());
    if (res == eOk)
    {
        m_pImpl->m_active = true;
    }
    return res;
}

OdResult VBimPropertiesPaneScope::SetProperties(
    const std::vector<VBimCommandPropertyField>& fields,
    const OdString& contextCaption,
    PropertyChangedCallback onPropertyChanged,
    ActionCallback onAction)
{
    if (!m_pImpl || !m_pImpl->m_active)
        return eNotApplicable;
    // The Host panel contract needs at least one row (an empty panel is refused).
    if (fields.empty())
        return eInvalidInput;

    // Deep-copy the caller-borrowed choice arrays: the Host re-reads the panel after
    // every edit, long after the caller's arrays may be gone.
    std::vector<VBimCommandPropertyField> copied = fields;
    std::vector<std::vector<OdString>> choiceStorage(copied.size());
    for (size_t i = 0; i < copied.size(); ++i)
    {
        VBimCommandPropertyField& field = copied[i];
        if (field.choiceCount == 0)
        {
            field.choices = nullptr;
            continue;
        }
        if (!field.choices)
            return eInvalidInput;
        choiceStorage[i].assign(field.choices, field.choices + field.choiceCount);
    }
    // Repoint only after all copies exist (inner buffers no longer move).
    for (size_t i = 0; i < copied.size(); ++i)
    {
        if (copied[i].choiceCount != 0)
            copied[i].choices = choiceStorage[i].data();
    }

    const bool firstPublication = m_pImpl->m_fields.empty();
    m_pImpl->m_fields = std::move(copied);
    m_pImpl->m_choiceStorage = std::move(choiceStorage);
    m_pImpl->m_contextCaption = contextCaption;
    // First publication after CreateForCategory(): an empty callback keeps the one given there.
    if (onPropertyChanged || !firstPublication)
        m_pImpl->m_onPropertyChanged = std::move(onPropertyChanged);
    m_pImpl->m_onAction = std::move(onAction);

    return VBimUIApplication::Instance().SetCommandPropertyPanel(m_pImpl.get(), m_pImpl.get());
}

void VBimPropertiesPaneScope::BindOptionBar(vb::ui::optionbar::VBimOptionBarScope* pOptionBar)
{
    if (m_pImpl)
    {
        m_pImpl->m_boundOptionBarToken = pOptionBar ? pOptionBar->GetOwnerToken() : 0;
    }
}

void VBimPropertiesPaneScope::UpdatePropertyValue(unsigned int id, const OdString& value)
{
    if (!m_pImpl || !m_pImpl->m_active)
        return;

    for (auto& f : m_pImpl->m_fields)
    {
        if (f.id == id)
        {
            f.value = value;
            break;
        }
    }

    // Refresh UI display in Properties panel
    if (CMainFrame* pMain = DYNAMIC_DOWNCAST(CMainFrame, AfxGetMainWnd()))
    {
        pMain->RequeryExternalCommandProperties();
    }
}

// ---------------------------------------------------------------------------
// Command Presets for Wall, Door, Window, Category
// ---------------------------------------------------------------------------

VBimPropertiesPaneScope VBimPropertiesPaneScope::CreateForWall(
    OdBmDatabase* pDb,
    const OdBmObjectId& initialWallType,
    TypeChangedCallback onTypeChanged,
    PropertyChangedCallback onParamChanged)
{
    VBimPropertiesPaneScope scope;
    if (!pDb)
        return scope;

    // 1. Collect all wall types in database
    OdBmElementPtrArray elements;
    vbimFindElementsByClass(OdBmWallType::desc(), elements);
    OdBmObjectIdArray wallTypes;
    for (const OdBmElementPtr& el : elements)
    {
        if (!el.isNull())
            wallTypes.push_back(el->objectId());
    }

    if (wallTypes.isEmpty())
        return scope;

    OdBmObjectId selectedType = initialWallType;
    if (selectedType.isNull() || !wallTypes.contains(selectedType))
    {
        OdBmSymbolIdMgrPtr pSymbolIdMgr = pDb->getAppInfo(OdBm::ManagerType::SymbolIdMgr);
        if (!pSymbolIdMgr.isNull())
        {
            selectedType = pSymbolIdMgr->getDefElementIdByType(OdBm::ElementTypeGroup::WallType);
        }
        if (selectedType.isNull() || !wallTypes.contains(selectedType))
        {
            selectedType = wallTypes.first();
        }
    }

    // 2. Begin Type Selector
    if (scope.ShowTypes(wallTypes, selectedType, std::move(onTypeChanged)) != eOk)
        return scope;

    // 3. Setup standard Wall placement command properties
    std::vector<VBimCommandPropertyField> fields;
    fields.push_back(MakeField(1, IDS_SDKAPI_PROP_GROUP_CONSTRAINTS, IDS_SDKAPI_PROP_UNCONNECTED_HEIGHT,
        VBimCommandPropertyKind::Text, FormatPresetLength(pDb, 3000.0)));

    VBimCommandPropertyField rbField = MakeField(2, IDS_SDKAPI_PROP_GROUP_CONSTRAINTS,
        IDS_SDKAPI_PROP_ROOM_BOUNDING, VBimCommandPropertyKind::Boolean, L"1");
    rbField.boolValue = true;
    fields.push_back(rbField);

    fields.push_back(MakeField(3, IDS_SDKAPI_PROP_GROUP_IDENTITY, IDS_SDKAPI_PROP_COMMENTS,
        VBimCommandPropertyKind::Text, OdString::kEmpty));
    fields.push_back(MakeField(4, IDS_SDKAPI_PROP_GROUP_IDENTITY, IDS_SDKAPI_PROP_MARK,
        VBimCommandPropertyKind::Text, OdString::kEmpty));

    PublishPreset(scope, fields, IDS_SDKAPI_PROP_CTX_NEW_WALLS, std::move(onParamChanged));
    return scope;
}

VBimPropertiesPaneScope VBimPropertiesPaneScope::CreateForDoor(
    OdBmDatabase* pDb,
    const OdBmObjectId& initialDoorSymbol,
    TypeChangedCallback onTypeChanged,
    PropertyChangedCallback onParamChanged)
{
    VBimPropertiesPaneScope scope;
    if (!pDb)
        return scope;

    // 1. Collect all door family symbols
    OdBmObjectIdArray candidates, doorTypes;
    const OdBmElementTrackingDataPtr tracker = pDb->getAppInfo(OdBm::ManagerType::ElementTrackingData);
    if (!tracker.isNull())
    {
        tracker->getElementsByType(OdBm::BuiltInCategory::OST_Doors, OdBm::TrackingElementType::Symbols, candidates);
        for (const OdBmObjectId& id : candidates)
        {
            if (id.isNull() || id.database() != pDb || !id.isOpenable())
                continue;
            doorTypes.push_back(id);
        }
    }

    if (doorTypes.isEmpty())
        return scope;

    OdBmObjectId selectedSymbol = initialDoorSymbol;
    if (selectedSymbol.isNull() || !doorTypes.contains(selectedSymbol))
        selectedSymbol = doorTypes.first();

    if (scope.ShowTypes(doorTypes, selectedSymbol, std::move(onTypeChanged)) != eOk)
        return scope;

    // 2. Setup standard Door placement properties
    std::vector<VBimCommandPropertyField> fields;
    fields.push_back(MakeField(1, IDS_SDKAPI_PROP_GROUP_DIMENSIONS, IDS_SDKAPI_PROP_SILL_HEIGHT,
        VBimCommandPropertyKind::Text, FormatPresetLength(pDb, 0.0)));
    fields.push_back(MakeField(2, IDS_SDKAPI_PROP_GROUP_IDENTITY, IDS_SDKAPI_PROP_COMMENTS,
        VBimCommandPropertyKind::Text, OdString::kEmpty));
    fields.push_back(MakeField(3, IDS_SDKAPI_PROP_GROUP_IDENTITY, IDS_SDKAPI_PROP_MARK,
        VBimCommandPropertyKind::Text, OdString::kEmpty));

    PublishPreset(scope, fields, IDS_SDKAPI_PROP_CTX_DOOR, std::move(onParamChanged));
    return scope;
}

VBimPropertiesPaneScope VBimPropertiesPaneScope::CreateForWindow(
    OdBmDatabase* pDb,
    const OdBmObjectId& initialWindowSymbol,
    TypeChangedCallback onTypeChanged,
    PropertyChangedCallback onParamChanged)
{
    VBimPropertiesPaneScope scope;
    if (!pDb)
        return scope;

    // 1. Collect all window family symbols
    OdBmObjectIdArray candidates, windowTypes;
    const OdBmElementTrackingDataPtr tracker = pDb->getAppInfo(OdBm::ManagerType::ElementTrackingData);
    if (!tracker.isNull())
    {
        tracker->getElementsByType(OdBm::BuiltInCategory::OST_Windows, OdBm::TrackingElementType::Symbols, candidates);
        for (const OdBmObjectId& id : candidates)
        {
            if (id.isNull() || id.database() != pDb || !id.isOpenable())
                continue;
            windowTypes.push_back(id);
        }
    }

    if (windowTypes.isEmpty())
        return scope;

    OdBmObjectId selectedSymbol = initialWindowSymbol;
    if (selectedSymbol.isNull() || !windowTypes.contains(selectedSymbol))
        selectedSymbol = windowTypes.first();

    if (scope.ShowTypes(windowTypes, selectedSymbol, std::move(onTypeChanged)) != eOk)
        return scope;

    // 2. Setup standard Window placement properties
    std::vector<VBimCommandPropertyField> fields;
    fields.push_back(MakeField(1, IDS_SDKAPI_PROP_GROUP_DIMENSIONS, IDS_SDKAPI_PROP_SILL_HEIGHT,
        VBimCommandPropertyKind::Text, FormatPresetLength(pDb, 900.0)));
    fields.push_back(MakeField(2, IDS_SDKAPI_PROP_GROUP_DIMENSIONS, IDS_SDKAPI_PROP_HEAD_HEIGHT,
        VBimCommandPropertyKind::Text, FormatPresetLength(pDb, 2100.0)));
    fields.push_back(MakeField(3, IDS_SDKAPI_PROP_GROUP_IDENTITY, IDS_SDKAPI_PROP_COMMENTS,
        VBimCommandPropertyKind::Text, OdString::kEmpty));
    fields.push_back(MakeField(4, IDS_SDKAPI_PROP_GROUP_IDENTITY, IDS_SDKAPI_PROP_MARK,
        VBimCommandPropertyKind::Text, OdString::kEmpty));

    PublishPreset(scope, fields, IDS_SDKAPI_PROP_CTX_WINDOW, std::move(onParamChanged));
    return scope;
}

VBimPropertiesPaneScope VBimPropertiesPaneScope::CreateForCategory(
    OdBmDatabase* pDb,
    OdBm::BuiltInCategory::Enum category,
    const OdBmObjectId& initialSymbol,
    const OdString& contextCaption,
    TypeChangedCallback onTypeChanged,
    PropertyChangedCallback onParamChanged)
{
    VBimPropertiesPaneScope scope;
    if (!pDb)
        return scope;

    OdBmObjectIdArray candidates, types;
    const OdBmElementTrackingDataPtr tracker = pDb->getAppInfo(OdBm::ManagerType::ElementTrackingData);
    if (!tracker.isNull())
    {
        tracker->getElementsByType(category, OdBm::TrackingElementType::Symbols, candidates);
        for (const OdBmObjectId& id : candidates)
        {
            if (id.isNull() || id.database() != pDb || !id.isOpenable())
                continue;
            types.push_back(id);
        }
    }

    if (types.isEmpty())
        return scope;

    OdBmObjectId selectedSymbol = initialSymbol;
    if (selectedSymbol.isNull() || !types.contains(selectedSymbol))
        selectedSymbol = types.first();

    if (scope.ShowTypes(types, selectedSymbol, std::move(onTypeChanged)) != eOk)
        return scope;

    // No generic placement rows exist for an arbitrary category, and the Host refuses an
    // empty panel: only the Type Selector is shown. The caption and the change callback
    // are kept for a later SetProperties() call with the command's own rows.
    scope.m_pImpl->m_contextCaption = contextCaption;
    scope.m_pImpl->m_onPropertyChanged = std::move(onParamChanged);
    return scope;
}

// ---------------------------------------------------------------------------
// Post-Placement Notification & UI Sync
// ---------------------------------------------------------------------------

void VBimPropertiesPaneScope::NotifyElementPlaced(const OdBmObjectId& newElementId)
{
    if (newElementId.isNull())
        return;

    try
    {
        if (CMainFrame* pMain = DYNAMIC_DOWNCAST(CMainFrame, AfxGetMainWnd()))
        {
            pMain->UpdateProperties(newElementId);
        }
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimPropertiesPaneScope::NotifyElementPlaced OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimPropertiesPaneScope::NotifyElementPlaced exception: %hs\n", e.what());
    }
}

void VBimPropertiesPaneScope::RestoreToActiveView()
{
    try
    {
        if (CMainFrame* pMain = DYNAMIC_DOWNCAST(CMainFrame, AfxGetMainWnd()))
        {
            pMain->SyncPropertiesPaneDeferred();
        }
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimPropertiesPaneScope::RestoreToActiveView OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimPropertiesPaneScope::RestoreToActiveView exception: %hs\n", e.what());
    }
}
