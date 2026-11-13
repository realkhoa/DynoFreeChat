#pragma once

#include "../selection/IEditorSelectionProvider.h"
#include <functional>

/** Erase/hide operations on the working selection in the active view. */
class ISelectionEraseHide
{
public:
	virtual ~ISelectionEraseHide() = default;

	/** @param nativeBmDbViewPtr Opaque native active-view pointer (same as getActiveDbView().get()). */
	virtual void hideWorkingSelectionInActiveView(
		IEditorSelectionProvider& selection,
		void* nativeBmDbViewPtr,
		const std::function<void()>& afterHideBeforeCommit) = 0;

	virtual void eraseWorkingSelectionEntities(IEditorSelectionProvider& selection) = 0;
};
