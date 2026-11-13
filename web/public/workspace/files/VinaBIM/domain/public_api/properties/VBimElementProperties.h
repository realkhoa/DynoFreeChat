// VBimElementProperties.h
//
// Facade for querying, inspecting, modifying, and synchronizing BIM parameters
// of individual graphic elements (instances) and their associated types in VinaBIM.
//
#pragma once

#include "../VinaBIMApiExport.h"
#include "VBimProjectProperty.h"
#include "Base/BmObjectId.h"
#include "Base/BmObjectIdArray.h"
#include "Common/BuiltIns/BmBuiltInParameter.h"
#include "OdString.h"
#include "OdArray.h"
#include <map>
#include <string>
#include <vector>

class OdBmDatabase;
class VBimUIDocument;

/**
 * @class VBimElementProperties
 * @brief Facade managing full instance and type parameters for a specific BIM element.
 *
 * Provides reflection-based discovery of 100% of the element's parameters (Built-In,
 * Family, and Shared/Project Parameters) grouped according to standard Revit parameter groups.
 * Also supports querying Type Parameters (via ELEM_TYPE_PARAM or master family symbol),
 * staging modifications, atomic synchronization with RAII transactions and Undo (Ctrl+Z),
 * and JSON serialization.
 *
 * Threading: All methods must be invoked from the UI / main application thread.
 */
class VINABIMCORE_DLLEXPORT VBimElementProperties
{
public:
    /**
     * @brief Constructs an uninitialized, invalid element properties facade.
     */
    VBimElementProperties();

    /**
     * @brief Constructs an element properties facade bound to a specific element and document.
     * @param pDb Pointer to the active ODA BIM database.
     * @param elementId Object ID of the target BIM element to inspect or modify.
     * @param pUIDoc Optional pointer to active UIDocument (for Undo snapshot and UI refresh).
     */
    explicit VBimElementProperties(
        OdBmDatabase* pDb,
        const OdBmObjectId& elementId,
        VBimUIDocument* pUIDoc = nullptr);

    /** @brief Copy constructor. */
    VBimElementProperties(const VBimElementProperties& other);

    /** @brief Copy assignment operator. */
    VBimElementProperties& operator=(const VBimElementProperties& other);

    /** @brief Move constructor. */
    VBimElementProperties(VBimElementProperties&& other) noexcept;

    /** @brief Move assignment operator. */
    VBimElementProperties& operator=(VBimElementProperties&& other) noexcept;

    /** @brief Destructor. */
    ~VBimElementProperties();

    // -----------------------------------------------------------------------
    // Identification & State
    // -----------------------------------------------------------------------

    /**
     * @brief Returns true if this facade is bound to a valid, non-null element in a valid database.
     * @return bool True if valid and safe to query or edit.
     */
    bool IsValid() const noexcept;

    /**
     * @brief Returns the object ID of the underlying BIM element.
     * @return OdBmObjectId Element identifier in the database.
     */
    OdBmObjectId GetElementId() const noexcept;

    /**
     * @brief Returns the user-friendly name of the element (e.g. wall name, family name).
     * @return OdString Element display name.
     */
    OdString GetElementName() const;

    /**
     * @brief Returns the Category display name for this element (e.g. L"Walls", L"Doors").
     * @return OdString Category name.
     */
    OdString GetCategoryName() const;

    /**
     * @brief Checks if this element is an OdBmFamilyInstance.
     * @return bool True if family instance.
     */
    bool IsFamilyInstance() const;

    /**
     * @brief Checks if this element has an associated Type or Family Symbol.
     * @return bool True if a valid Type exists.
     */
    bool HasType() const;

    /**
     * @brief Returns the object ID of the associated Type or Family Symbol element.
     * @return OdBmObjectId Type element object ID, or null if no type exists.
     */
    OdBmObjectId GetTypeId() const;

    /**
     * @brief Returns the name of the associated Type (e.g. L"Generic - 200mm", L"36\" x 84\"").
     * @return OdString Type name.
     */
    OdString GetTypeName() const;

    // -----------------------------------------------------------------------
    // Instance Parameters (Query)
    // -----------------------------------------------------------------------

    /**
     * @brief Retrieves all instance parameters of the element.
     * @details Discovers 100% of built-in parameters, family parameters, and shared/project
     * parameters attached to this element. Applies any currently staged modifications.
     * @return std::vector<VBimElementProperty> List of all instance properties.
     */
    std::vector<VBimElementProperty> GetProperties() const;

    /**
     * @brief Retrieves all instance parameters belonging to a specific group.
     * @param groupName Group title (e.g. L"Dimensions", L"Constraints", L"Identity Data").
     * @return std::vector<VBimElementProperty> Filtered property list.
     */
    std::vector<VBimElementProperty> GetPropertiesByGroup(const OdString& groupName) const;

    /**
     * @brief Retrieves a list of all distinct parameter group names present on this element.
     * @return std::vector<OdString> Group names sorted or discovered.
     */
    std::vector<OdString> GetGroups() const;

    /**
     * @brief Finds an instance property by display name or internal name.
     * @param name Display label (case-insensitive) or internal symbol identifier.
     * @param[out] outProp Receives the found property with current value.
     * @return bool True if found; false otherwise.
     */
    bool GetProperty(const OdString& name, VBimElementProperty& outProp) const;

    /**
     * @brief Finds an instance property by ODA/Revit BuiltInParameter enumeration.
     * @param bip BuiltInParameter enumeration identifier.
     * @param[out] outProp Receives the found property.
     * @return bool True if found; false otherwise.
     */
    bool GetProperty(OdBm::BuiltInParameter::Enum bip, VBimElementProperty& outProp) const;

    /**
     * @brief Finds a user-defined or shared instance parameter by its object ID.
     * @param paramId Object ID of the parameter element.
     * @param[out] outProp Receives the found property.
     * @return bool True if found; false otherwise.
     */
    bool GetProperty(const OdBmObjectId& paramId, VBimElementProperty& outProp) const;

    /**
     * @brief Convenience helper: gets an instance property's value as a string by name.
     * @param name Display name or internal name.
     * @param defaultValue Fallback value if property is not found.
     * @return OdString Property string value.
     */
    OdString GetValue(const OdString& name, const OdString& defaultValue = OdString::kEmpty) const;

    /**
     * @brief Convenience helper: gets an instance property's value as a string by BuiltInParameter.
     * @param bip BuiltInParameter enumeration.
     * @param defaultValue Fallback value if property is not found.
     * @return OdString Property string value.
     */
    OdString GetValue(OdBm::BuiltInParameter::Enum bip, const OdString& defaultValue = OdString::kEmpty) const;

    // -----------------------------------------------------------------------
    // Type Parameters (Query)
    // -----------------------------------------------------------------------

    /**
     * @brief Retrieves all type parameters of the element's associated Type / Family Symbol.
     * @details Equivalent to opening "Edit Type" in Revit/VinaBIM. Returns empty if element has no Type.
     * @return std::vector<VBimElementProperty> List of all type properties.
     */
    std::vector<VBimElementProperty> GetTypeProperties() const;

    /**
     * @brief Retrieves all type parameters belonging to a specific group.
     * @param groupName Group title (e.g. L"Identity Data", L"Dimensions", L"Materials and Finishes").
     * @return std::vector<VBimElementProperty> Filtered type property list.
     */
    std::vector<VBimElementProperty> GetTypePropertiesByGroup(const OdString& groupName) const;

    /**
     * @brief Retrieves a list of all distinct parameter group names present on the associated Type.
     * @return std::vector<OdString> Group names present on Type.
     */
    std::vector<OdString> GetTypeGroups() const;

    /**
     * @brief Finds a type property by display name or internal name.
     * @param name Display label (case-insensitive) or internal symbol identifier.
     * @param[out] outProp Receives the found type property.
     * @return bool True if found; false otherwise.
     */
    bool GetTypeProperty(const OdString& name, VBimElementProperty& outProp) const;

    /**
     * @brief Finds a type property by ODA/Revit BuiltInParameter enumeration.
     * @param bip BuiltInParameter enumeration identifier.
     * @param[out] outProp Receives the found type property.
     * @return bool True if found; false otherwise.
     */
    bool GetTypeProperty(OdBm::BuiltInParameter::Enum bip, VBimElementProperty& outProp) const;

    /**
     * @brief Convenience helper: gets a type property's value as a string by name.
     * @param name Display name or internal name.
     * @param defaultValue Fallback value if property is not found.
     * @return OdString Type property string value.
     */
    OdString GetTypeValue(const OdString& name, const OdString& defaultValue = OdString::kEmpty) const;

    /**
     * @brief Convenience helper: gets a type property's value as a string by BuiltInParameter.
     * @param bip BuiltInParameter enumeration.
     * @param defaultValue Fallback value if property is not found.
     * @return OdString Type property string value.
     */
    OdString GetTypeValue(OdBm::BuiltInParameter::Enum bip, const OdString& defaultValue = OdString::kEmpty) const;

    // -----------------------------------------------------------------------
    // Modification & Staging
    // -----------------------------------------------------------------------
    //
    // Text accepted for each storage type (checked when staging, parsed the same way by Sync()):
    //  - Integer: Yes/No, True/False, On/Off, a whole number, or a choice's display name (e.g. "Exterior").
    //  - Double: a number in the project's display units, optionally followed by a unit symbol
    //    ("3000" or "3000 mm"); converted to internal units on Sync(). Compound text such as
    //    feet-inches is rejected.
    //  - String: any text.
    //  - ElementId: not supported; the setter returns false.

    /**
     * @brief Stages a new string value for an instance property identified by name.
     * @param name Display name or internal identifier.
     * @param value New string value.
     * @return bool True if property exists and is not read-only; false otherwise.
     */
    bool SetProperty(const OdString& name, const OdString& value);

    /**
     * @brief Stages an integer value for an instance property identified by name.
     * @param name Display name or internal identifier.
     * @param value Integer value.
     * @return bool True if property exists and is not read-only.
     */
    bool SetProperty(const OdString& name, int value);

    /**
     * @brief Stages a floating-point value for an instance property identified by name.
     * @param name Display name or internal identifier.
     * @param value Double value.
     * @return bool True if property exists and is not read-only.
     */
    bool SetProperty(const OdString& name, double value);

    /**
     * @brief Stages a boolean value for an instance property identified by name.
     * @param name Display name or internal identifier.
     * @param value Boolean flag (formatted as L"1" or L"0").
     * @return bool True if property exists and is not read-only.
     */
    bool SetProperty(const OdString& name, bool value);

    /**
     * @brief String-literal overload; forwards to the OdString overload.
     * @note Without it a wide literal (L"...") binds to the bool overload, because
     *       pointer-to-bool is a standard conversion and beats OdString's constructor.
     * @param name Target property.
     * @param value New string value (null is treated as empty).
     * @return bool True if staged successfully.
     */
    bool SetProperty(const OdString& name, const wchar_t* value)
    {
        return SetProperty(name, value ? OdString(value) : OdString::kEmpty);
    }

    /**
     * @brief Stages a string value for an instance property identified by BuiltInParameter.
     * @param bip BuiltInParameter enumeration.
     * @param value New string value.
     * @return bool True if property exists and is not read-only.
     */
    bool SetProperty(OdBm::BuiltInParameter::Enum bip, const OdString& value);

    /**
     * @brief Stages an integer value for an instance property identified by BuiltInParameter.
     * @param bip BuiltInParameter enumeration.
     * @param value Integer value.
     * @return bool True if property exists and is not read-only.
     */
    bool SetProperty(OdBm::BuiltInParameter::Enum bip, int value);

    /**
     * @brief Stages a floating-point value for an instance property identified by BuiltInParameter.
     * @param bip BuiltInParameter enumeration.
     * @param value Double value.
     * @return bool True if property exists and is not read-only.
     */
    bool SetProperty(OdBm::BuiltInParameter::Enum bip, double value);

    /**
     * @brief Stages a boolean value for an instance property identified by BuiltInParameter.
     * @param bip BuiltInParameter enumeration.
     * @param value Boolean value.
     * @return bool True if property exists and is not read-only.
     */
    bool SetProperty(OdBm::BuiltInParameter::Enum bip, bool value);

    /**
     * @brief String-literal overload; forwards to the OdString overload.
     * @note Without it a wide literal (L"...") binds to the bool overload, because
     *       pointer-to-bool is a standard conversion and beats OdString's constructor.
     * @param bip Target property.
     * @param value New string value (null is treated as empty).
     * @return bool True if staged successfully.
     */
    bool SetProperty(OdBm::BuiltInParameter::Enum bip, const wchar_t* value)
    {
        return SetProperty(bip, value ? OdString(value) : OdString::kEmpty);
    }

    /**
     * @brief Stages a string value for a user-defined or shared parameter by its object ID.
     * @param paramId Object ID of the parameter element.
     * @param value New string value.
     * @return bool True if property exists and is not read-only.
     */
    bool SetProperty(const OdBmObjectId& paramId, const OdString& value);

    /**
     * @brief Stages a string value for a Type property identified by name.
     * @param name Display name or internal identifier of the Type property.
     * @param value New string value.
     * @return bool True if Type exists, property exists, and is not read-only.
     */
    bool SetTypeProperty(const OdString& name, const OdString& value);

    /**
     * @brief Stages a string value for a Type property identified by BuiltInParameter.
     * @param bip BuiltInParameter enumeration of the Type property.
     * @param value New string value.
     * @return bool True if Type exists, property exists, and is not read-only.
     */
    bool SetTypeProperty(OdBm::BuiltInParameter::Enum bip, const OdString& value);

    /**
     * @brief Returns true if any instance or type properties have been modified but not yet synchronized.
     * @return bool Dirty status.
     */
    bool IsDirty() const noexcept;

    /**
     * @brief Discards all staged modifications and reverts cached values to database state.
     */
    void DiscardChanges() noexcept;

    /**
     * @brief Retrieves all properties that have staged modifications.
     * @return std::vector<VBimElementProperty> Staged modified properties.
     */
    std::vector<VBimElementProperty> GetModifiedProperties() const;

    // -----------------------------------------------------------------------
    // Synchronization & Atomic Persistence
    // -----------------------------------------------------------------------

    /**
     * @brief Commits all staged property modifications to the BIM database.
     *
     * Captures an Undo snapshot (`OdaSnapshotDeltaAction`) for Ctrl+Z support if UIDocument is
     * available, starts an `OdExplicitTransaction`, writes the parameter values using native ODA
     * setter routes, commits, invalidates the cache, and triggers a lightweight active view refresh.
     * All-or-nothing: if any write fails (or the type element cannot be opened while type edits are
     * staged) the transaction is rolled back, staged edits are kept and false is returned.
     *
     * @note Inside a VBimCommand using TransactionMode::Automatic this transaction nests in the
     *       command transaction. The Undo step is recorded only after the command transaction
     *       commits; it is dropped when the command is cancelled or fails.
     * @param undoActionName Descriptive label for the undo stack (e.g. L"Edit Element Properties").
     * @param bRefreshUI If true, requests active view invalidation upon successful commit.
     * @return bool True if nothing was staged or every modification committed; false if rolled back.
     */
    bool Sync(
        const OdString& undoActionName = L"Edit Element Properties",
        bool bRefreshUI = true);

    /**
     * @brief String-literal overload preventing L"..." from converting to bool via standard conversion.
     * @param undoActionName Descriptive label for the undo stack.
     * @param bRefreshUI If true, requests active view invalidation upon successful commit.
     * @return bool True if nothing was staged or every modification committed; false if rolled back.
     */
    bool Sync(const wchar_t* undoActionName, bool bRefreshUI = true)
    {
        return Sync(undoActionName ? OdString(undoActionName) : OdString::kEmpty, bRefreshUI);
    }

    /**
     * @brief Overload taking only bRefreshUI flag with default undo label.
     * @param bRefreshUI If true, requests active view invalidation upon successful commit.
     * @return bool True if nothing was staged or every modification committed; false if rolled back.
     */
    bool Sync(bool bRefreshUI)
    {
        return Sync(L"Edit Element Properties", bRefreshUI);
    }

    // -----------------------------------------------------------------------
    // JSON Serialization
    // -----------------------------------------------------------------------

    /**
     * @brief Exports the element's properties and metadata to a structured JSON string.
     * @param includeTypeProperties If true, also includes the associated Type properties in the output.
     * @return std::string UTF-8 encoded JSON representation.
     */
    std::string ToJson(bool includeTypeProperties = true) const;

    /**
     * @brief Imports property values from a JSON string into staged changes.
     * @details Does NOT immediately commit to database; caller must invoke Sync() to apply.
     * @param jsonString UTF-8 encoded JSON string matching schema.
     * @return bool True if parsed and at least one property was staged; false on error.
     */
    bool FromJson(const std::string& jsonString);

private:
    void EnsureCacheLoaded() const;
    void EnsureTypeCacheLoaded() const;
    void RefreshCachedValue(VBimElementProperty& prop) const;
    void RefreshTypeCachedValue(VBimElementProperty& prop) const;

    OdBmDatabase*                                   targetDb_ = nullptr;
    OdBmObjectId                                    m_elementId;
    VBimUIDocument*                                 m_pUIDoc = nullptr;

    mutable bool                                    m_cacheLoaded = false;
    mutable std::vector<VBimElementProperty>        m_cachedProps;

    mutable bool                                    m_typeCacheLoaded = false;
    mutable OdBmObjectId                            m_cachedTypeId;
    mutable std::vector<VBimElementProperty>        m_cachedTypeProps;

    std::map<std::wstring, OdString>                m_stagedChanges;      ///< Key: lower-case param name -> new value
    std::map<std::wstring, OdString>                m_stagedTypeChanges;  ///< Key: lower-case type param name -> new value
};
