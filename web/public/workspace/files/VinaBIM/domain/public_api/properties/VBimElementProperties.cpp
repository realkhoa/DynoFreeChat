// VBimElementProperties.cpp
//
// Implementation of VBimElementProperties facade.
//
#include "pch.h"
#include "domain/public_api/properties/VBimElementProperties.h"
#include "domain/public_api/properties/VBimPropertiesPaneScope.h"
#include "domain/public_api/app/VBimUIDocument.h"
#include "Infrastructure/Oda/undo/OdaSnapshotDeltaAction.h"
#include "domain/public_api/command/internal/VBimDeferredUndo.h"
#include "Infrastructure/Oda/sdk_includes/BmSdkUiCompat.h"
#include "domain/public_api/properties/internal/VBimPropertyValueParser.h"

#include "Database/BmDatabase.h"
#include "Database/BmElement.h"
#include "Family/Entities/BmFamilyInstance.h"
#include "Family/Entities/BmFamilySymbol.h"
#include "Database/Entities/BmParamElem.h"
#include "Database/Entities/BmParamDef.h"
#include "Database/PE/BmLabelUtilsPE.h"
#include "Base/BmParameterSet.h"
#include "Database/BmTransaction.h"
#include "Database/BmUnitUtils.h"
#include "Managers/BmUnitsTracking.h"
#include "Database/Entities/BmUnitsElem.h"
#include "Infrastructure/Oda/CommonDef/OdExplicitTransaction.h"
#include "OdaCommon.h"

#include <algorithm>
#include <cwctype>
#include <sstream>
#include <iomanip>

namespace
{
    std::wstring ToLowerStd(const OdString& str)
    {
        std::wstring s = str.c_str();
        std::transform(s.begin(), s.end(), s.begin(), [](wchar_t c) {
            return static_cast<wchar_t>(std::towlower(c));
        });
        return s;
    }

    std::string EscapeJsonString(const std::string& input)
    {
        std::string output;
        output.reserve(input.size() + 16);
        for (char c : input)
        {
            switch (c)
            {
            case '"':  output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\b': output += "\\b";  break;
            case '\f': output += "\\f";  break;
            case '\n': output += "\\n";  break;
            case '\r': output += "\\r";  break;
            case '\t': output += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20)
                {
                    char buf[8];
                    sprintf_s(buf, "\\u%04x", static_cast<unsigned char>(c));
                    output += buf;
                }
                else
                {
                    output += c;
                }
                break;
            }
        }
        return output;
    }

    std::string OdStringToUtf8(const OdString& odStr)
    {
        if (odStr.isEmpty())
            return std::string();

        const wchar_t* wstr = odStr.c_str();
        int sizeNeeded = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0, nullptr, nullptr);
        if (sizeNeeded <= 0)
            return std::string();

        std::string result(static_cast<size_t>(sizeNeeded) - 1, 0);
        WideCharToMultiByte(CP_UTF8, 0, wstr, -1, &result[0], sizeNeeded, nullptr, nullptr);
        return result;
    }

    OdString Utf8ToOdString(const std::string& utf8Str)
    {
        if (utf8Str.empty())
            return OdString::kEmpty;

        int sizeNeeded = MultiByteToWideChar(CP_UTF8, 0, utf8Str.c_str(), -1, nullptr, 0);
        if (sizeNeeded <= 0)
            return OdString::kEmpty;

        std::wstring wstr(static_cast<size_t>(sizeNeeded) - 1, 0);
        MultiByteToWideChar(CP_UTF8, 0, utf8Str.c_str(), -1, &wstr[0], sizeNeeded);
        return OdString(wstr.c_str());
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

    inline OdResult SafeWriteBuiltInInt(OdBmElementPtr pTarget, OdBm::BuiltInParameter::Enum bip, OdInt32 val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBm::BuiltInParameter::Enum, const OdInt32&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(bip, val);
    }

    inline OdResult SafeWriteBuiltInDouble(OdBmElementPtr pTarget, OdBm::BuiltInParameter::Enum bip, double val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBm::BuiltInParameter::Enum, const double&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(bip, val);
    }

    inline OdResult SafeWriteBuiltInString(OdBmElementPtr pTarget, OdBm::BuiltInParameter::Enum bip, const OdString& val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBm::BuiltInParameter::Enum, const OdString&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(bip, val);
    }

    inline OdResult SafeWriteUserInt(OdBmElementPtr pTarget, const OdBmObjectId& paramId, OdInt32 val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBmObjectId&, const OdInt32&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(paramId, val);
    }

    inline OdResult SafeWriteUserDouble(OdBmElementPtr pTarget, const OdBmObjectId& paramId, double val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBmObjectId&, const double&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(paramId, val);
    }

    inline OdResult SafeWriteUserString(OdBmElementPtr pTarget, const OdBmObjectId& paramId, const OdString& val)
    {
        if (pTarget.isNull()) return eNullPtr;
        auto fn = static_cast<OdResult (OdBmElement::*)(const OdBmObjectId&, const OdString&)>(&OdBmElement::setParam);
        return (pTarget.get()->*fn)(paramId, val);
    }

    // Parameter id used to look up the definition (choices, unit spec) of prop.
    OdBmObjectId DefinitionIdOf(OdBmDatabase* pDb, const VBimElementProperty& prop)
    {
        if (!prop.paramId.isNull())
            return prop.paramId;
        if (pDb == nullptr || !prop.IsBuiltIn())
            return OdBmObjectId::kNull;
        return pDb->getObjectId(prop.builtInParam);
    }

    // True when text can be written to prop by WriteStagedValue(). ElementId
    // parameters take an element, not text, so they are never staged.
    bool IsStageableValue(OdBmDatabase* pDb, const VBimElementProperty& prop, const OdString& text)
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

    // Writes staged text to one parameter of pTarget, parsed the way SetProperty() validated it.
    OdResult WriteStagedValue(OdBmDatabase* pDb, const OdBmElementPtr& pTarget,
        const VBimElementProperty& prop, const OdString& text)
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

    OdBmObjectId ResolveTypeIdInternal(const OdBmElementPtr& pElem)
    {
        if (pElem.isNull())
            return OdBmObjectId::kNull;

        if (pElem->isKindOf(OdBmFamilyInstance::desc()))
        {
            OdBmFamilyInstancePtr pFamInst = OdBmFamilyInstance::cast(pElem);
            if (!pFamInst.isNull())
            {
                OdBmObjectId symId = pFamInst->getMasterSymbolId();
                if (!symId.isNull())
                    return symId;
                symId = pFamInst->getFamilySymbolId();
                if (!symId.isNull())
                    return symId;
            }
        }

        OdBmObjectId typeId;
        if (pElem->getParam(OdBm::BuiltInParameter::ELEM_TYPE_PARAM, typeId) == eOk && !typeId.isNull())
        {
            return typeId;
        }

        return OdBmObjectId::kNull;
    }

    void CollectParametersInternal(
        const OdBmElementPtr& pElem,
        OdBmDatabase* pDb,
        std::vector<VBimElementProperty>& outList)
    {
        if (pElem.isNull() || !pDb)
            return;

        const OdBmLabelUtilsPEPtr pLabelUtils = ODBM_LABELUTILS();

        OdBmParameterSet paramSet;
        pElem->getListParams(paramSet);

        std::map<OdInt64, bool> seenBips;

        // 1. Built-in parameters
        for (OdBm::BuiltInParameter::Enum bip : paramSet.getBuiltInParamsIterator())
        {
            if (seenBips.find(static_cast<OdInt64>(bip)) != seenBips.end())
                continue;

            const OdBmObjectId paramId = pDb->getObjectId(bip);
            if (paramId.isNull())
                continue;

            OdBmParamElemPtr pParamElem = OdBmParamElem::cast(paramId.safeOpenObject());
            if (pParamElem.isNull())
                continue;

            OdBmParamDefPtr pDef = pParamElem->getParamDef();
            if (pDef.isNull())
                continue;

            OdString val;
            pElem->getParamValueAsString(paramId, val);

            OdString displayName;
            if (!pLabelUtils.isNull())
                displayName = pLabelUtils->getLabelFor(bip);
            if (displayName.isEmpty())
                displayName = pDef->getCaption();
            if (displayName.isEmpty())
                displayName = OdBm::BuiltInParameter::toString(bip);

            OdString groupName = VbimGetLabelForGroup(pDef->getGroupTypeId());
            if (groupName.isEmpty())
                groupName = L"Other";

            bool isReadOnly = pDef->getIsReadOnly();
            VBimPropertyStorageType sType = VBimPropertyStorageType::String;
            switch (pDef->getStorageType())
            {
            case OdBm::StorageType::Integer:   sType = VBimPropertyStorageType::Integer; break;
            case OdBm::StorageType::Double:    sType = VBimPropertyStorageType::Double; break;
            case OdBm::StorageType::ElementId: sType = VBimPropertyStorageType::ElementId; break;
            default:                           sType = VBimPropertyStorageType::String; break;
            }

            OdString internalName = OdBm::BuiltInParameter::toString(bip);
            VBimElementProperty prop(displayName, internalName, bip, sType, val, isReadOnly, groupName);
            prop.paramId = paramId;
            outList.push_back(prop);
            seenBips[static_cast<OdInt64>(bip)] = true;
        }

        // 2. User / Shared parameters
        for (const OdBmObjectId& userParamId : paramSet.getUserParamsIterator())
        {
            if (userParamId.isNull())
                continue;

            OdBmParamElemPtr pParamElem = OdBmParamElem::cast(userParamId.safeOpenObject());
            if (pParamElem.isNull())
                continue;

            OdBmParamDefPtr pDef = pParamElem->getParamDef();
            if (pDef.isNull())
                continue;

            OdString val;
            pElem->getParamValueAsString(userParamId, val);

            OdString caption = pDef->getCaption();
            if (caption.isEmpty())
                caption = pParamElem->getElementName();

            OdString groupName = VbimGetLabelForGroup(pDef->getGroupTypeId());
            if (groupName.isEmpty())
                groupName = L"Other";

            bool isReadOnly = pDef->getIsReadOnly();
            VBimPropertyStorageType sType = VBimPropertyStorageType::String;
            switch (pDef->getStorageType())
            {
            case OdBm::StorageType::Integer:   sType = VBimPropertyStorageType::Integer; break;
            case OdBm::StorageType::Double:    sType = VBimPropertyStorageType::Double; break;
            case OdBm::StorageType::ElementId: sType = VBimPropertyStorageType::ElementId; break;
            default:                           sType = VBimPropertyStorageType::String; break;
            }

            VBimElementProperty prop(caption, caption, static_cast<OdBm::BuiltInParameter::Enum>(-1), sType, val, isReadOnly, groupName);
            prop.paramId = userParamId;
            outList.push_back(prop);
        }
    }
} // namespace

// ---------------------------------------------------------------------------
// Lifecycle & Constructors
// ---------------------------------------------------------------------------

VBimElementProperties::VBimElementProperties()
    : targetDb_(nullptr)
    , m_elementId(OdBmObjectId::kNull)
    , m_pUIDoc(nullptr)
    , m_cacheLoaded(false)
    , m_typeCacheLoaded(false)
{
}

VBimElementProperties::VBimElementProperties(
    OdBmDatabase* pDb,
    const OdBmObjectId& elementId,
    VBimUIDocument* pUIDoc)
    : targetDb_(pDb)
    , m_elementId(elementId)
    , m_pUIDoc(pUIDoc)
    , m_cacheLoaded(false)
    , m_typeCacheLoaded(false)
{
}

VBimElementProperties::VBimElementProperties(const VBimElementProperties& other)
    : targetDb_(other.targetDb_)
    , m_elementId(other.m_elementId)
    , m_pUIDoc(other.m_pUIDoc)
    , m_cacheLoaded(other.m_cacheLoaded)
    , m_cachedProps(other.m_cachedProps)
    , m_typeCacheLoaded(other.m_typeCacheLoaded)
    , m_cachedTypeId(other.m_cachedTypeId)
    , m_cachedTypeProps(other.m_cachedTypeProps)
    , m_stagedChanges(other.m_stagedChanges)
    , m_stagedTypeChanges(other.m_stagedTypeChanges)
{
}

VBimElementProperties& VBimElementProperties::operator=(const VBimElementProperties& other)
{
    if (this != &other)
    {
        targetDb_ = other.targetDb_;
        m_elementId = other.m_elementId;
        m_pUIDoc = other.m_pUIDoc;
        m_cacheLoaded = other.m_cacheLoaded;
        m_cachedProps = other.m_cachedProps;
        m_typeCacheLoaded = other.m_typeCacheLoaded;
        m_cachedTypeId = other.m_cachedTypeId;
        m_cachedTypeProps = other.m_cachedTypeProps;
        m_stagedChanges = other.m_stagedChanges;
        m_stagedTypeChanges = other.m_stagedTypeChanges;
    }
    return *this;
}

VBimElementProperties::VBimElementProperties(VBimElementProperties&& other) noexcept
    : targetDb_(other.targetDb_)
    , m_elementId(other.m_elementId)
    , m_pUIDoc(other.m_pUIDoc)
    , m_cacheLoaded(other.m_cacheLoaded)
    , m_cachedProps(std::move(other.m_cachedProps))
    , m_typeCacheLoaded(other.m_typeCacheLoaded)
    , m_cachedTypeId(other.m_cachedTypeId)
    , m_cachedTypeProps(std::move(other.m_cachedTypeProps))
    , m_stagedChanges(std::move(other.m_stagedChanges))
    , m_stagedTypeChanges(std::move(other.m_stagedTypeChanges))
{
    other.targetDb_ = nullptr;
    other.m_elementId = OdBmObjectId::kNull;
    other.m_pUIDoc = nullptr;
    other.m_cacheLoaded = false;
    other.m_typeCacheLoaded = false;
    other.m_cachedTypeId = OdBmObjectId::kNull;
}

VBimElementProperties& VBimElementProperties::operator=(VBimElementProperties&& other) noexcept
{
    if (this != &other)
    {
        targetDb_ = other.targetDb_;
        m_elementId = other.m_elementId;
        m_pUIDoc = other.m_pUIDoc;
        m_cacheLoaded = other.m_cacheLoaded;
        m_cachedProps = std::move(other.m_cachedProps);
        m_typeCacheLoaded = other.m_typeCacheLoaded;
        m_cachedTypeId = other.m_cachedTypeId;
        m_cachedTypeProps = std::move(other.m_cachedTypeProps);
        m_stagedChanges = std::move(other.m_stagedChanges);
        m_stagedTypeChanges = std::move(other.m_stagedTypeChanges);

        other.targetDb_ = nullptr;
        other.m_elementId = OdBmObjectId::kNull;
        other.m_pUIDoc = nullptr;
        other.m_cacheLoaded = false;
        other.m_typeCacheLoaded = false;
        other.m_cachedTypeId = OdBmObjectId::kNull;
    }
    return *this;
}

VBimElementProperties::~VBimElementProperties()
{
}

// ---------------------------------------------------------------------------
// Identification & State
// ---------------------------------------------------------------------------

bool VBimElementProperties::IsValid() const noexcept
{
    return targetDb_ != nullptr && !m_elementId.isNull() && m_elementId.isValid();
}

OdBmObjectId VBimElementProperties::GetElementId() const noexcept
{
    return m_elementId;
}

OdString VBimElementProperties::GetElementName() const
{
    if (!IsValid())
        return OdString::kEmpty;

    try
    {
        OdBmElementPtr pElem = OdBmElement::cast(m_elementId.safeOpenObject());
        if (!pElem.isNull())
            return pElem->getElementName();
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::GetElementName OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::GetElementName exception: %hs\n", e.what());
    }
    return OdString::kEmpty;
}

OdString VBimElementProperties::GetCategoryName() const
{
    if (!IsValid())
        return OdString::kEmpty;

    try
    {
        OdBmElementPtr pElem = OdBmElement::cast(m_elementId.safeOpenObject());
        if (pElem.isNull())
            return OdString::kEmpty;

        OdString catName;
        const OdBmObjectId catParamId = targetDb_->getObjectId(OdBm::BuiltInParameter::ELEM_CATEGORY_PARAM);
        if (!catParamId.isNull())
            pElem->getParamValueAsString(catParamId, catName);

        if (catName.isEmpty())
            catName = pElem->getElementName();

        return catName;
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::GetCategoryName OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::GetCategoryName exception: %hs\n", e.what());
    }
    return OdString::kEmpty;
}

bool VBimElementProperties::IsFamilyInstance() const
{
    if (!IsValid())
        return false;

    try
    {
        OdBmElementPtr pElem = OdBmElement::cast(m_elementId.safeOpenObject());
        return !pElem.isNull() && pElem->isKindOf(OdBmFamilyInstance::desc());
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::IsFamilyInstance OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::IsFamilyInstance exception: %hs\n", e.what());
    }
    return false;
}

bool VBimElementProperties::HasType() const
{
    return !GetTypeId().isNull();
}

OdBmObjectId VBimElementProperties::GetTypeId() const
{
    if (!IsValid())
        return OdBmObjectId::kNull;

    if (m_typeCacheLoaded)
        return m_cachedTypeId;

    try
    {
        OdBmElementPtr pElem = OdBmElement::cast(m_elementId.safeOpenObject());
        m_cachedTypeId = ResolveTypeIdInternal(pElem);
        return m_cachedTypeId;
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::GetTypeId OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::GetTypeId exception: %hs\n", e.what());
    }
    return OdBmObjectId::kNull;
}

OdString VBimElementProperties::GetTypeName() const
{
    OdBmObjectId typeId = GetTypeId();
    if (typeId.isNull())
        return OdString::kEmpty;

    try
    {
        OdBmElementPtr pTypeElem = OdBmElement::cast(typeId.safeOpenObject());
        if (pTypeElem.isNull())
            return OdString::kEmpty;

        if (pTypeElem->isKindOf(OdBmFamilySymbol::desc()))
        {
            OdBmFamilySymbolPtr pSym = OdBmFamilySymbol::cast(pTypeElem);
            if (!pSym.isNull())
                return pSym->getTypeName();
        }
        return pTypeElem->getElementName();
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::GetTypeName OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::GetTypeName exception: %hs\n", e.what());
    }
    return OdString::kEmpty;
}

// ---------------------------------------------------------------------------
// Instance Parameters (Query)
// ---------------------------------------------------------------------------

std::vector<VBimElementProperty> VBimElementProperties::GetProperties() const
{
    EnsureCacheLoaded();
    std::vector<VBimElementProperty> result = m_cachedProps;
    for (auto& prop : result)
    {
        RefreshCachedValue(prop);
    }
    return result;
}

std::vector<VBimElementProperty> VBimElementProperties::GetPropertiesByGroup(const OdString& groupName) const
{
    EnsureCacheLoaded();
    std::vector<VBimElementProperty> result;
    std::wstring filter = ToLowerStd(groupName);

    for (const auto& p : m_cachedProps)
    {
        if (ToLowerStd(p.group) == filter)
        {
            VBimElementProperty prop = p;
            RefreshCachedValue(prop);
            result.push_back(prop);
        }
    }
    return result;
}

std::vector<OdString> VBimElementProperties::GetGroups() const
{
    EnsureCacheLoaded();
    std::vector<OdString> groups;
    std::map<std::wstring, bool> seen;

    for (const auto& p : m_cachedProps)
    {
        std::wstring g = ToLowerStd(p.group);
        if (seen.find(g) == seen.end())
        {
            seen[g] = true;
            groups.push_back(p.group);
        }
    }
    return groups;
}

bool VBimElementProperties::GetProperty(const OdString& name, VBimElementProperty& outProp) const
{
    EnsureCacheLoaded();
    std::wstring needle = ToLowerStd(name);

    for (const auto& p : m_cachedProps)
    {
        if (ToLowerStd(p.name) == needle || (!p.internalName.isEmpty() && ToLowerStd(p.internalName) == needle))
        {
            outProp = p;
            RefreshCachedValue(outProp);
            return true;
        }
    }
    return false;
}

bool VBimElementProperties::GetProperty(OdBm::BuiltInParameter::Enum bip, VBimElementProperty& outProp) const
{
    EnsureCacheLoaded();
    for (const auto& p : m_cachedProps)
    {
        if (p.builtInParam == bip)
        {
            outProp = p;
            RefreshCachedValue(outProp);
            return true;
        }
    }
    return false;
}

bool VBimElementProperties::GetProperty(const OdBmObjectId& paramId, VBimElementProperty& outProp) const
{
    EnsureCacheLoaded();
    if (paramId.isNull())
        return false;

    for (const auto& p : m_cachedProps)
    {
        if (p.paramId == paramId)
        {
            outProp = p;
            RefreshCachedValue(outProp);
            return true;
        }
    }
    return false;
}

OdString VBimElementProperties::GetValue(const OdString& name, const OdString& defaultValue) const
{
    VBimElementProperty prop;
    if (GetProperty(name, prop))
        return prop.value;
    return defaultValue;
}

OdString VBimElementProperties::GetValue(OdBm::BuiltInParameter::Enum bip, const OdString& defaultValue) const
{
    VBimElementProperty prop;
    if (GetProperty(bip, prop))
        return prop.value;
    return defaultValue;
}

// ---------------------------------------------------------------------------
// Type Parameters (Query)
// ---------------------------------------------------------------------------

std::vector<VBimElementProperty> VBimElementProperties::GetTypeProperties() const
{
    EnsureTypeCacheLoaded();
    std::vector<VBimElementProperty> result = m_cachedTypeProps;
    for (auto& prop : result)
    {
        RefreshTypeCachedValue(prop);
    }
    return result;
}

std::vector<VBimElementProperty> VBimElementProperties::GetTypePropertiesByGroup(const OdString& groupName) const
{
    EnsureTypeCacheLoaded();
    std::vector<VBimElementProperty> result;
    std::wstring filter = ToLowerStd(groupName);

    for (const auto& p : m_cachedTypeProps)
    {
        if (ToLowerStd(p.group) == filter)
        {
            VBimElementProperty prop = p;
            RefreshTypeCachedValue(prop);
            result.push_back(prop);
        }
    }
    return result;
}

std::vector<OdString> VBimElementProperties::GetTypeGroups() const
{
    EnsureTypeCacheLoaded();
    std::vector<OdString> groups;
    std::map<std::wstring, bool> seen;

    for (const auto& p : m_cachedTypeProps)
    {
        std::wstring g = ToLowerStd(p.group);
        if (seen.find(g) == seen.end())
        {
            seen[g] = true;
            groups.push_back(p.group);
        }
    }
    return groups;
}

bool VBimElementProperties::GetTypeProperty(const OdString& name, VBimElementProperty& outProp) const
{
    EnsureTypeCacheLoaded();
    std::wstring needle = ToLowerStd(name);

    for (const auto& p : m_cachedTypeProps)
    {
        if (ToLowerStd(p.name) == needle || (!p.internalName.isEmpty() && ToLowerStd(p.internalName) == needle))
        {
            outProp = p;
            RefreshTypeCachedValue(outProp);
            return true;
        }
    }
    return false;
}

bool VBimElementProperties::GetTypeProperty(OdBm::BuiltInParameter::Enum bip, VBimElementProperty& outProp) const
{
    EnsureTypeCacheLoaded();
    for (const auto& p : m_cachedTypeProps)
    {
        if (p.builtInParam == bip)
        {
            outProp = p;
            RefreshTypeCachedValue(outProp);
            return true;
        }
    }
    return false;
}

OdString VBimElementProperties::GetTypeValue(const OdString& name, const OdString& defaultValue) const
{
    VBimElementProperty prop;
    if (GetTypeProperty(name, prop))
        return prop.value;
    return defaultValue;
}

OdString VBimElementProperties::GetTypeValue(OdBm::BuiltInParameter::Enum bip, const OdString& defaultValue) const
{
    VBimElementProperty prop;
    if (GetTypeProperty(bip, prop))
        return prop.value;
    return defaultValue;
}

// ---------------------------------------------------------------------------
// Modification & Staging
// ---------------------------------------------------------------------------

bool VBimElementProperties::SetProperty(const OdString& name, const OdString& value)
{
    VBimElementProperty prop;
    if (!GetProperty(name, prop))
        return false;
    if (prop.isReadOnly)
        return false;
    if (!IsStageableValue(targetDb_, prop, value))
        return false;

    std::wstring key = ToLowerStd(name);
    m_stagedChanges[key] = value;
    if (!prop.internalName.isEmpty())
        m_stagedChanges[ToLowerStd(prop.internalName)] = value;

    return true;
}

bool VBimElementProperties::SetProperty(const OdString& name, int value)
{
    OdString s;
    s.format(L"%d", value);
    return SetProperty(name, s);
}

bool VBimElementProperties::SetProperty(const OdString& name, double value)
{
    OdString s;
    s.format(L"%.6f", value);
    return SetProperty(name, s);
}

bool VBimElementProperties::SetProperty(const OdString& name, bool value)
{
    return SetProperty(name, value ? OdString(L"1") : OdString(L"0"));
}

bool VBimElementProperties::SetProperty(OdBm::BuiltInParameter::Enum bip, const OdString& value)
{
    VBimElementProperty prop;
    if (!GetProperty(bip, prop))
        return false;
    if (prop.isReadOnly)
        return false;
    if (!IsStageableValue(targetDb_, prop, value))
        return false;

    if (!prop.name.isEmpty())
        m_stagedChanges[ToLowerStd(prop.name)] = value;
    if (!prop.internalName.isEmpty())
        m_stagedChanges[ToLowerStd(prop.internalName)] = value;

    return true;
}

bool VBimElementProperties::SetProperty(OdBm::BuiltInParameter::Enum bip, int value)
{
    OdString s;
    s.format(L"%d", value);
    return SetProperty(bip, s);
}

bool VBimElementProperties::SetProperty(OdBm::BuiltInParameter::Enum bip, double value)
{
    OdString s;
    s.format(L"%.6f", value);
    return SetProperty(bip, s);
}

bool VBimElementProperties::SetProperty(OdBm::BuiltInParameter::Enum bip, bool value)
{
    return SetProperty(bip, value ? OdString(L"1") : OdString(L"0"));
}

bool VBimElementProperties::SetProperty(const OdBmObjectId& paramId, const OdString& value)
{
    VBimElementProperty prop;
    if (!GetProperty(paramId, prop))
        return false;
    if (prop.isReadOnly)
        return false;
    if (!IsStageableValue(targetDb_, prop, value))
        return false;

    if (!prop.name.isEmpty())
        m_stagedChanges[ToLowerStd(prop.name)] = value;
    return true;
}

bool VBimElementProperties::SetTypeProperty(const OdString& name, const OdString& value)
{
    VBimElementProperty prop;
    if (!GetTypeProperty(name, prop))
        return false;
    if (prop.isReadOnly)
        return false;
    if (!IsStageableValue(targetDb_, prop, value))
        return false;

    std::wstring key = ToLowerStd(name);
    m_stagedTypeChanges[key] = value;
    if (!prop.internalName.isEmpty())
        m_stagedTypeChanges[ToLowerStd(prop.internalName)] = value;

    return true;
}

bool VBimElementProperties::SetTypeProperty(OdBm::BuiltInParameter::Enum bip, const OdString& value)
{
    VBimElementProperty prop;
    if (!GetTypeProperty(bip, prop))
        return false;
    if (prop.isReadOnly)
        return false;
    if (!IsStageableValue(targetDb_, prop, value))
        return false;

    if (!prop.name.isEmpty())
        m_stagedTypeChanges[ToLowerStd(prop.name)] = value;
    if (!prop.internalName.isEmpty())
        m_stagedTypeChanges[ToLowerStd(prop.internalName)] = value;

    return true;
}

bool VBimElementProperties::IsDirty() const noexcept
{
    return !m_stagedChanges.empty() || !m_stagedTypeChanges.empty();
}

void VBimElementProperties::DiscardChanges() noexcept
{
    m_stagedChanges.clear();
    m_stagedTypeChanges.clear();
    m_cacheLoaded = false;
    m_typeCacheLoaded = false;
}

std::vector<VBimElementProperty> VBimElementProperties::GetModifiedProperties() const
{
    std::vector<VBimElementProperty> result;
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
            VBimElementProperty p = prop;
            RefreshCachedValue(p);
            result.push_back(p);
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Synchronization & Atomic Persistence
// ---------------------------------------------------------------------------

bool VBimElementProperties::Sync(const OdString& undoActionName, bool bRefreshUI)
{
    if (!IsValid())
        return false;

    if (!IsDirty())
        return true;

    // 1. Capture Undo Snapshot before mutations if UIDocument is present
    std::shared_ptr<OdaSnapshotDeltaAction> pSnapshot;
    if (m_pUIDoc)
    {
        OdBmObjectIdArray targetIds;
        targetIds.push_back(m_elementId);
        if (!m_stagedTypeChanges.empty())
        {
            OdBmObjectId typeId = GetTypeId();
            if (!typeId.isNull())
                targetIds.push_back(typeId);
        }
        pSnapshot = m_pUIDoc->RecordSnapshot(targetIds, undoActionName);
    }

    // 2. Open an explicit atomic database transaction. OdBmTransaction does not start
    //    itself in its constructor; start() is required before any write.
    OdExplicitTransaction transaction(targetDb_);
    bool allWritesOk = true;

    try
    {
        transaction.start();

        // Apply Instance Parameter modifications
        if (!m_stagedChanges.empty())
        {
            OdBmElementPtr pElem = OdBmElement::cast(m_elementId.openObject());
            if (pElem.isNull())
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
                if (WriteStagedValue(targetDb_, pElem, prop, newVal) != eOk)
                    allWritesOk = false;
            }
        }

        // Apply Type Parameter modifications
        if (!m_stagedTypeChanges.empty())
        {
            OdBmObjectId typeId = GetTypeId();
            OdBmElementPtr pTypeElem = typeId.isNull() ? OdBmElementPtr() : OdBmElement::cast(typeId.openObject());
            if (pTypeElem.isNull())
            {
                allWritesOk = false;
            }
            else
            {
                {
                    EnsureTypeCacheLoaded();

                    for (const auto& prop : m_cachedTypeProps)
                    {
                        std::wstring keyName = ToLowerStd(prop.name);
                        std::wstring keyInternal = ToLowerStd(prop.internalName);

                        auto it = m_stagedTypeChanges.find(keyName);
                        if (it == m_stagedTypeChanges.end() && !keyInternal.empty())
                            it = m_stagedTypeChanges.find(keyInternal);

                        if (it == m_stagedTypeChanges.end())
                            continue;

                        if (prop.isReadOnly)
                            continue;

                        const OdString& newVal = it->second;

                        if (!prop.IsBuiltIn() && !prop.IsUserParam())
                            continue;
                        if (WriteStagedValue(targetDb_, pTypeElem, prop, newVal) != eOk)
                            allWritesOk = false;
                    }
                }
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
        ODA_TRACE1("VBimElementProperties::Sync OdError: %ls\n", e.description().c_str());
        return false;
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::Sync exception: %hs\n", e.what());
        return false;
    }

    // 3. Finalize Undo snapshot registration
    // Inside an Automatic VBimCommand the step is recorded after the command commits.
    if (pSnapshot && m_pUIDoc)
        vb::commands::detail::RecordOrDeferUndoSnapshot(m_pUIDoc, pSnapshot);

    // 4. Clear staging and invalidate cache for fresh queries
    m_stagedChanges.clear();
    m_stagedTypeChanges.clear();
    m_cacheLoaded = false;
    m_typeCacheLoaded = false;

    // 5. Refresh UI components if requested
    if (bRefreshUI)
    {
        VBimPropertiesPaneScope::NotifyElementPlaced(m_elementId);
        if (m_pUIDoc)
        {
            m_pUIDoc->RefreshActiveView();
        }
    }

    return true;
}

// ---------------------------------------------------------------------------
// JSON Serialization
// ---------------------------------------------------------------------------

std::string VBimElementProperties::ToJson(bool includeTypeProperties) const
{
    EnsureCacheLoaded();

    std::ostringstream ss;
    ss << "{\n";
    ss << "  \"schemaVersion\": \"1.0\",\n";
    ss << "  \"elementId\": " << static_cast<unsigned long long>(OBJID2DWORDPTR(m_elementId)) << ",\n";
    ss << "  \"elementName\": \"" << EscapeJsonString(OdStringToUtf8(GetElementName())) << "\",\n";
    ss << "  \"categoryName\": \"" << EscapeJsonString(OdStringToUtf8(GetCategoryName())) << "\",\n";
    ss << "  \"hasType\": " << (HasType() ? "true" : "false") << ",\n";
    ss << "  \"typeId\": " << static_cast<unsigned long long>(OBJID2DWORDPTR(GetTypeId())) << ",\n";
    ss << "  \"typeName\": \"" << EscapeJsonString(OdStringToUtf8(GetTypeName())) << "\",\n";

    // Instance Properties
    ss << "  \"properties\": [\n";
    for (size_t i = 0; i < m_cachedProps.size(); ++i)
    {
        VBimElementProperty prop = m_cachedProps[i];
        RefreshCachedValue(prop);

        ss << "    {\n";
        ss << "      \"name\": \"" << EscapeJsonString(OdStringToUtf8(prop.name)) << "\",\n";
        ss << "      \"internalName\": \"" << EscapeJsonString(OdStringToUtf8(prop.internalName)) << "\",\n";
        ss << "      \"builtInParamId\": " << static_cast<int>(prop.builtInParam) << ",\n";
        ss << "      \"paramId\": " << static_cast<unsigned long long>(OBJID2DWORDPTR(prop.paramId)) << ",\n";
        ss << "      \"storageType\": \"" << StorageTypeToString(prop.storageType) << "\",\n";
        ss << "      \"value\": \"" << EscapeJsonString(OdStringToUtf8(prop.value)) << "\",\n";
        ss << "      \"isReadOnly\": " << (prop.isReadOnly ? "true" : "false") << ",\n";
        ss << "      \"group\": \"" << EscapeJsonString(OdStringToUtf8(prop.group)) << "\"\n";
        ss << "    }" << (i + 1 < m_cachedProps.size() ? ",\n" : "\n");
    }
    ss << "  ]";

    if (includeTypeProperties && HasType())
    {
        EnsureTypeCacheLoaded();
        ss << ",\n  \"typeProperties\": [\n";
        for (size_t i = 0; i < m_cachedTypeProps.size(); ++i)
        {
            VBimElementProperty prop = m_cachedTypeProps[i];
            RefreshTypeCachedValue(prop);

            ss << "    {\n";
            ss << "      \"name\": \"" << EscapeJsonString(OdStringToUtf8(prop.name)) << "\",\n";
            ss << "      \"internalName\": \"" << EscapeJsonString(OdStringToUtf8(prop.internalName)) << "\",\n";
            ss << "      \"builtInParamId\": " << static_cast<int>(prop.builtInParam) << ",\n";
            ss << "      \"paramId\": " << static_cast<unsigned long long>(OBJID2DWORDPTR(prop.paramId)) << ",\n";
            ss << "      \"storageType\": \"" << StorageTypeToString(prop.storageType) << "\",\n";
            ss << "      \"value\": \"" << EscapeJsonString(OdStringToUtf8(prop.value)) << "\",\n";
            ss << "      \"isReadOnly\": " << (prop.isReadOnly ? "true" : "false") << ",\n";
            ss << "      \"group\": \"" << EscapeJsonString(OdStringToUtf8(prop.group)) << "\"\n";
            ss << "    }" << (i + 1 < m_cachedTypeProps.size() ? ",\n" : "\n");
        }
        ss << "  ]\n";
    }
    else
    {
        ss << "\n";
    }

    ss << "}\n";
    return ss.str();
}

bool VBimElementProperties::FromJson(const std::string& jsonString)
{
    if (jsonString.empty())
        return false;

    size_t stagedCount = 0;

    auto parseArrayAndStage = [&](const std::string& arrayKey, bool isTypeProp) {
        std::string searchKey = "\"" + arrayKey + "\"";
        size_t propsPos = jsonString.find(searchKey);
        if (propsPos == std::string::npos)
            return;

        size_t arrayStart = jsonString.find('[', propsPos);
        if (arrayStart == std::string::npos)
            return;

        size_t arrayEnd = jsonString.find(']', arrayStart);
        if (arrayEnd == std::string::npos)
            return;

        size_t current = arrayStart;
        while (current < arrayEnd)
        {
            size_t objStart = jsonString.find('{', current);
            if (objStart == std::string::npos || objStart >= arrayEnd)
                break;

            size_t objEnd = jsonString.find('}', objStart);
            if (objEnd == std::string::npos || objEnd > arrayEnd)
                break;

            std::string objStr = jsonString.substr(objStart, objEnd - objStart + 1);

            auto extractField = [&objStr](const std::string& fieldName) -> std::string {
                std::string key = "\"" + fieldName + "\"";
                size_t kpos = objStr.find(key);
                if (kpos == std::string::npos)
                    return "";
                size_t colon = objStr.find(':', kpos + key.size());
                if (colon == std::string::npos)
                    return "";
                size_t valStart = objStr.find('"', colon);
                if (valStart == std::string::npos)
                    return "";
                size_t valEnd = objStr.find('"', valStart + 1);
                while (valEnd != std::string::npos && objStr[valEnd - 1] == '\\')
                {
                    valEnd = objStr.find('"', valEnd + 1);
                }
                if (valEnd == std::string::npos)
                    return "";
                return objStr.substr(valStart + 1, valEnd - valStart - 1);
            };

            std::string nameUtf8 = extractField("name");
            std::string valUtf8 = extractField("value");

            if (!nameUtf8.empty())
            {
                OdString nameOd = Utf8ToOdString(nameUtf8);
                OdString valOd = Utf8ToOdString(valUtf8);

                bool ok = isTypeProp ? SetTypeProperty(nameOd, valOd) : SetProperty(nameOd, valOd);
                if (ok)
                {
                    ++stagedCount;
                }
            }

            current = objEnd + 1;
        }
    };

    parseArrayAndStage("properties", false);
    parseArrayAndStage("typeProperties", true);

    return stagedCount > 0;
}

// ---------------------------------------------------------------------------
// Internal Cache Management
// ---------------------------------------------------------------------------

void VBimElementProperties::EnsureCacheLoaded() const
{
    if (m_cacheLoaded)
        return;

    m_cachedProps.clear();
    m_cacheLoaded = true;

    if (!IsValid())
        return;

    try
    {
        OdBmElementPtr pElem = OdBmElement::cast(m_elementId.safeOpenObject());
        if (!pElem.isNull())
        {
            CollectParametersInternal(pElem, targetDb_, m_cachedProps);
        }
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::EnsureCacheLoaded OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::EnsureCacheLoaded exception: %hs\n", e.what());
    }
}

void VBimElementProperties::EnsureTypeCacheLoaded() const
{
    if (m_typeCacheLoaded)
        return;

    m_cachedTypeProps.clear();

    const OdBmObjectId typeId = GetTypeId();
    m_typeCacheLoaded = true;

    if (typeId.isNull() || !targetDb_)
        return;

    try
    {
        OdBmElementPtr pTypeElem = OdBmElement::cast(typeId.safeOpenObject());
        if (!pTypeElem.isNull())
        {
            CollectParametersInternal(pTypeElem, targetDb_, m_cachedTypeProps);
        }
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::EnsureTypeCacheLoaded OdError: %ls\n", e.description().c_str());
    }
    catch (const std::exception& e)
    {
        (void)e;
        ODA_TRACE1("VBimElementProperties::EnsureTypeCacheLoaded exception: %hs\n", e.what());
    }
}

void VBimElementProperties::RefreshCachedValue(VBimElementProperty& prop) const
{
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

void VBimElementProperties::RefreshTypeCachedValue(VBimElementProperty& prop) const
{
    std::wstring keyName = ToLowerStd(prop.name);
    auto it = m_stagedTypeChanges.find(keyName);
    if (it != m_stagedTypeChanges.end())
    {
        prop.value = it->second;
        return;
    }

    if (!prop.internalName.isEmpty())
    {
        std::wstring keyInternal = ToLowerStd(prop.internalName);
        auto itInt = m_stagedTypeChanges.find(keyInternal);
        if (itInt != m_stagedTypeChanges.end())
        {
            prop.value = itInt->second;
        }
    }
}
