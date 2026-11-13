#pragma once

class IEditorSelectionProvider
{
public:
	virtual ~IEditorSelectionProvider() = default;

	/** Opaque native selection-set pointer; valid only for the duration of the synchronous call into the session capability consuming it. */
	virtual void* nativeWorkingSelectionSet() const noexcept = 0;
};
