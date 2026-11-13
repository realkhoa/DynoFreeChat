#pragma once

/** Host implements this to react to editor/jig events without coupling ODA trackers to CVinaBIMView. */
class IEditorUiPolicy
{
public:
	virtual ~IEditorUiPolicy() = default;

	/** Invoked when interactive jig sampling returns a non-normal status (e.g. cancel). */
	virtual void onJigSamplerNonNormal() = 0;
};
