#pragma once

#include <cstddef>
#include <cstdint>
#include <shared_mutex>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include "Core/ledger/ModelLedgerRecord.h"

namespace vb::ledger
{
	// In-memory, multi-indexed store of ModelLedgerRecord facts, giving O(1)
	// average lookup by element and by category — avoiding a live ODA
	// round-trip for every BIM QA rule or report query. Thread-safe for
	// concurrent readers via std::shared_mutex; writers (Upsert/RemoveElement/
	// Clear) take an exclusive lock.
	//
	// This is a plain cache: it holds whatever ModelLedgerSyncService (Task
	// P12, Application layer) last wrote into it and does not itself talk to
	// ODA or detect staleness.
	class ModelLedger
	{
	public:
		// Inserts or replaces the record for (record.elementToken, the
		// parameter identified by record.identity). O(1) average.
		void Upsert(const ModelLedgerRecord& record);

		// Removes every record for elementToken (e.g. on element deletion).
		// O(k) where k is the element's own parameter count.
		void RemoveElement(uint64_t elementToken);

		void Clear();

		// Returns every record for elementToken. O(1) average to locate the
		// element's record set, O(k) to copy it out.
		std::vector<ModelLedgerRecord> GetByElement(uint64_t elementToken) const;

		// Returns every record for every element tracked under categoryToken.
		// O(1) average to locate the category's element set.
		std::vector<ModelLedgerRecord> GetByCategory(uint64_t categoryToken) const;

		size_t ElementCount() const;
		size_t RecordCount() const;

	private:
		// Keys a single parameter slot within one element's record set.
		// builtInParamId identifies built-in parameters; draftValue (the
		// packed persisted parameter object handle) identifies user/project/
		// shared parameters — the same disambiguation VbParameterIdentity
		// itself uses (see Core/contracts/parameter/VbParameterIdentity.h).
		struct ParamKey
		{
			int32_t builtInParamId = -1;
			uint64_t draftValue = 0;
			bool operator==(const ParamKey& other) const
			{
				return builtInParamId == other.builtInParamId && draftValue == other.draftValue;
			}
		};
		struct ParamKeyHash
		{
			size_t operator()(const ParamKey& key) const noexcept
			{
				return std::hash<int64_t>()(
					(static_cast<int64_t>(key.builtInParamId) << 32) ^ static_cast<int64_t>(key.draftValue));
			}
		};

		static ParamKey KeyFor(const vb::param::VbParameterIdentity& identity);

		mutable std::shared_mutex mutex_;
		std::unordered_map<uint64_t, std::unordered_map<ParamKey, ModelLedgerRecord, ParamKeyHash>> byElement_;
		std::unordered_map<uint64_t, std::unordered_set<uint64_t>> categoryToElements_;
		std::unordered_map<uint64_t, uint64_t> elementToCategory_;
	};
}
