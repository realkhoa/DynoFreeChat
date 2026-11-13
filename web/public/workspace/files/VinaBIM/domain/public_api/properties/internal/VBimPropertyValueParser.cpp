#include "pch.h"
#include "domain/public_api/properties/internal/VBimPropertyValueParser.h"
#include "Infrastructure/Oda/sdk_includes/BmSdkUiCompat.h"

#include "Database/BmDatabase.h"
#include "Database/Entities/BmParamElem.h"
#include "Database/Entities/BmParamDef.h"
#include "Database/BmUnitUtils.h"
#include "Base/BmUnitTypeId.h"
#include "Managers/BmUnitsTracking.h"
#include "Database/Entities/BmUnitsElem.h"

#include <cerrno>
#include <cstdint>
#include <cmath>
#include <cwchar>
#include <cwctype>

namespace
{
    OdString Trimmed(const OdString& text)
    {
        OdString result = text;
        result.trimLeft();
        result.trimRight();
        return result;
    }

    OdBmParamDefPtr ParamDefOf(const OdBmObjectId& paramId)
    {
        if (paramId.isNull())
            return OdBmParamDefPtr();
        const OdBmParamElemPtr pParamElem = OdBmParamElem::cast(paramId.openObject());
        return pParamElem.isNull() ? OdBmParamDefPtr() : pParamElem->getParamDef();
    }

    // Maps a combo choice's display text (e.g. "Exterior") to its stored value.
    bool LookupChoiceValue(OdBmDatabase* pDb, const OdBmObjectId& paramId, const OdString& text, OdInt32& outValue)
    {
        if (pDb == nullptr)
            return false;
        const OdBmParamDefComboPtr pCombo = OdBmParamDefCombo::cast(ParamDefOf(paramId));
        if (pCombo.isNull())
            return false;
        OdBmMap<OdInt32, OdString> choices;
        VbimFillChoiceMap(pCombo, pDb, choices);
        for (auto it = choices.begin(); it != choices.end(); ++it)
        {
            if (it->second.compare(text) == 0)
            {
                outValue = it->first;
                return true;
            }
        }
        return false;
    }

    double ConvertDisplayToInternal(OdBmDatabase* pDb, const OdBmObjectId& paramId, double displayValue)
    {
        if (pDb == nullptr)
            return displayValue;
        const OdBmParamDefPtr pDef = ParamDefOf(paramId);
        if (pDef.isNull() || pDef->getSpecTypeId().isEmpty())
            return displayValue;
        const OdBmUnitsTrackingPtr pUnitsTracking = pDb->getAppInfo(OdBm::ManagerType::UnitsTracking);
        if (pUnitsTracking.isNull())
            return displayValue;
        const OdBmUnitsElemPtr pUnitsElem = OdBmUnitsElem::cast(pUnitsTracking->getUnitsElemId().openObject());
        if (pUnitsElem.isNull())
            return displayValue;
        const OdBmForgeTypeId unitTypeId =
            OdBmUnitUtils::getDefaultUnitTypeId(pUnitsElem->getUnits(), pDef->getSpecTypeId());
        return unitTypeId.isEmpty() ? displayValue : OdBmUnitUtils::convertToInternalUnits(displayValue, unitTypeId);
    }
}

namespace vb::properties::detail
{
    bool ParseIntegerValue(OdBmDatabase* pDb, const OdBmObjectId& paramId, const OdString& text, OdInt32& outValue)
    {
        const OdString value = Trimmed(text);
        if (value.isEmpty())
            return false;
        if (value.iCompare(L"yes") == 0 || value.iCompare(L"true") == 0 || value.iCompare(L"on") == 0)
        {
            outValue = 1;
            return true;
        }
        if (value.iCompare(L"no") == 0 || value.iCompare(L"false") == 0 || value.iCompare(L"off") == 0)
        {
            outValue = 0;
            return true;
        }

        const wchar_t* const begin = value.c_str();
        wchar_t* end = nullptr;
        errno = 0;
        const long parsed = std::wcstol(begin, &end, 10);
        if (end != begin && *end == L'\0' && errno != ERANGE
            && parsed >= static_cast<long>(INT32_MIN) && parsed <= static_cast<long>(INT32_MAX))
        {
            outValue = static_cast<OdInt32>(parsed);
            return true;
        }
        return LookupChoiceValue(pDb, paramId, value, outValue);
    }

    bool ParseDoubleValue(OdBmDatabase* pDb, const OdBmObjectId& paramId, const OdString& text, double& outInternalValue)
    {
        const OdString value = Trimmed(text);
        if (value.isEmpty())
            return false;

        const wchar_t* const begin = value.c_str();
        wchar_t* end = nullptr;
        errno = 0;
        const double displayValue = std::wcstod(begin, &end);
        if (end == begin || errno == ERANGE || !std::isfinite(displayValue))
            return false;

        OdString suffix(end);
        suffix.trimLeft();
        suffix.trimRight();

        if (!suffix.isEmpty())
        {
            for (const wchar_t* p = suffix.c_str(); *p != L'\0'; ++p)
            {
                if (std::iswdigit(*p))
                    return false;
            }

            if (suffix.iCompare(L"mm") == 0 || suffix.iCompare(L"millimeter") == 0 || suffix.iCompare(L"millimeters") == 0)
            {
                outInternalValue = OdBmUnitUtils::convertToInternalUnits(displayValue, OdBmUnitTypeId::kMillimeters);
                return std::isfinite(outInternalValue);
            }
            if (suffix.iCompare(L"cm") == 0 || suffix.iCompare(L"centimeter") == 0 || suffix.iCompare(L"centimeters") == 0)
            {
                outInternalValue = OdBmUnitUtils::convertToInternalUnits(displayValue, OdBmUnitTypeId::kCentimeters);
                return std::isfinite(outInternalValue);
            }
            if (suffix.iCompare(L"m") == 0 || suffix.iCompare(L"meter") == 0 || suffix.iCompare(L"meters") == 0)
            {
                outInternalValue = OdBmUnitUtils::convertToInternalUnits(displayValue, OdBmUnitTypeId::kMeters);
                return std::isfinite(outInternalValue);
            }
            if (suffix.iCompare(L"ft") == 0 || suffix.compare(L"'") == 0 || suffix.iCompare(L"foot") == 0 || suffix.iCompare(L"feet") == 0)
            {
                outInternalValue = OdBmUnitUtils::convertToInternalUnits(displayValue, OdBmUnitTypeId::kFeet);
                return std::isfinite(outInternalValue);
            }
            if (suffix.iCompare(L"in") == 0 || suffix.compare(L"\"") == 0 || suffix.iCompare(L"inch") == 0 || suffix.iCompare(L"inches") == 0)
            {
                outInternalValue = OdBmUnitUtils::convertToInternalUnits(displayValue, OdBmUnitTypeId::kInches);
                return std::isfinite(outInternalValue);
            }

            return false;
        }

        const double internalValue = ConvertDisplayToInternal(pDb, paramId, displayValue);
        if (!std::isfinite(internalValue))
            return false;
        outInternalValue = internalValue;
        return true;
    }
}
