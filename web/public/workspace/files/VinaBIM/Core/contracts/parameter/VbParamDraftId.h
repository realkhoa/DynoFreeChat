#pragma once

#include <cstdint>

namespace vb::param
{
	// Distinguishes a parameter record backed by a real ODA database handle from
	// one that exists only as an in-memory UI draft (e.g. a row queued for
	// creation in Edit Type before Apply). Mirrors IFamilyTypesController's
	// DraftIdKind so the two draft systems stay conceptually aligned.
	enum class DraftKind : uint8_t
	{
		Persisted,  // value is a real ODA object handle
		Synthetic   // value is a UI-only sequence number, not yet written to ODA
	};

	// Opaque identity for a parameter draft row, valid only within one editing
	// session. Not stable across sessions and never persisted to disk.
	struct VbParamDraftId
	{
		DraftKind kind = DraftKind::Persisted;
		uint64_t value = 0;

		bool operator==(const VbParamDraftId& other) const
		{
			return kind == other.kind && value == other.value;
		}
		bool operator!=(const VbParamDraftId& other) const { return !(*this == other); }
		bool operator<(const VbParamDraftId& other) const
		{
			return kind != other.kind
				? static_cast<uint8_t>(kind) < static_cast<uint8_t>(other.kind)
				: value < other.value;
		}
	};
}
