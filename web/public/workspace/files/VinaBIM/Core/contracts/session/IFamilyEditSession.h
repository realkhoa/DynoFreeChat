#pragma once

#include "../family/EditFamilyException.h"
#include "../family/IEditFamilyCapability.h"
#include "../family/IFamilyEditDocumentToken.h"
#include "../selection/IEditorSelectionProvider.h"
#include <functional>
#include <memory>
#include <string>

struct EditFamilyOutcome
{
	enum class Kind
	{
		ActivatedExistingDocument,
		CreatedEditSession
	};
	Kind kind = Kind::ActivatedExistingDocument;
	std::shared_ptr<IFamilyEditDocumentToken> newDocument;
	std::wstring familyName;
};

/** Family-edit-session lifecycle: opening a family document for in-place or type editing. */
class IFamilyEditSession
{
public:
	virtual ~IFamilyEditSession() = default;

	virtual EditFamilyOutcome editFamily(
		IEditorSelectionProvider& selection,
		const std::function<bool(const std::wstring&)>& tryActivateExistingOpenFamily) = 0;

	virtual void openFamilyDocumentForEditing(
		const std::shared_ptr<IFamilyEditDocumentToken>& token,
		const std::wstring& title) = 0;

	virtual IEditFamilyCapability* editFamilyCapability() = 0;
};
