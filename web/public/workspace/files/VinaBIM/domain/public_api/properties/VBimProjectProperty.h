// VBimProjectProperty.h
//
// Represents a single project-level property in VinaBIM SDK.
// Encapsulates both ODA BimRv built-in parameters (e.g. PROJECT_NAME, CLIENT_NAME)
// and custom user / shared parameters attached to the Project Information element.
//
#pragma once

#include "../VinaBIMApiExport.h"
#include "Base/BmObjectId.h"
#include "Common/BuiltIns/BmBuiltInParameter.h"
#include "OdString.h"
#include "OdArray.h"
#include <string>
#include <cwchar>

/**
 * @brief Storage value types for project properties conforming to ODA/Revit schema.
 */
enum class VBimPropertyStorageType
{
    None = 0,       ///< Undefined or uninitialized storage
    Integer = 1,    ///< Integer (e.g. integer parameters, enum options, boolean flags)
    Double = 2,     ///< Floating-point numbers (e.g. length, area, volume, angle, numeric)
    String = 3,     ///< Text / String parameters
    ElementId = 4   ///< Reference to another element in the BIM database
};

/**
 * @brief Structure representing a project property entity.
 *
 * Encapsulates the property's friendly display label, internal identifier,
 * built-in parameter ID (if applicable), custom parameter ID (if user-defined),
 * storage type, read-only status, logical property group, and current value.
 */
struct VINABIMCORE_DLLEXPORT VBimProjectProperty
{
    OdString                    name;           ///< Display name or friendly caption (e.g. L"Project Name")
    OdString                    internalName;   ///< Internal symbol name (e.g. L"PROJECT_NAME")
    OdBm::BuiltInParameter::Enum builtInParam;  ///< ODA BuiltInParameter ID (or invalid if user param)
    OdBmObjectId                paramId;        ///< Object ID of user/shared parameter element (null for built-in)
    VBimPropertyStorageType     storageType;    ///< Data storage classification
    OdString                    value;          ///< String-serialized parameter value
    bool                        isReadOnly;     ///< True if parameter cannot be edited directly by users
    OdString                    group;          ///< Property group name (e.g. L"Identity Data", L"Other")
    OdString                    description;    ///< Optional tooltip or description

    /**
     * @brief Default constructor initializing an empty, editable String property (no built-in id).
     */
    VBimProjectProperty()
        : builtInParam(static_cast<OdBm::BuiltInParameter::Enum>(-1))
        , storageType(VBimPropertyStorageType::String)
        , isReadOnly(false)
    {
    }

    /**
     * @brief Constructs a built-in project property with full metadata.
     * @param inName Display name / caption.
     * @param inInternalName Internal symbol identifier.
     * @param inBip Built-in parameter enumeration value.
     * @param inType Storage data type.
     * @param inValue Initial string representation of the value.
     * @param inReadOnly Whether the property is read-only.
     * @param inGroup Category or property group label.
     */
    VBimProjectProperty(
        const OdString& inName,
        const OdString& inInternalName,
        OdBm::BuiltInParameter::Enum inBip,
        VBimPropertyStorageType inType = VBimPropertyStorageType::String,
        const OdString& inValue = OdString::kEmpty,
        bool inReadOnly = false,
        const OdString& inGroup = L"Identity Data")
        : name(inName)
        , internalName(inInternalName)
        , builtInParam(inBip)
        , storageType(inType)
        , value(inValue)
        , isReadOnly(inReadOnly)
        , group(inGroup)
    {
    }

    /**
     * @brief Checks if this property maps to an ODA/Revit built-in parameter.
     * @return bool True if built-in parameter.
     */
    bool IsBuiltIn() const noexcept
    {
        return static_cast<OdInt64>(builtInParam) != -1 && paramId.isNull();
    }

    /**
     * @brief Checks if this property is a user-defined or shared parameter.
     * @return bool True if user/shared parameter.
     */
    bool IsUserParam() const noexcept
    {
        return !paramId.isNull();
    }

    /**
     * @brief Retrieves the property value as a string reference.
     * @return const OdString& String representation of the value.
     */
    const OdString& AsString() const noexcept
    {
        return value;
    }

    /**
     * @brief Parses the string value to an integer.
     * @param fallback Value returned if parsing fails.
     * @return int Parsed integer or fallback.
     */
    int AsInt(int fallback = 0) const noexcept
    {
        if (value.isEmpty())
            return fallback;
        const wchar_t* pStr = reinterpret_cast<const wchar_t*>(value.c_str());
        wchar_t* endPtr = nullptr;
        long val = std::wcstol(pStr, &endPtr, 10);
        return (endPtr != pStr) ? static_cast<int>(val) : fallback;
    }

    /**
     * @brief Parses the string value to a double-precision floating point number.
     * @param fallback Value returned if parsing fails.
     * @return double Parsed floating-point value or fallback.
     */
    double AsDouble(double fallback = 0.0) const noexcept
    {
        if (value.isEmpty())
            return fallback;
        const wchar_t* pStr = reinterpret_cast<const wchar_t*>(value.c_str());
        wchar_t* endPtr = nullptr;
        double val = std::wcstod(pStr, &endPtr);
        return (endPtr != pStr) ? val : fallback;
    }

    /**
     * @brief Parses the string value to a boolean flag (recognizes "1", "true", "yes", "on").
     * @param fallback Value returned if parsing fails.
     * @return bool Parsed boolean flag or fallback.
     */
    bool AsBool(bool fallback = false) const noexcept
    {
        if (value.isEmpty())
            return fallback;
        OdString lower = value;
        lower.makeLower();
        if (lower == L"1" || lower == L"true" || lower == L"yes" || lower == L"on")
            return true;
        if (lower == L"0" || lower == L"false" || lower == L"no" || lower == L"off")
            return false;
        return fallback;
    }

    /**
     * @brief Sets the property value from a string.
     * @param inVal New string value.
     */
    void SetValue(const OdString& inVal)
    {
        value = inVal;
    }

    /**
     * @brief Sets the property value formatted from an integer.
     * @param inVal New integer value.
     */
    void SetValue(int inVal)
    {
        value.format(L"%d", inVal);
    }

    /**
     * @brief Sets the property value formatted from a double-precision float.
     * @param inVal New double value.
     * @param precision Number of decimal places (defaults to 3).
     */
    void SetValue(double inVal, int precision = 3)
    {
        OdString fmt;
        fmt.format(L"%%.%df", precision);
        value.format(fmt.c_str(), inVal);
    }

    /**
     * @brief Sets the property value formatted from a boolean flag ("1" or "0").
     * @param inVal New boolean value.
     */
    void SetValue(bool inVal)
    {
        value = inVal ? L"1" : L"0";
    }

    bool operator==(const VBimProjectProperty& other) const noexcept
    {
        return name == other.name &&
               builtInParam == other.builtInParam &&
               paramId == other.paramId &&
               value == other.value &&
               storageType == other.storageType &&
               isReadOnly == other.isReadOnly;
    }

    bool operator!=(const VBimProjectProperty& other) const noexcept
    {
        return !(*this == other);
    }
};

/**
 * @brief Type alias for element/instance-level properties, sharing the same schema as VBimProjectProperty.
 */
using VBimElementProperty = VBimProjectProperty;
