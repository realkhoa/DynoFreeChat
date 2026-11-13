#pragma once

#include "IFamilyEditDocumentToken.h"
#include <memory>
#include <string>

struct EditFamilyCapabilityResult
{
	bool ok = false;
	std::wstring message;
};

struct BeginFamilyTypeEditResult : EditFamilyCapabilityResult
{
	void* editFamilyDatabase = nullptr;
	std::shared_ptr<IFamilyEditDocumentToken> sessionToken;
};

class IEditFamilyCapability
{
public:
	virtual ~IEditFamilyCapability() = default;

	virtual BeginFamilyTypeEditResult beginFamilyTypeEditSession(uint64_t selectedElementHandle) = 0;
	virtual EditFamilyCapabilityResult applyFamilyTypeEditSession(
		const std::shared_ptr<IFamilyEditDocumentToken>& sessionToken) = 0;
};
