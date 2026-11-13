#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "shared/core/VbResult.h"

// Owns engine-neutral DTOs and the polymorphic lifetime used by
// FamilyTypesDialog. No DTO in this contract exposes MFC or ODA types.
class IFamilyTypesController
{
public:
    using OperationDto = vb::Result<vb::Void>;

    enum class DraftIdKind : uint8_t
    {
        Persisted,
        Synthetic
    };

    struct TypeDraftId
    {
        DraftIdKind kind = DraftIdKind::Persisted;
        uint64_t value = 0;

        bool operator==(const TypeDraftId& other) const
        {
            return kind == other.kind && value == other.value;
        }
        bool operator!=(const TypeDraftId& other) const { return !(*this == other); }
        bool operator<(const TypeDraftId& other) const
        {
            return kind != other.kind
                ? static_cast<uint8_t>(kind) < static_cast<uint8_t>(other.kind)
                : value < other.value;
        }
    };

    struct ParamDraftId
    {
        DraftIdKind kind = DraftIdKind::Persisted;
        uint64_t value = 0;

        bool operator==(const ParamDraftId& other) const
        {
            return kind == other.kind && value == other.value;
        }
        bool operator!=(const ParamDraftId& other) const { return !(*this == other); }
        bool operator<(const ParamDraftId& other) const
        {
            return kind != other.kind
                ? static_cast<uint8_t>(kind) < static_cast<uint8_t>(other.kind)
                : value < other.value;
        }
    };

    struct ParameterInputDto
    {
        std::wstring name;
        std::wstring description;
        int groupIndex = 0;
        std::wstring specTypeStr;
        bool isInstance = false;
        bool isExternal = false;
        std::wstring guid;
    };

    struct FamilyTypeDto
    {
        TypeDraftId id;
        std::wstring name;
    };

    struct ParamItemDto
    {
        ParamDraftId id;
        ParameterInputDto definition;
        std::wstring caption;
        int groupIndex = 0;
        std::wstring value;
        std::wstring formula;
        bool isLocked = false;
        bool isInstanceParam = false;
        bool determinedByFormula = false;
        bool removable = true;
        bool canMoveUp = false;
        bool canMoveDown = false;
    };

    struct CellEditActionDto
    {
        bool editable = false;
        bool useValueDropdown = false;
        std::vector<std::wstring> valueOptions;
    };

    struct ViewState
    {
        std::vector<FamilyTypeDto> familyTypes;
        TypeDraftId selectedTypeId;
        int selectedTypeIndex = -1;
        std::vector<ParamItemDto> params;
    };

    using ViewStateResult = vb::Result<ViewState>;
    using CellEditActionResult = vb::Result<CellEditActionDto>;

    virtual ~IFamilyTypesController() = default;
};

// Owns the modal Family Types draft lifecycle. Session operations never open
// an ODA transaction or mutate the family database.
class IFamilyTypesSessionCapability
{
public:
    virtual ~IFamilyTypesSessionCapability() = default;

    // Build a detached baseline and editable draft through read-only ODA calls.
    virtual IFamilyTypesController::OperationDto Initialize() = 0;

    // Restore the editable draft to the last successfully applied baseline.
    // This is memory-only and performs no transaction, rollback, or refresh.
    virtual IFamilyTypesController::OperationDto AbortSession() = 0;

    // Finish an accepted modal session. Apply already rebuilt the baseline, so
    // this method only clears transient controller state and never writes ODA.
    virtual IFamilyTypesController::OperationDto CommitSession() = 0;
};

// Queries and edits detached family-type draft records. Every method except
// ApplyFamilyType is transaction-free and database-read-only.
class IFamilyTypeEditCapability
{
public:
    virtual ~IFamilyTypeEditCapability() = default;

    // Return the current detached draft view.
    virtual IFamilyTypesController::ViewStateResult GetInitialState() = 0;

    // Select a tagged draft type and return its detached parameter cells.
    // Does not call setCurrentFamilyType or mutate the ODA database.
    virtual IFamilyTypesController::ViewStateResult OnFamilyTypeChanged(
        IFamilyTypesController::TypeDraftId typeId) = 0;

    // Add and select a synthetic type cloned from the current draft selection.
    virtual IFamilyTypesController::ViewStateResult AddFamilyType(const std::wstring& name) = 0;

    // Rename the selected draft type without touching the database.
    virtual IFamilyTypesController::OperationDto RenameFamilyType(const std::wstring& newName) = 0;

    // Mark the selected draft type deleted and return the replacement selection.
    virtual IFamilyTypesController::ViewStateResult DeleteFamilyType() = 0;

    // Validate and atomically replay the complete draft in exactly one short ODA
    // transaction, select typeId, then rebuild the detached baseline. When the
    // ODA commit succeeds but baseline readback fails the draft is still
    // durable; callers consult DidLastApplyCommit() and HasCommittedChanges()
    // to distinguish committed-from-readback-failure from a rolled-back Apply.
    virtual IFamilyTypesController::OperationDto ApplyFamilyType(
        IFamilyTypesController::TypeDraftId typeId) = 0;

    // Report whether this modal session has durably committed any draft. This
    // remains true when post-commit baseline readback fails.
    virtual bool HasCommittedChanges() const = 0;

    // Report whether an AV in an ODA call made this controller/database unsafe
    // for further use. Host must quarantine the owning document and close it.
    virtual bool RequiresDatabaseQuarantine() const = 0;

    // Report whether the immediately preceding Apply crossed its commit
    // boundary, even when its post-commit baseline readback returned an error.
    virtual bool DidLastApplyCommit() const = 0;
};

// Creates, updates, removes, and orders detached parameter definitions. Tagged
// draft IDs identify rows even when captions are duplicated or changed.
class IFamilyParameterDefinitionCapability
{
public:
    virtual ~IFamilyParameterDefinitionCapability() = default;

    virtual IFamilyTypesController::ViewStateResult AddParameter(
        const IFamilyTypesController::ParameterInputDto& input) = 0;
    virtual IFamilyTypesController::ViewStateResult ModifyParameter(
        IFamilyTypesController::ParamDraftId paramId,
        const IFamilyTypesController::ParameterInputDto& input) = 0;
    virtual IFamilyTypesController::ViewStateResult RemoveParameter(
        IFamilyTypesController::ParamDraftId paramId) = 0;
    virtual IFamilyTypesController::ViewStateResult MoveParameter(
        IFamilyTypesController::ParamDraftId paramId,
        bool moveUp) = 0;
};

// Describes parameter-grid editors and stores values in detached per-type cells
// while formulas remain parameter-level. These calls never mutate ODA state.
class IFamilyParameterValueCapability
{
public:
    virtual ~IFamilyParameterValueCapability() = default;

    virtual IFamilyTypesController::CellEditActionResult BuildCellEditAction(
        IFamilyTypesController::ParamDraftId paramId,
        int columnIndex) const = 0;
    virtual IFamilyTypesController::OperationDto SetParamValue(
        IFamilyTypesController::ParamDraftId paramId,
        const std::wstring& value) = 0;
    virtual IFamilyTypesController::OperationDto SetFormula(
        IFamilyTypesController::ParamDraftId paramId,
        const std::wstring& formula) = 0;
};
