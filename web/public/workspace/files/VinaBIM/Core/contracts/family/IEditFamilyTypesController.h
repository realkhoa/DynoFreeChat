#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "shared/core/VbResult.h"

// Owns the engine-neutral DTO vocabulary and polymorphic lifetime for the
// Edit Family Types workflow. Behavior is exposed through the focused
// capability interfaces below and implemented by Infrastructure.
class IEditFamilyTypesController
{
public:
	using OperationDto = vb::Result<vb::Void>;

	struct FamilyNameDto
	{
		std::wstring name;
		uint64_t familyHandle = 0;
	};

	/**
	 * @brief DTO representing a Family Type displayed in the UI.
	 */
	struct FamilyTypeDto
	{
		std::wstring name;          ///< Display name of the Family Type.
		int typeTableIndex = -1;    ///< Position or table index of the type in the displayed list.
		uint64_t symbolHandle = 0;  ///< Raw database handle of the corresponding OdBmFamilySymbol.
	};

	struct ParamItemDto
	{
		uint64_t paramHandle = 0;
		std::wstring caption;
		int groupIndex = 0;
		std::wstring value;
		std::wstring formula;
		bool isLocked = false;
		bool isInstanceParam = false;
	};

	struct CellEditActionDto
	{
		bool editable = false;
		bool useValueDropdown = false;
		std::vector<std::wstring> valueOptions;
	};

	struct ViewState
	{
		std::vector<FamilyNameDto> familyNames;
		int selectedFamilyIndex = -1;
		std::vector<FamilyTypeDto> familyTypes;
		int selectedTypeIndex = -1;
		std::vector<ParamItemDto> params;
	};

	using ViewStateResult = vb::Result<ViewState>;
	using CellEditActionResult = vb::Result<CellEditActionDto>;
	using SessionCloseResult = vb::Result<bool>;

	virtual ~IEditFamilyTypesController() = default;
};

// Controls the lifetime and final commit boundary of one modal edit session.
// All database mutation remains in the Infrastructure implementation.
class IEditFamilyTypesSessionCapability
{
public:
	virtual ~IEditFamilyTypesSessionCapability() = default;

	// Resolve the initial family context and prepare the edit session.
	// Returns an error without exposing engine-specific state to Host.
	virtual IEditFamilyTypesController::OperationDto Initialize() = 0;

	// Roll back any failed open Apply transaction and drop buffered edits. Safe
	// to call on X/Cancel when no transaction exists.
	virtual IEditFamilyTypesController::OperationDto AbortEditSession() = 0;

	// Apply the selected family type and all buffered parameter values through one
	// short write transaction. Any failed write is rolled back before returning.
	virtual IEditFamilyTypesController::OperationDto ApplyFamilyTypeChanges() = 0;

	// Report whether any durable write committed. Rolled-back Apply attempts do
	// not set this state; Host uses it to choose the modal result and refresh.
	virtual IEditFamilyTypesController::SessionCloseResult RequiresSessionClose() const = 0;

	// Report whether a native database fault requires Host to quarantine and
	// close the document. This remains engine-neutral and performs no recovery.
	virtual bool RequiresDatabaseQuarantine() const = 0;
};

// Exposes family/type selection and mutation for the active edit session.
// Paths and identifiers are engine-neutral values supplied by Host/Application.
class IEditFamilyTypesSelectionCapability
{
public:
	virtual ~IEditFamilyTypesSelectionCapability() = default;

	// Build the view state for a selected family/type pair.
	virtual IEditFamilyTypesController::ViewStateResult OnTypeChanged(
		int familyNameSelIdx,
		int familyTypeSelIdx) = 0;

	// Resolve a family by name and return its refreshed view state.
	virtual IEditFamilyTypesController::ViewStateResult OnFamilyChanged(
		const std::wstring& familyName) = 0;

	// Import a validated family path and return the refreshed view state.
	// File selection remains owned by Host and is never invoked by Infrastructure.
	virtual IEditFamilyTypesController::ViewStateResult AddFamilyTypeFromFile(
		int requestedFamilyIndex,
		const std::wstring& familyPath) = 0;

	// Rename one family type inside the active edit session.
	virtual IEditFamilyTypesController::OperationDto RenameFamilyType(
		int32_t typeIndex,
		const std::wstring& newTypeName) = 0;
};

// Describes and buffers edits made through the parameter grid.
// Buffered values are committed by the session capability during Apply.
class IEditFamilyTypesParameterCapability
{
public:
	virtual ~IEditFamilyTypesParameterCapability() = default;

	// Describe the editor required for one parameter-grid cell.
	virtual IEditFamilyTypesController::CellEditActionResult BuildCellEditAction(
		const std::vector<uint64_t>& paramHandles,
		uint32_t paramIndex,
		int columnIndex) const = 0;

	// Validate and buffer one parameter edit without committing the session.
	virtual IEditFamilyTypesController::OperationDto OnParamEdited(
		uint64_t paramHandle,
		const std::wstring& inputValue) = 0;
};
