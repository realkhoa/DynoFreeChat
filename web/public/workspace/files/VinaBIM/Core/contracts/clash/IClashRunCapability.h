#pragma once

#include "Core/contracts/clash/IClashDetectionCapability.h"
#include "Core/contracts/common/ProgressCancelCallbacks.h"
#include "shared/core/VbResult.h"
#include <functional>
#include <string>
#include <utility>
#include <vector>

// Capability for running one clash (interference) detection job with
// progress reporting and cooperative cancellation. Implementation-agnostic:
// the production implementation runs the job in an isolated worker process
// (Infrastructure/Worker), but callers only see this ODA-free contract —
// no process, IPC, or worker detail crosses this boundary.
//
// Reuses ClashDetectionParams / ClashDetectionResult / ClashPairRow from
// IClashDetectionCapability.h. Core contract only — no ODA (OdTv*/Od*) or
// MFC types.

// Progress/cancel hooks supplied by the caller — the shared
// contracts/common shape (stages here: "import", "collide", "write",
// "done"). Alias kept so existing clash call sites read unchanged.
//
using ClashRunCallbacks = ProgressCancelCallbacks;

// Machine-readable failure classification for a clash run, consumed by the
// caller's routing policy (e.g. BackendUnavailable surfaces as an
// installation/configuration error and never silently degrades to another
// engine in release builds). Names are implementation-neutral on purpose.
//
enum class ClashRunFailureKind
{
	None,                // success
	BackendUnavailable,  // engine binaries missing from the installation
	LaunchFailed,        // engine present but could not be started
	Cancelled,           // caller requested cancellation mid-run
	TimedOut,            // run exceeded the configured time budget
	Failed,              // engine ran and reported a real job failure
	ResultInvalid,       // engine output failed integrity validation
};

// Result payload of RunClash. On success `failure` is None and `detection`
// holds the clash rows and timings. On failure (vb::Result::ok == false)
// `failure` carries the machine-readable kind while the Result's `error`
// string carries the human-readable message — vb::Result has no typed error
// slot, so this convention keeps the repo-wide vb::Result<T> boundary policy
// while still letting callers branch on the failure kind.
//
struct ClashRunResult
{
	ClashDetectionResult detection;
	ClashRunFailureKind failure = ClashRunFailureKind::None;
};

// Describes one source model at the Core federated-run boundary. The format
// is typed here so unsupported protocol tokens cannot leak into Core; worker
// adapters remain responsible for serializing it for their transport.
struct FederatedClashRunModel
{
	std::wstring sourceModelId;
	std::wstring filePath;
	FederatedModelFormat format = FederatedModelFormat::Rvt;
	FederatedComparisonSide side = FederatedComparisonSide::Both;
	FederatedCoordinateMetadata coordinates;
};

struct FederatedClashRunParams
{
	std::vector<FederatedClashRunModel> models;
	FederatedComparisonMode comparisonMode = FederatedComparisonMode::AllFiles;
	bool allowExplicitSelfClash = false;
	ClashDetectionParams options;
};

// Builds a failed vb::Result<ClashRunResult> carrying both the failure kind
// (value.failure) and the human-readable message (error). Implementations
// must use this instead of vb::Result::Err so the kind is never left at None
// on a failed result.
//
inline vb::Result<ClashRunResult> MakeClashRunFailure(
	ClashRunFailureKind kind, std::wstring message)
{
	vb::Result<ClashRunResult> result;
	result.ok = false;
	result.error = std::move(message);
	result.value.failure = kind;
	return result;
}

class IClashRunCapability
{
public:
	virtual ~IClashRunCapability() = default;

	// Runs one self-contained clash job (import + collide) for params.filePathA
	// (+ filePathB when non-empty) and returns the clash rows.
	//
	// Returns ok with rows/timings on success; on failure returns
	// MakeClashRunFailure(...) — error = user-facing message, value.failure =
	// machine-readable kind for the caller's routing policy.
	//
	// Progress and cancellation flow through callbacks (both optional).
	// Blocks the calling thread for the duration of the run; UI callers must
	// keep their own message pump alive (the worker-process implementation
	// pumps messages internally while waiting). UI thread only.
	//
	virtual vb::Result<ClashRunResult> RunClash(
		const ClashDetectionParams& params,
		const ClashRunCallbacks& callbacks) = 0;
};

// Optional extension implemented by the worker-backed capability. Keeping it
// separate preserves source compatibility for existing one/two-file adapters.
class IFederatedClashRunCapability
{
public:
	virtual ~IFederatedClashRunCapability() = default;
	virtual vb::Result<ClashRunResult> RunFederatedClash(
		const FederatedClashRunParams& params,
		const ClashRunCallbacks& callbacks) = 0;
};
