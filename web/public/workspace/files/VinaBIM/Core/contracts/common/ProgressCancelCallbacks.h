#pragma once

#include <functional>
#include <string>

// Progress/cancel hooks shared by long-running capability contracts (clash
// runs, visualize scene-cache export, ...). Both members are optional (may be
// empty). onProgress receives a coarse stage name and a 0..100 percentage and
// is invoked on the calling thread. isCancelled is polled during the run;
// returning true requests a cooperative abort.
//
// Core contract only — no ODA or MFC types. Lives in contracts/common so a
// domain contract never has to include another domain's contract just to
// share this shape.
//
struct ProgressCancelCallbacks
{
	std::function<void(const std::wstring& stage, int pct)> onProgress;
	std::function<bool()> isCancelled;
};
