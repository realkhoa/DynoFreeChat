// VBimProjectProperties.h
//
// High-level public API for reading, mutating, syncing, and serializing
// project-level properties (Project Information) in VinaBIM SDK.
//
#pragma once

#include "../VinaBIMApiExport.h"
#include "VBimProjectProperty.h"

#include "Base/BmObjectId.h"
#include "OdArray.h"
#include "OdString.h"

#include <functional>
#include <map>
#include <memory>
#include <vector>

class OdBmDatabase;
class VBimUIDocument;

/**
 * @brief Public service API providing full management of Project Properties.
 *
 * Provides a unified facade for accessing project metadata:
 *   1. Query: Retrieve all properties, inspect by name or BuiltInParameter enum.
 *   2. Modify: In-place staging of property edits with dirty tracking and validation.
 *   3. Sync: Atomic commit to ODA database using RAII transactions, recording undo
 *            snapshots for Ctrl+Z support, and refreshing UI components (views,
 *            Project Browser, Properties pane).
 *   4. Value-Add Enhancements: JSON serialization / deserialization, change tracking,
 *            type conversion, and sync callbacks.
 *
 * @note Designed for both SDK plugin developers and internal host workflows.
 */
class VINABIMCORE_DLLEXPORT VBimProjectProperties
{
public:
    /// Callback signature invoked whenever properties are successfully committed and synchronized.
    using OnSyncedCallback = std::function<void(const OdBmObjectId& projectInfoId)>;

    /**
     * @brief Constructs a Project Properties facade bound to an ODA BIM database.
     * @param pDb Pointer to the target BIM database.
     * @param pUIDoc Optional pointer to active UIDocument (required for Undo recording and UI refresh).
     */
    explicit VBimProjectProperties(OdBmDatabase* pDb, VBimUIDocument* pUIDoc = nullptr);

    /**
     * @brief Virtual destructor.
     */
    virtual ~VBimProjectProperties();

    // -----------------------------------------------------------------------
    // Validation & State
    // -----------------------------------------------------------------------

    /**
     * @brief Checks if the underlying database is valid and contains a Project Information element.
     * @return bool True if operations can be performed safely.
     */
    bool IsValid() const noexcept;

    /**
     * @brief Retrieves the ODA element ID of the OdBmProjectInfo entity.
     * @return OdBmObjectId The Project Information element ID (or null ID if invalid).
     */
    OdBmObjectId GetProjectInfoId() const;

    /**
     * @brief Checks whether there are staged modifications that have not yet been synced.
     * @return bool True if any property has been altered since initialization or last Sync.
     */
    bool IsDirty() const noexcept;

    /**
     * @brief Discards all uncommitted staged modifications and reloads state from database.
     */
    void DiscardChanges();

    /**
     * @brief Retrieves the list of properties that have been staged/modified and differ from database.
     * @return OdArray<VBimProjectProperty> Array of modified properties.
     */
    OdArray<VBimProjectProperty> GetModifiedProperties() const;

    // -----------------------------------------------------------------------
    // 1. Query / Get Properties
    // -----------------------------------------------------------------------

    /**
     * @brief Retrieves all project properties (both built-in and user/shared parameters).
     * @param[out] outProps Array populated with all found project properties.
     * @return bool True if properties were successfully collected.
     */
    bool GetAllProperties(OdArray<VBimProjectProperty>& outProps) const;

    /**
     * @brief Retrieves all project properties as a returned array.
     * @return OdArray<VBimProjectProperty> Array of project properties.
     */
    OdArray<VBimProjectProperty> GetAllProperties() const;

    /**
     * @brief Finds a property by its display name (case-insensitive) or internal symbol name.
     * @param nameOrInternalName Display caption (e.g. L"Project Name") or symbol (e.g. L"PROJECT_NAME").
     * @param[out] outProp Populated property record if found.
     * @return bool True if found, false otherwise.
     */
    bool GetProperty(const OdString& nameOrInternalName, VBimProjectProperty& outProp) const;

    /**
     * @brief Finds a property by its ODA BuiltInParameter enumeration value.
     * @param bip Built-in parameter ID.
     * @param[out] outProp Populated property record if found.
     * @return bool True if found, false otherwise.
     */
    bool GetProperty(OdBm::BuiltInParameter::Enum bip, VBimProjectProperty& outProp) const;

    /**
     * @brief Retrieves the string value of a property by name.
     * @param name Property display caption or internal symbol.
     * @param defaultVal Default value returned if property not found or empty.
     * @return OdString Property string value.
     */
    OdString GetString(const OdString& name, const OdString& defaultVal = OdString::kEmpty) const;

    /**
     * @brief Retrieves the string value of a property by BuiltInParameter.
     * @param bip Built-in parameter ID.
     * @param defaultVal Default value returned if property not found or empty.
     * @return OdString Property string value.
     */
    OdString GetString(OdBm::BuiltInParameter::Enum bip, const OdString& defaultVal = OdString::kEmpty) const;

    /**
     * @brief Retrieves the integer value of a property by name.
     * @param name Property name.
     * @param defaultVal Fallback integer if not found or parsing fails.
     * @return int Parsed integer.
     */
    int GetInt(const OdString& name, int defaultVal = 0) const;

    /**
     * @brief Retrieves the double-precision floating point value of a property by name.
     * @param name Property name.
     * @param defaultVal Fallback double if not found or parsing fails.
     * @return double Parsed floating-point value.
     */
    double GetDouble(const OdString& name, double defaultVal = 0.0) const;

    /**
     * @brief Retrieves the boolean value of a property by name.
     * @param name Property name.
     * @param defaultVal Fallback boolean if not found or parsing fails.
     * @return bool Parsed boolean flag.
     */
    bool GetBool(const OdString& name, bool defaultVal = false) const;

    /**
     * @brief Retrieves the Project Name parameter value.
     * @return OdString Project Name.
     */
    OdString GetProjectName() const;

    /**
     * @brief Retrieves the Project Number parameter value.
     * @return OdString Project Number.
     */
    OdString GetProjectNumber() const;

    /**
     * @brief Retrieves the Project Status parameter value.
     * @return OdString Project Status.
     */
    OdString GetProjectStatus() const;

    /**
     * @brief Retrieves the Client Name parameter value.
     * @return OdString Client Name.
     */
    OdString GetClientName() const;

    /**
     * @brief Retrieves the Project Address parameter value.
     * @return OdString Project Address.
     */
    OdString GetProjectAddress() const;

    /**
     * @brief Retrieves the Project Issue Date parameter value.
     * @return OdString Project Issue Date.
     */
    OdString GetIssueDate() const;

    /**
     * @brief Retrieves the Author parameter value.
     * @return OdString Author.
     */
    OdString GetAuthor() const;

    /**
     * @brief Retrieves the Building Name parameter value.
     * @return OdString Building Name.
     */
    OdString GetBuildingName() const;

    /**
     * @brief Retrieves the Organization Name parameter value.
     * @return OdString Organization Name.
     */
    OdString GetOrganizationName() const;

    /**
     * @brief Retrieves the Organization Description parameter value.
     * @return OdString Organization Description.
     */
    OdString GetOrganizationDescription() const;

    // -----------------------------------------------------------------------
    // 2. Modify / Set Properties
    // -----------------------------------------------------------------------

    /**
     * @brief Stages a property modification by display caption or internal symbol name.
     * @param nameOrInternalName Target property name.
     * @param value New string value.
     * @return bool True if property was located and staged, false if not found or read-only.
     */
    bool SetProperty(const OdString& nameOrInternalName, const OdString& value);

    /**
     * @brief Stages a property modification by BuiltInParameter ID.
     * @param bip Target built-in parameter enum.
     * @param value New string value.
     * @return bool True if staged successfully.
     */
    bool SetProperty(OdBm::BuiltInParameter::Enum bip, const OdString& value);

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
     * @brief Stages an integer property value.
     * @param name Target property name.
     * @param value Integer value.
     * @return bool True if staged successfully.
     */
    bool SetProperty(const OdString& name, int value);

    /**
     * @brief Stages a double property value.
     * @param name Target property name.
     * @param value Floating-point value.
     * @param precision Decimal precision.
     * @return bool True if staged successfully.
     */
    bool SetProperty(const OdString& name, double value, int precision = 3);

    /**
     * @brief Stages a boolean property value.
     * @param name Target property name.
     * @param value Boolean flag.
     * @return bool True if staged successfully.
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
     * @brief Stages batch modifications from an array of properties.
     * @param props Array of updated property records.
     * @return bool True if at least one property was updated.
     */
    bool SetProperties(const OdArray<VBimProjectProperty>& props);

    /**
     * @brief Stages a new Project Name value.
     * @param val New Project Name.
     * @return bool True if staged successfully.
     */
    bool SetProjectName(const OdString& val);

    /**
     * @brief Stages a new Project Number value.
     * @param val New Project Number.
     * @return bool True if staged successfully.
     */
    bool SetProjectNumber(const OdString& val);

    /**
     * @brief Stages a new Project Status value.
     * @param val New Project Status.
     * @return bool True if staged successfully.
     */
    bool SetProjectStatus(const OdString& val);

    /**
     * @brief Stages a new Client Name value.
     * @param val New Client Name.
     * @return bool True if staged successfully.
     */
    bool SetClientName(const OdString& val);

    /**
     * @brief Stages a new Project Address value.
     * @param val New Project Address.
     * @return bool True if staged successfully.
     */
    bool SetProjectAddress(const OdString& val);

    /**
     * @brief Stages a new Project Issue Date value.
     * @param val New Project Issue Date.
     * @return bool True if staged successfully.
     */
    bool SetIssueDate(const OdString& val);

    /**
     * @brief Stages a new Author value.
     * @param val New Author.
     * @return bool True if staged successfully.
     */
    bool SetAuthor(const OdString& val);

    /**
     * @brief Stages a new Building Name value.
     * @param val New Building Name.
     * @return bool True if staged successfully.
     */
    bool SetBuildingName(const OdString& val);

    /**
     * @brief Stages a new Organization Name value.
     * @param val New Organization Name.
     * @return bool True if staged successfully.
     */
    bool SetOrganizationName(const OdString& val);

    /**
     * @brief Stages a new Organization Description value.
     * @param val New Organization Description.
     * @return bool True if staged successfully.
     */
    bool SetOrganizationDescription(const OdString& val);

    // -----------------------------------------------------------------------
    // 3. Sync & Commit
    // -----------------------------------------------------------------------

    /**
     * @brief Commits all staged property changes down into the ODA database atomically.
     *
     * Workflow:
     *   1. Captures an Undo snapshot (OdaSnapshotDeltaAction) when a VBimUIDocument is bound.
     *   2. Starts an OdExplicitTransaction and writes the changed parameters to OdBmProjectInfo.
     *   3. All-or-nothing: if any write fails (or throws) the transaction is rolled back, the
     *      staged edits are kept for inspection/retry, no Undo action is recorded and false is returned.
     *   4. Otherwise commits and registers the Undo action with VBimUIDocument.
     *   5. If bRefreshUI is true, refreshes the active view and the Project Browser.
     *   6. Clears dirty state and fires registered OnSynced callbacks.
     *
     * @note Inside a VBimCommand using TransactionMode::Automatic this transaction nests in the
     *       command transaction; the Undo step is recorded only after the command transaction
     *       commits and is dropped when the command is cancelled or fails. Double values are
     *       read in the project's display units and converted to internal units. UI thread only.
     */
    bool Sync(bool bRefreshUI = true, const OdString& undoActionName = L"Modify Project Properties");

    /**
     * @brief Overload taking undo action name first to prevent wide string literals from binding to bool.
     * @param undoActionName Descriptive label for the undo stack.
     * @param bRefreshUI If true, refreshes the active view and the Project Browser after commit.
     * @return bool True if nothing was staged or every modification committed; false otherwise.
     */
    bool Sync(const OdString& undoActionName, bool bRefreshUI = true)
    {
        return Sync(bRefreshUI, undoActionName);
    }

    /**
     * @brief String-literal overload preventing L"..." from converting to bool via standard conversion.
     * @param undoActionName Descriptive label for the undo stack.
     * @param bRefreshUI If true, refreshes the active view and the Project Browser after commit.
     * @return bool True if nothing was staged or every modification committed; false otherwise.
     */
    bool Sync(const wchar_t* undoActionName, bool bRefreshUI = true)
    {
        return Sync(bRefreshUI, undoActionName ? OdString(undoActionName) : OdString::kEmpty);
    }

    // -----------------------------------------------------------------------
    // 4. Value-Add Enhancements (JSON, Validation, Observers)
    // -----------------------------------------------------------------------

    /**
     * @brief Exports all project properties to a structured JSON string.
     * @param formatted If true, formats with indentation and newlines; false for compact.
     * @return OdString Serialized JSON document.
     */
    OdString ToJson(bool formatted = true) const;

    /**
     * @brief Imports and stages project properties from a JSON string.
     * @param jsonString Serialized JSON input string.
     * @param autoSync If true, immediately commits and syncs changes to DB and UI.
     * @return bool True if JSON parsed successfully and at least one property was updated.
     */
    bool FromJson(const OdString& jsonString, bool autoSync = false);

    /**
     * @brief Validates whether a value is valid for the named property.
     * @param name Target property name.
     * @param value Proposed value string.
     * @param[out] outError Error message if validation fails.
     * @return bool True if valid, false if invalid.
     */
    bool ValidateProperty(const OdString& name, const OdString& value, OdString& outError) const;

    /**
     * @brief Registers a listener callback invoked upon each successful Sync().
     * @param cb Callback function.
     */
    void RegisterOnSyncedCallback(OnSyncedCallback cb);

private:
    /**
     * @brief Lazily loads all project properties from the database into the internal cache.
     */
    void EnsureCacheLoaded() const;

    /**
     * @brief Overlays staged user edits onto a cached property object.
     * @param prop Target property being refreshed.
     */
    void RefreshCachedValue(VBimProjectProperty& prop) const;

    OdBmDatabase* targetDb_ = nullptr;
    VBimUIDocument* m_pUIDoc = nullptr;

    mutable bool    m_cacheLoaded = false;
    mutable std::vector<VBimProjectProperty> m_cachedProps;
    std::map<std::wstring, OdString>         m_stagedChanges;
    std::vector<OnSyncedCallback>            m_callbacks;
};
