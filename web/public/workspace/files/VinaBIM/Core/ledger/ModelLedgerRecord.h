#pragma once

#include <cstdint>
#include "Core/contracts/parameter/VbParameterTypes.h"

namespace vb::ledger
{
	// One (element, parameter) fact in the Model Ledger — a denormalized,
	// in-memory copy of a single parameter's current value on one element,
	// indexed for O(1) lookup instead of re-querying ODA on every BIM QA
	// rule or report pass.
	struct ModelLedgerRecord
	{
		uint64_t elementToken = 0;
		uint64_t categoryToken = 0;
		vb::param::VbParameterIdentity identity;
		vb::param::VbParameterValue value;
	};
}
