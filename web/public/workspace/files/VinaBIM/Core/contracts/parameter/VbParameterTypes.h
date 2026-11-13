#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "Core/contracts/parameter/VbParameterIdentity.h"

namespace vb::param
{
	// Mirrors OdBm::StorageType without exposing the ODA enum to Core/Application.
	// Button has no scalar value; Host renders it as an "Edit..." affordance.
	enum class VbStorageType : uint8_t
	{
		Integer = 0,
		Double = 1,
		String = 2,
		ElementId = 3,
		Button = 4
	};

	// Engine-neutral parameter metadata (Revit's Definition/InternalDefinition).
	// Carries no current value — see VbParameterValue for that.
	struct VbParameterDefinition
	{
		VbParameterIdentity identity;
		std::wstring caption;
		std::wstring groupName;
		int groupIndex = 0;
		VbStorageType storageType = VbStorageType::String;
		std::string specTypeId;        // ForgeTypeId string, e.g. "autodesk.spec.aec:length-2.0.0"
		bool isReadOnly = false;
		bool isUserVisible = true;
		bool isInstance = true;        // false => Type/FamilySymbol parameter
		bool isDeterminedByFormula = false;
	};

	// Engine-neutral current value of one parameter on one element. Exactly one
	// of rawDouble/rawInteger/rawString/rawElementId is meaningful, selected by
	// the owning VbParameterDefinition::storageType. displayString is the
	// already-unit-formatted text (e.g. "2500 mm") for read-only presentation.
	struct VbParameterValue
	{
		VbParameterIdentity identity;
		double rawDouble = 0.0;
		int64_t rawInteger = 0;
		std::wstring rawString;
		uint64_t rawElementId = 0;
		std::wstring displayString;
		std::vector<std::wstring> choiceOptions; // populated for ComboBox/Dropdown storage
	};

	// Joined read row combining a parameter's metadata and its current value on
	// one element, as consumed by the Properties panel and the Model Ledger.
	// Kept separate from VbParameterDefinition/VbParameterValue so callers that
	// need only one side (e.g. definition-only schema queries) are not forced
	// to pay for the other.
	struct VbParameterItem
	{
		VbParameterDefinition definition;
		VbParameterValue value;
	};
}
