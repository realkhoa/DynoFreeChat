#pragma once

/** Host implements user-visible notifications; core code calls through `vbimNotifyUser()` only. */
class INotifyUser
{
public:
	virtual ~INotifyUser() = default;

	/** e.g. placeholder command or unsupported workflow — may show UI, toast, or no-op in tests. */
	virtual void onFeatureNotYetAvailable() = 0;
};
