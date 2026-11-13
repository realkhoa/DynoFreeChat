#pragma once

#include <cstdint>
#include <vector>
#include "Core/contracts/parameter/VbParameterTypes.h"
#include "shared/core/VbResult.h"

namespace vb::param
{
	// Engine-neutral read access to an element's parameters. Implemented by
	// Infrastructure/Oda (OdaParameterAdapter) and consumed by Application
	// UseCases (PropertiesPanelUseCase, ScheduleUseCase, ModelLedgerSyncService)
	// so those layers never include OdBm*/OdDb* headers directly.
	//
	// Read-only: this contract has no write/edit methods. Parameter mutation
	// goes through IParameterWriter (Task P5), which owns transaction scope.
	class IParameterProvider
	{
	public:
		virtual ~IParameterProvider() = default;

		// Return every built-in and user/shared parameter visible on the element
		// identified by elementToken (an OdBmObjectId packed via OBJID2DWORDPTR),
		// joined with its current value. O(N) in the element's parameter count —
		// intended for Properties panel and Schedule row population, not for
		// single-parameter lookups (use GetParameterValue for that).
		//
		// Returns Result::Err when elementToken does not resolve to a live
		// element in the current database.
		virtual vb::Result<std::vector<VbParameterItem>> GetElementParameters(
			uint64_t elementToken) const = 0;

		// Return the current value of exactly one parameter on one element via
		// direct ODA handle lookup (O(1)), avoiding the full parameter-set scan
		// used by GetElementParameters. Intended for Model Ledger point queries.
		//
		// Returns Result::Err when elementToken does not resolve, or the element
		// does not carry a parameter matching identity.
		virtual vb::Result<VbParameterValue> GetParameterValue(
			uint64_t elementToken,
			const VbParameterIdentity& identity) const = 0;
	};
}
