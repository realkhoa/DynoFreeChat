#pragma once

#include <cstdint>
#include <string>
#include "Core/contracts/parameter/VbParamDraftId.h"

namespace vb::param
{
	// Stable, engine-neutral key for a parameter. Revit/ODA identify a parameter
	// by BuiltInParameter enum, by shared-parameter GUID, or (for project/family
	// user parameters) by neither — only by its ODA object handle carried in
	// draftId. parameterName is a display fallback only and must never be used
	// as a lookup key: captions are not unique and can be renamed.
	struct VbParameterIdentity
	{
		VbParamDraftId draftId;
		int32_t builtInParamId = -1;   // >= 0 when this is a BuiltInParameter
		std::string sharedGuid;        // non-empty when this is a Shared Parameter
		std::wstring parameterName;    // display-only fallback, not a lookup key

		bool operator==(const VbParameterIdentity& other) const
		{
			return draftId == other.draftId
				&& builtInParamId == other.builtInParamId
				&& sharedGuid == other.sharedGuid;
		}
		bool operator!=(const VbParameterIdentity& other) const { return !(*this == other); }
	};
}
