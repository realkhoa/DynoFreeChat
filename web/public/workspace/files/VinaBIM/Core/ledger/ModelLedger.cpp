#include "pch.h"
#include "Core/ledger/ModelLedger.h"

namespace vb::ledger
{
	ModelLedger::ParamKey ModelLedger::KeyFor(const vb::param::VbParameterIdentity& identity)
	{
		ParamKey key;
		key.builtInParamId = identity.builtInParamId;
		key.draftValue = identity.draftId.value;
		return key;
	}

	void ModelLedger::Upsert(const ModelLedgerRecord& record)
	{
		std::unique_lock lock(mutex_);

		byElement_[record.elementToken][KeyFor(record.identity)] = record;

		const auto existingCategory = elementToCategory_.find(record.elementToken);
		if (existingCategory != elementToCategory_.end() && existingCategory->second != record.categoryToken)
		{
			auto oldCategoryElements = categoryToElements_.find(existingCategory->second);
			if (oldCategoryElements != categoryToElements_.end())
				oldCategoryElements->second.erase(record.elementToken);
		}
		elementToCategory_[record.elementToken] = record.categoryToken;
		categoryToElements_[record.categoryToken].insert(record.elementToken);
	}

	void ModelLedger::RemoveElement(uint64_t elementToken)
	{
		std::unique_lock lock(mutex_);

		byElement_.erase(elementToken);
		const auto categoryIt = elementToCategory_.find(elementToken);
		if (categoryIt != elementToCategory_.end())
		{
			auto categoryElements = categoryToElements_.find(categoryIt->second);
			if (categoryElements != categoryToElements_.end())
				categoryElements->second.erase(elementToken);
			elementToCategory_.erase(categoryIt);
		}
	}

	void ModelLedger::Clear()
	{
		std::unique_lock lock(mutex_);
		byElement_.clear();
		categoryToElements_.clear();
		elementToCategory_.clear();
	}

	std::vector<ModelLedgerRecord> ModelLedger::GetByElement(uint64_t elementToken) const
	{
		std::shared_lock lock(mutex_);
		std::vector<ModelLedgerRecord> result;
		const auto it = byElement_.find(elementToken);
		if (it == byElement_.end())
			return result;
		result.reserve(it->second.size());
		for (const auto& entry : it->second)
			result.push_back(entry.second);
		return result;
	}

	std::vector<ModelLedgerRecord> ModelLedger::GetByCategory(uint64_t categoryToken) const
	{
		std::shared_lock lock(mutex_);
		std::vector<ModelLedgerRecord> result;
		const auto categoryIt = categoryToElements_.find(categoryToken);
		if (categoryIt == categoryToElements_.end())
			return result;
		for (uint64_t elementToken : categoryIt->second)
		{
			const auto elementIt = byElement_.find(elementToken);
			if (elementIt == byElement_.end())
				continue;
			for (const auto& entry : elementIt->second)
				result.push_back(entry.second);
		}
		return result;
	}

	size_t ModelLedger::ElementCount() const
	{
		std::shared_lock lock(mutex_);
		return byElement_.size();
	}

	size_t ModelLedger::RecordCount() const
	{
		std::shared_lock lock(mutex_);
		size_t total = 0;
		for (const auto& entry : byElement_)
			total += entry.second.size();
		return total;
	}
}
