// VBimProjectProperties.cpp
//
// Implementation of high-level Project Properties API.
//
#include "pch.h"
#include "VBimProjectProperties.h"
#include "../app/VBimUIDocument.h"

#include "Database/Entities/BmProjectInfo.h"
#include "Database/Entities/BmParamElem.h"
#include "Database/Entities/BmParamDef.h"
#include "Database/PE/BmLabelUtilsPE.h"
#include "Base/BmParameterSet.h"
#include "Infrastructure/Oda/CommonDef/OdExplicitTransaction.h"
#include "Infrastructure/Oda/undo/OdaSnapshotDeltaAction.h"
#include "domain/public_api/properties/internal/VBimPropertyValueParser.h"
#include "domain/public_api/command/internal/VBimDeferredUndo.h"

#include <algorithm>
#include <cwctype>
#include <sstream>

namespace
{
    // Case-insensitive wide string comparison
    bool EqualsIgnoreCase(const OdString& a, const OdString& b)
    {
        if (a.getLength() != b.getLength())
            return false;
        for (int i = 0; i < a.getLength(); ++i)
        {
            if (std::towlower(a[i]) != std::towlower(b[i]))
                return false;
        }
        return true;
    }

    std::wstring ToLowerStd(const OdString& str)
    {
        std::wstring res(str.c_str());
        std::transform(res.begin(), res.end(), res.begin(), [](wchar_t c) { return std::towlower(c); });
        return res;
    }

    // Escape a string for JSON output
    OdString EscapeJsonString(const OdString& src)
    {
        OdString result;
        const wchar_t* p = src.c_str();
        while (*p)
        {
            switch (*p)
            {
            case L'"':  result += L"\\\""; break;
            case L'\\': result += L"\\\\"; break;
            case L'\b': result += L"\\b"; break;
            case L'\f': result += L"\\f"; break;
            case L'\n': result += L"\\n"; break;
            case L'\r': result += L"\\r"; break;
            case L'\t': result += L"\\t"; break;
            default:
                if (*p < 32)
                {
                    OdString hex;
                    hex.format(L"\\u%04x", static_cast<unsigned int>(*p));
                    result += hex;
                }
                else
                {
                    result += *p;
                }
                break;
            }
            ++p;
        }
        return result;
    }

    // Unescape a string from JSON value
    OdString UnescapeJsonString(const OdString& src)
    {
        OdString result;
        const wchar_t* p = src.c_str();
        while (*p)
        {
            if (*p == L'\\' && *(p + 1))
            {
                ++p;
                switch (*p)
                {
                case L'"':  result += L'"'; break;
                case L'\\': result += L'\\'; break;
                case L'/':  result += L'/'; break;
                case L'b':  result += L'\b'; break;
                case L'f':  result += L'\f'; break;
                case L'n':  result += L'\n'; break;
                case L'r':  result += L'\r'; break;
                case L't':  result += L'\t'; break;
                default:    result += *p; break;
                }
            }
            else
            {
                result += *p;
            }
            ++p;
        }
        return result;
    }

    const char* StorageTypeToString(VBimPropertyStorageType t)
    {
        switch (t)
        {
        case VBimPropertyStorageType::Integer:   return "Integer";
        case VBimPropertyStorageType::Double:    return "Double";
        case VBimPropertyStorageType::ElementId: return "ElementId";
        case VBimPropertyStorageType::String:
        default:                                 return "String";
        }
    }

    inline OdResult SafeWriteBuiltInInt(OdBmProjectInfoPtr pTarget, OdBm::BuiltInParameter::Enum bip, OdInt32 val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBm::BuiltInParameter::Enum, const OdInt32&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(bip, val);
    }

    inline OdResult SafeWriteBuiltInDouble(OdBmProjectInfoPtr pTarget, OdBm::BuiltInParameter::Enum bip, double val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBm::BuiltInParameter::Enum, const double&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(bip, val);
    }

    inline OdResult SafeWriteBuiltInString(OdBmProjectInfoPtr pTarget, OdBm::BuiltInParameter::Enum bip, const OdString& val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBm::BuiltInParameter::Enum, const OdString&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(bip, val);
    }

    inline OdResult SafeWriteUserInt(OdBmProjectInfoPtr pTarget, const OdBmObjectId& id, OdInt32 val)
    {
        if (pTarget.isNull() || id.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBmObjectId&, const OdInt32&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(id, val);
    }

    inline OdResult SafeWriteUserDouble(OdBmProjectInfoPtr pTarget, const OdBmObjectId& id, double val)
    {
        if (pTarget.isNull() || id.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBmObjectId&, const double&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(id, val);
    }

    inline OdResult SafeWriteUserString(OdBmProjectInfoPtr pTarget, const OdBmObjectId& id, const OdString& val)
    {
        if (pTarget.isNull() || id.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBmObjectId&, const OdString&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(id, val);
    }

    // Parameter id used to look up the definition (choices, unit spec) of prop.
    OdBmObjectId DefinitionIdOf(OdBmDatabase* pDb, const VBimProjectProperty& prop)
    {
        if (!prop.paramId.isNull())
            return prop.paramId;
        if (pDb == nullptr || !prop.IsBuiltIn())
            return OdBmObjectId::kNull;
        return pDb->getObjectId(prop.builtInParam);
    }

    // True when text can be written to prop by WriteStagedValue().
    bool IsStageableValue(OdBmDatabase* pDb, const VBimProjectProperty& prop, const OdString& text)
    {
        const OdBmObjectId defId = DefinitionIdOf(pDb, prop);
        switch (prop.storageType)
        {
        case VBimPropertyStorageType::Integer:
        {
            OdInt32 value = 0;
            return vb::properties::detail::ParseIntegerValue(pDb, defId, text, value);
        }
        case VBimPropertyStorageType::Double:
        {
            double value = 0.0;
            return vb::properties::detail::ParseDoubleValue(pDb, defId, text, value);
        }
        case VBimPropertyStorageType::String:
            return true;
        default:
            return false;
        }
    }

    // Writes staged text to one Project Information parameter; Double text is in
    // display units and is converted to internal units.
    OdResult WriteStagedValue(OdBmDatabase* pDb, const OdBmProjectInfoPtr& pTarget,
        const VBimProjectProperty& prop, const OdString& text)
    {
        const bool byId = !prop.paramId.isNull();
        const OdBmObjectId defId = DefinitionIdOf(pDb, prop);
        switch (prop.storageType)
        {
        case VBimPropertyStorageType::Integer:
        {
            OdInt32 value = 0;
            if (!vb::properties::detail::ParseIntegerValue(pDb, defId, text, value))
                return eInvalidInput;
            return byId ? SafeWriteUserInt(pTarget, prop.paramId, value)
                        : SafeWriteBuiltInInt(pTarget, prop.builtInParam, value);
        }
        case VBimPropertyStorageType::Double:
        {
            double value = 0.0;
            if (!vb::properties::detail::ParseDoubleValue(pDb, defId, text, value))
                return eInvalidInput;
            return byId ? SafeWriteUserDouble(pTarget, prop.paramId, value)
                        : SafeWriteBuiltInDouble(pTarget, prop.builtInParam, value);
        }
        case VBimPropertyStorageType::String:
            return byId ? SafeWriteUserString(pTarget, prop.paramId, text)
                        : SafeWriteBuiltInString(pTarget, prop.builtInParam, text);
        default:
            return eNotApplicable;
        }
    }
}

// ---------------------------------------------------------------------------
// Construction & Lifecycle
// ---------------------------------------------------------------------------

VBimProjectProperties::VBimProjectProperties(OdBmDatabase* pDb, VBimUIDocument* pUIDoc)
    : targetDb_(pDb)
    , m_pUIDoc(pUIDoc)
{
    if (!targetDb_ && m_pUIDoc)
    {
        targetDb_ = m_pUIDoc->GetDatabase();
    }
}

VBimProjectProperties::~VBimProjectProperties() = default;

// ---------------------------------------------------------------------------
// Validation & State
// ---------------------------------------------------------------------------

bool VBimProjectProperties::IsValid() const noexcept
{
    if (!targetDb_)
        return false;
    OdBmObjectId projId = OdBmProjectInfo::getProjectInfoId(targetDb_);
    return !projId.isNull();
}

OdBmObjectId VBimProjectProperties::GetProjectInfoId() const
{
    if (!targetDb_)
        return OdBmObjectId::kNull;
    return OdBmProjectInfo::getProjectInfoId(targetDb_);
}

bool VBimProjectProperties::IsDirty() const noexcept
{
    return !m_stagedChanges.empty();
}

void VBimProjectProperties::DiscardChanges()
{
    m_stagedChanges.clear();
    m_cacheLoaded = false;
}

OdArray<VBimProjectProperty> VBimProjectProperties::GetModifiedProperties() const
{
    OdArray<VBimProjectProperty> result;
    if (m_stagedChanges.empty())
        return result;

    EnsureCacheLoaded();
    for (const auto& prop : m_cachedProps)
    {
        std::wstring keyName = ToLowerStd(prop.name);
        std::wstring keyInternal = ToLowerStd(prop.internalName);
        if (m_stagedChanges.find(keyName) != m_stagedChanges.end() ||
            (!keyInternal.empty() && m_stagedChanges.find(keyInternal) != m_stagedChanges.end()))
        {
            result.push_back(prop);
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Internal Cache Management
// ---------------------------------------------------------------------------

void VBimProjectProperties::EnsureCacheLoaded() const
{
    if (m_cacheLoaded)
        return;

    m_cachedProps.clear();
    m_cacheLoaded = true;

    if (!targetDb_)
        return;

    OdBmObjectId projId = OdBmProjectInfo::getProjectInfoId(targetDb_);
    if (projId.isNull())
        return;

    OdBmProjectInfoPtr pProjInfo = projId.openObject();
    if (pProjInfo.isNull())
        return;

    OdBmLabelUtilsPEPtr pLabelUtils = ODBM_LABELUTILS();

    // 1. Collect standard BIM Project Information BuiltInParameters
    struct StandardParamEntry
    {
        OdBm::BuiltInParameter::Enum bip;
        const wchar_t* fallbackName;
        const wchar_t* internalName;
        VBimPropertyStorageType storageType;
    };

    static const StandardParamEntry kStandardProjectParams[] = {
        { OdBm::BuiltInParameter::PROJECT_NAME,                     L"Project Name",             L"PROJECT_NAME",                     VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::PROJECT_NUMBER,                   L"Project Number",           L"PROJECT_NUMBER",                   VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::PROJECT_STATUS,                   L"Project Status",           L"PROJECT_STATUS",                   VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::CLIENT_NAME,                      L"Client Name",              L"CLIENT_NAME",                      VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::PROJECT_ADDRESS,                  L"Project Address",          L"PROJECT_ADDRESS",                  VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::PROJECT_ISSUE_DATE,              L"Project Issue Date",       L"PROJECT_ISSUE_DATE",              VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::PROJECT_AUTHOR,                  L"Author",                   L"PROJECT_AUTHOR",                  VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::PROJECT_BUILDING_NAME,           L"Building Name",            L"PROJECT_BUILDING_NAME",           VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::PROJECT_ORGANIZATION_NAME,       L"Organization Name",        L"PROJECT_ORGANIZATION_NAME",       VBimPropertyStorageType::String },
        { OdBm::BuiltInParameter::PROJECT_ORGANIZATION_DESCRIPTION,L"Organization Description", L"PROJECT_ORGANIZATION_DESCRIPTION",VBimPropertyStorageType::String }
    };

    std::map<OdInt64, bool> addedBips;

    // Add standard parameters first to guarantee order
    for (const auto& entry : kStandardProjectParams)
    {
        OdString displayName;
        if (!pLabelUtils.isNull())
            displayName = pLabelUtils->getLabelFor(entry.bip);
        if (displayName.isEmpty())
            displayName = entry.fallbackName;

        OdString val;
        pProjInfo->getParamValueAsString(entry.bip, val);

        VBimProjectProperty prop(displayName, entry.internalName, entry.bip, entry.storageType, val, false, L"Identity Data");
        RefreshCachedValue(prop);
        m_cachedProps.push_back(prop);
        addedBips[static_cast<OdInt64>(entry.bip)] = true;
    }

    // 2. Discover any additional parameters via getListParams
    OdBmParameterSet paramSet;
    pProjInfo->getListParams(paramSet);

    OdBuiltInParamArray extraBuiltIn;
    paramSet.getBuiltInParamsArray(extraBuiltIn);
    for (OdUInt32 i = 0; i < extraBuiltIn.size(); ++i)
    {
        OdBm::BuiltInParameter::Enum bip = extraBuiltIn[i];
        if (addedBips.find(static_cast<OdInt64>(bip)) != addedBips.end())
            continue;

        OdString internalName = OdBm::BuiltInParameter::toString(bip);
        OdString displayName;
        if (!pLabelUtils.isNull())
            displayName = pLabelUtils->getLabelFor(bip);
        if (displayName.isEmpty())
            displayName = internalName;

        OdString val;
        pProjInfo->getParamValueAsString(bip, val);

        VBimProjectProperty prop(displayName, internalName, bip, VBimPropertyStorageType::String, val, false, L"Other");
        RefreshCachedValue(prop);
        m_cachedProps.push_back(prop);
        addedBips[static_cast<OdInt64>(bip)] = true;
    }

    // 3. User / Shared Parameters attached to Project Information
    OdBmObjectIdArray userParams;
    paramSet.getUserParamsArray(userParams);
    for (OdUInt32 i = 0; i < userParams.size(); ++i)
    {
        const OdBmObjectId& paramElemId = userParams[i];
        if (paramElemId.isNull())
            continue;

        OdBmParamElemPtr pParamElem = paramElemId.openObject();
        if (pParamElem.isNull())
            continue;

        OdBmParamDefPtr pDef = pParamElem->getParamDef();
        if (pDef.isNull())
            continue;

        OdString caption = pDef->getCaption();
        if (caption.isEmpty())
            caption = pParamElem->getElementName();

        bool isReadOnly = pDef->getIsReadOnly();
        VBimPropertyStorageType sType = VBimPropertyStorageType::String;
        switch (pDef->getStorageType())
        {
        case OdBm::StorageType::Integer:   sType = VBimPropertyStorageType::Integer; break;
        case OdBm::StorageType::Double:    sType = VBimPropertyStorageType::Double; break;
        case OdBm::StorageType::ElementId: sType = VBimPropertyStorageType::ElementId; break;
        default:                           sType = VBimPropertyStorageType::String; break;
        }

        OdString val;
        pProjInfo->getParamValueAsString(paramElemId, val);

        VBimProjectProperty prop(caption, caption, static_cast<OdBm::BuiltInParameter::Enum>(-1), sType, val, isReadOnly, L"Project Parameters");
        prop.paramId = paramElemId;
        RefreshCachedValue(prop);
        m_cachedProps.push_back(prop);
    }
}

void VBimProjectProperties::RefreshCachedValue(VBimProjectProperty& prop) const
{
    // Apply staged change overlay if present
    std::wstring keyName = ToLowerStd(prop.name);
    auto it = m_stagedChanges.find(keyName);
    if (it != m_stagedChanges.end())
    {
        prop.value = it->second;
        return;
    }

    if (!prop.internalName.isEmpty())
    {
        std::wstring keyInternal = ToLowerStd(prop.internalName);
        auto itInt = m_stagedChanges.find(keyInternal);
        if (itInt != m_stagedChanges.end())
        {
            prop.value = itInt->second;
        }
    }
}

// ---------------------------------------------------------------------------
// 1. Query / Get
// ---------------------------------------------------------------------------

bool VBimProjectProperties::GetAllProperties(OdArray<VBimProjectProperty>& outProps) const
{
    outProps.clear();
    EnsureCacheLoaded();
    for (const auto& prop : m_cachedProps)
    {
        VBimProjectProperty p = prop;
        RefreshCachedValue(p);
        outProps.push_back(p);
    }
    return !outProps.isEmpty();
}

OdArray<VBimProjectProperty> VBimProjectProperties::GetAllProperties() const
{
    OdArray<VBimProjectProperty> arr;
    GetAllProperties(arr);
    return arr;
}

bool VBimProjectProperties::GetProperty(const OdString& nameOrInternalName, VBimProjectProperty& outProp) const
{
    EnsureCacheLoaded();
    for (const auto& prop : m_cachedProps)
    {
        if (EqualsIgnoreCase(prop.name, nameOrInternalName) ||
            (!prop.internalName.isEmpty() && EqualsIgnoreCase(prop.internalName, nameOrInternalName)))
        {
            outProp = prop;
            RefreshCachedValue(outProp);
            return true;
        }
    }
    return false;
}

bool VBimProjectProperties::GetProperty(OdBm::BuiltInParameter::Enum bip, VBimProjectProperty& outProp) const
{
    EnsureCacheLoaded();
    for (const auto& prop : m_cachedProps)
    {
        if (prop.builtInParam == bip)
        {
            outProp = prop;
            RefreshCachedValue(outProp);
            return true;
        }
    }
    return false;
}

OdString VBimProjectProperties::GetString(const OdString& name, const OdString& defaultVal) const
{
    VBimProjectProperty prop;
    if (GetProperty(name, prop))
        return prop.value;
    return defaultVal;
}

OdString VBimProjectProperties::GetString(OdBm::BuiltInParameter::Enum bip, const OdString& defaultVal) const
{
    VBimProjectProperty prop;
    if (GetProperty(bip, prop))
        return prop.value;
    return defaultVal;
}

int VBimProjectProperties::GetInt(const OdString& name, int defaultVal) const
{
    VBimProjectProperty prop;
    if (GetProperty(name, prop))
        return prop.AsInt(defaultVal);
    return defaultVal;
}

double VBimProjectProperties::GetDouble(const OdString& name, double defaultVal) const
{
    VBimProjectProperty prop;
    if (GetProperty(name, prop))
        return prop.AsDouble(defaultVal);
    return defaultVal;
}

bool VBimProjectProperties::GetBool(const OdString& name, bool defaultVal) const
{
    VBimProjectProperty prop;
    if (GetProperty(name, prop))
        return prop.AsBool(defaultVal);
    return defaultVal;
}

OdString VBimProjectProperties::GetProjectName() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_NAME);
}

OdString VBimProjectProperties::GetProjectNumber() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_NUMBER);
}

OdString VBimProjectProperties::GetProjectStatus() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_STATUS);
}

OdString VBimProjectProperties::GetClientName() const
{
    return GetString(OdBm::BuiltInParameter::CLIENT_NAME);
}

OdString VBimProjectProperties::GetProjectAddress() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_ADDRESS);
}

OdString VBimProjectProperties::GetIssueDate() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_ISSUE_DATE);
}

OdString VBimProjectProperties::GetAuthor() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_AUTHOR);
}

OdString VBimProjectProperties::GetBuildingName() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_BUILDING_NAME);
}

OdString VBimProjectProperties::GetOrganizationName() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_ORGANIZATION_NAME);
}

OdString VBimProjectProperties::GetOrganizationDescription() const
{
    return GetString(OdBm::BuiltInParameter::PROJECT_ORGANIZATION_DESCRIPTION);
}

// ---------------------------------------------------------------------------
// 2. Modify / Set
// ---------------------------------------------------------------------------

bool VBimProjectProperties::SetProperty(const OdString& nameOrInternalName, const OdString& value)
{
    EnsureCacheLoaded();
    for (auto& prop : m_cachedProps)
    {
        if (EqualsIgnoreCase(prop.name, nameOrInternalName) ||
            (!prop.internalName.isEmpty() && EqualsIgnoreCase(prop.internalName, nameOrInternalName)))
        {
            if (prop.isReadOnly)
                return false;
            if (!IsStageableValue(targetDb_, prop, value))
                return false;

            prop.value = value;
            m_stagedChanges[ToLowerStd(prop.name)] = value;
            if (!prop.internalName.isEmpty())
                m_stagedChanges[ToLowerStd(prop.internalName)] = value;
            return true;
        }
    }
    return false;
}

bool VBimProjectProperties::SetProperty(OdBm::BuiltInParameter::Enum bip, const OdString& value)
{
    EnsureCacheLoaded();
    for (auto& prop : m_cachedProps)
    {
        if (prop.builtInParam == bip)
        {
            if (prop.isReadOnly)
                return false;
            if (!IsStageableValue(targetDb_, prop, value))
                return false;

            prop.value = value;
            m_stagedChanges[ToLowerStd(prop.name)] = value;
            if (!prop.internalName.isEmpty())
                m_stagedChanges[ToLowerStd(prop.internalName)] = value;
            return true;
        }
    }
    return false;
}

bool VBimProjectProperties::SetProperty(const OdString& name, int value)
{
    OdString s;
    s.format(L"%d", value);
    return SetProperty(name, s);
}

bool VBimProjectProperties::SetProperty(const OdString& name, double value, int precision)
{
    OdString fmt;
    fmt.format(L"%%.%df", precision);
    OdString s;
    s.format(fmt.c_str(), value);
    return SetProperty(name, s);
}

bool VBimProjectProperties::SetProperty(const OdString& name, bool value)
{
    return SetProperty(name, value ? OdString(L"1") : OdString(L"0"));
}

bool VBimProjectProperties::SetProperties(const OdArray<VBimProjectProperty>& props)
{
    bool anySet = false;
    for (OdUInt32 i = 0; i < props.size(); ++i)
    {
        const auto& p = props[i];
        if (p.IsBuiltIn())
        {
            if (SetProperty(p.builtInParam, p.value))
                anySet = true;
        }
        else
        {
            if (SetProperty(p.name, p.value))
                anySet = true;
        }
    }
    return anySet;
}

bool VBimProjectProperties::SetProjectName(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_NAME, val);
}

bool VBimProjectProperties::SetProjectNumber(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_NUMBER, val);
}

bool VBimProjectProperties::SetProjectStatus(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_STATUS, val);
}

bool VBimProjectProperties::SetClientName(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::CLIENT_NAME, val);
}

bool VBimProjectProperties::SetProjectAddress(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_ADDRESS, val);
}

bool VBimProjectProperties::SetIssueDate(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_ISSUE_DATE, val);
}

bool VBimProjectProperties::SetAuthor(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_AUTHOR, val);
}

bool VBimProjectProperties::SetBuildingName(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_BUILDING_NAME, val);
}

bool VBimProjectProperties::SetOrganizationName(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_ORGANIZATION_NAME, val);
}

bool VBimProjectProperties::SetOrganizationDescription(const OdString& val)
{
    return SetProperty(OdBm::BuiltInParameter::PROJECT_ORGANIZATION_DESCRIPTION, val);
}

// ---------------------------------------------------------------------------
// 3. Sync & Commit
// ---------------------------------------------------------------------------

bool VBimProjectProperties::Sync(bool bRefreshUI, const OdString& undoActionName)
{
    if (!IsValid())
        return false;

    if (m_stagedChanges.empty())
        return true; // Nothing to commit, already in sync

    OdBmObjectId projId = OdBmProjectInfo::getProjectInfoId(targetDb_);
    if (projId.isNull())
        return false;

    // 1. Capture Undo Snapshot before mutations if UIDocument is present
    std::shared_ptr<OdaSnapshotDeltaAction> pSnapshot;
    if (m_pUIDoc)
    {
        pSnapshot = m_pUIDoc->RecordSnapshot(projId, undoActionName);
    }

    // 2. Open an explicit atomic database transaction. OdBmTransaction does not start
    //    itself in its constructor; start() is required before any write.
    OdExplicitTransaction transaction(targetDb_);
    bool allWritesOk = true;

    try
    {
        transaction.start();

        OdBmProjectInfoPtr pProjInfo = projId.openObject();
        if (pProjInfo.isNull())
        {
            transaction.rollback();
            return false;
        }

        EnsureCacheLoaded();

        for (const auto& prop : m_cachedProps)
        {
            std::wstring keyName = ToLowerStd(prop.name);
            std::wstring keyInternal = ToLowerStd(prop.internalName);

            auto it = m_stagedChanges.find(keyName);
            if (it == m_stagedChanges.end() && !keyInternal.empty())
                it = m_stagedChanges.find(keyInternal);

            if (it == m_stagedChanges.end())
                continue;

            if (prop.isReadOnly)
                continue;

            const OdString& newVal = it->second;

            if (!prop.IsBuiltIn() && !prop.IsUserParam())
                continue;
            if (WriteStagedValue(targetDb_, pProjInfo, prop, newVal) != eOk)
            {
                ODA_TRACE1("VBimProjectProperties::Sync setParam failed for %ls\n", prop.name.c_str());
                allWritesOk = false;
            }
        }

        // A failed write aborts the whole Sync: roll back, keep the staged edits
        // so the caller can inspect or retry them, and report failure.
        if (!allWritesOk)
        {
            transaction.rollback();
            return false;
        }

        // Commit transaction to database
        transaction.commit();
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimProjectProperties::Sync OdError: %ls\n", e.description().c_str());
        return false;
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimProjectProperties::Sync exception: %hs\n", e.what());
        return false;
    }

    // 3. Finalize Undo snapshot registration
    // Inside an Automatic VBimCommand the step is recorded after the command commits.
    if (pSnapshot && m_pUIDoc)
        vb::commands::detail::RecordOrDeferUndoSnapshot(m_pUIDoc, pSnapshot);

    // 4. Clear staging and invalidate cache for fresh queries
    m_stagedChanges.clear();
    m_cacheLoaded = false;

    // 5. Refresh UI components if requested
    if (bRefreshUI && m_pUIDoc)
    {
        m_pUIDoc->RefreshActiveView();
        m_pUIDoc->RefreshProjectBrowser();
    }

    // 6. Notify registered observers
    for (const auto& cb : m_callbacks)
    {
        if (cb)
            cb(projId);
    }

    return true;
}

// ---------------------------------------------------------------------------
// 4. Value-Add Enhancements (JSON, Validation, Observers)
// ---------------------------------------------------------------------------

OdString VBimProjectProperties::ToJson(bool formatted) const
{
    EnsureCacheLoaded();

    const wchar_t* nl = formatted ? L"\n" : L"";
    const wchar_t* sp = formatted ? L"  " : L"";
    const wchar_t* sp2 = formatted ? L"    " : L"";
    const wchar_t* sp3 = formatted ? L"      " : L"";

    OdString json;
    json += L"{";
    json += nl;

    // Metadata summary block
    json += sp; json += L"\"projectInformation\": {"; json += nl;
    json += sp2; json += L"\"projectNumber\": \""; json += EscapeJsonString(GetProjectNumber()); json += L"\","; json += nl;
    json += sp2; json += L"\"projectName\": \""; json += EscapeJsonString(GetProjectName()); json += L"\","; json += nl;
    json += sp2; json += L"\"projectStatus\": \""; json += EscapeJsonString(GetProjectStatus()); json += L"\","; json += nl;
    json += sp2; json += L"\"clientName\": \""; json += EscapeJsonString(GetClientName()); json += L"\","; json += nl;
    json += sp2; json += L"\"projectAddress\": \""; json += EscapeJsonString(GetProjectAddress()); json += L"\","; json += nl;
    json += sp2; json += L"\"issueDate\": \""; json += EscapeJsonString(GetIssueDate()); json += L"\","; json += nl;
    json += sp2; json += L"\"author\": \""; json += EscapeJsonString(GetAuthor()); json += L"\","; json += nl;
    json += sp2; json += L"\"buildingName\": \""; json += EscapeJsonString(GetBuildingName()); json += L"\","; json += nl;
    json += sp2; json += L"\"organizationName\": \""; json += EscapeJsonString(GetOrganizationName()); json += L"\","; json += nl;
    json += sp2; json += L"\"organizationDescription\": \""; json += EscapeJsonString(GetOrganizationDescription()); json += L"\""; json += nl;
    json += sp; json += L"},"; json += nl;

    // Detailed properties list
    json += sp; json += L"\"properties\": ["; json += nl;
    for (size_t i = 0; i < m_cachedProps.size(); ++i)
    {
        const auto& p = m_cachedProps[i];
        json += sp2; json += L"{"; json += nl;
        json += sp3; json += L"\"name\": \""; json += EscapeJsonString(p.name); json += L"\","; json += nl;
        json += sp3; json += L"\"internalName\": \""; json += EscapeJsonString(p.internalName); json += L"\","; json += nl;
        json += sp3; json += L"\"storageType\": \""; json += StorageTypeToString(p.storageType); json += L"\","; json += nl;
        json += sp3; json += L"\"value\": \""; json += EscapeJsonString(p.value); json += L"\","; json += nl;
        json += sp3; json += L"\"isReadOnly\": "; json += (p.isReadOnly ? L"true" : L"false"); json += L","; json += nl;
        json += sp3; json += L"\"group\": \""; json += EscapeJsonString(p.group); json += L"\""; json += nl;
        json += sp2; json += L"}";
        if (i + 1 < m_cachedProps.size())
            json += L",";
        json += nl;
    }
    json += sp; json += L"]"; json += nl;
    json += L"}";

    return json;
}

bool VBimProjectProperties::FromJson(const OdString& jsonString, bool autoSync)
{
    if (jsonString.isEmpty())
        return false;

    // Lightweight robust JSON key/value scanner
    bool anyChanged = false;

    auto ExtractStringField = [&](const wchar_t* key) -> OdString {
        std::wstring pattern = L"\"";
        pattern += key;
        pattern += L"\"";
        int idx = jsonString.find(pattern.c_str());
        if (idx < 0)
            return OdString::kEmpty;

        int colon = jsonString.find(L":", idx + static_cast<int>(pattern.length()));
        if (colon < 0)
            return OdString::kEmpty;

        int firstQuote = jsonString.find(L"\"", colon + 1);
        if (firstQuote < 0)
            return OdString::kEmpty;

        int secondQuote = -1;
        for (int p = firstQuote + 1; p < jsonString.getLength(); ++p)
        {
            if (jsonString[p] == L'\"' && jsonString[p - 1] != L'\\')
            {
                secondQuote = p;
                break;
            }
        }
        if (secondQuote <= firstQuote)
            return OdString::kEmpty;

        OdString rawVal = jsonString.mid(firstQuote + 1, secondQuote - firstQuote - 1);
        return UnescapeJsonString(rawVal);
    };

    struct KnownKey
    {
        const wchar_t* jsonKey;
        OdBm::BuiltInParameter::Enum bip;
    };

    static const KnownKey kKnown[] = {
        { L"projectName",             OdBm::BuiltInParameter::PROJECT_NAME },
        { L"projectNumber",           OdBm::BuiltInParameter::PROJECT_NUMBER },
        { L"projectStatus",           OdBm::BuiltInParameter::PROJECT_STATUS },
        { L"clientName",              OdBm::BuiltInParameter::CLIENT_NAME },
        { L"projectAddress",          OdBm::BuiltInParameter::PROJECT_ADDRESS },
        { L"issueDate",              OdBm::BuiltInParameter::PROJECT_ISSUE_DATE },
        { L"author",                 OdBm::BuiltInParameter::PROJECT_AUTHOR },
        { L"buildingName",           OdBm::BuiltInParameter::PROJECT_BUILDING_NAME },
        { L"organizationName",       OdBm::BuiltInParameter::PROJECT_ORGANIZATION_NAME },
        { L"organizationDescription",OdBm::BuiltInParameter::PROJECT_ORGANIZATION_DESCRIPTION }
    };

    for (const auto& item : kKnown)
    {
        OdString val = ExtractStringField(item.jsonKey);
        if (!val.isEmpty())
        {
            if (SetProperty(item.bip, val))
                anyChanged = true;
        }
    }

    // Also parse "properties" array to import user/shared and custom project parameters
    int propsPos = jsonString.find(L"\"properties\"");
    if (propsPos >= 0)
    {
        int arrayStart = jsonString.find(L"[", propsPos);
        int arrayEnd = (arrayStart >= 0) ? jsonString.find(L"]", arrayStart) : -1;
        if (arrayStart >= 0 && arrayEnd > arrayStart)
        {
            int current = arrayStart;
            while (current < arrayEnd)
            {
                int objStart = jsonString.find(L"{", current);
                if (objStart < 0 || objStart >= arrayEnd)
                    break;
                int objEnd = jsonString.find(L"}", objStart);
                if (objEnd < 0 || objEnd > arrayEnd)
                    break;

                OdString objStr = jsonString.mid(objStart, objEnd - objStart + 1);

                auto extractPropField = [&objStr](const wchar_t* fieldName) -> OdString {
                    std::wstring key = L"\"";
                    key += fieldName;
                    key += L"\"";
                    int kpos = objStr.find(key.c_str());
                    if (kpos < 0) return OdString::kEmpty;
                    int colon = objStr.find(L":", kpos + static_cast<int>(key.length()));
                    if (colon < 0) return OdString::kEmpty;
                    int valStart = objStr.find(L"\"", colon);
                    if (valStart < 0) return OdString::kEmpty;
                    int valEnd = -1;
                    for (int p = valStart + 1; p < objStr.getLength(); ++p)
                    {
                        if (objStr[p] == L'\"' && objStr[p - 1] != L'\\')
                        {
                            valEnd = p;
                            break;
                        }
                    }
                    if (valEnd <= valStart) return OdString::kEmpty;
                    return UnescapeJsonString(objStr.mid(valStart + 1, valEnd - valStart - 1));
                };

                OdString pName = extractPropField(L"name");
                OdString pInternal = extractPropField(L"internalName");
                OdString pVal = extractPropField(L"value");

                if (!pName.isEmpty())
                {
                    if (SetProperty(pName, pVal))
                        anyChanged = true;
                    else if (!pInternal.isEmpty() && SetProperty(pInternal, pVal))
                        anyChanged = true;
                }

                current = objEnd + 1;
            }
        }
    }

    if (anyChanged && autoSync)
    {
        Sync(true, L"Import Project Properties JSON");
    }

    return anyChanged;
}

bool VBimProjectProperties::ValidateProperty(const OdString& name, const OdString& value, OdString& outError) const
{
    VBimProjectProperty prop;
    if (!GetProperty(name, prop))
    {
        outError = L"Property not found in Project Information";
        return false;
    }

    if (prop.isReadOnly)
    {
        outError = L"Property is read-only and cannot be modified";
        return false;
    }

    // Same parsing as SetProperty()/Sync(): numeric text must parse (empty text does not).
    const bool numeric = prop.storageType == VBimPropertyStorageType::Integer
        || prop.storageType == VBimPropertyStorageType::Double;
    if (numeric && !IsStageableValue(targetDb_, prop, value))
    {
        outError = prop.storageType == VBimPropertyStorageType::Integer
            ? L"Value must be a valid integer"
            : L"Value must be a valid floating-point number";
        return false;
    }

    outError.empty();
    return true;
}

void VBimProjectProperties::RegisterOnSyncedCallback(OnSyncedCallback cb)
{
    if (cb)
        m_callbacks.push_back(std::move(cb));
}
