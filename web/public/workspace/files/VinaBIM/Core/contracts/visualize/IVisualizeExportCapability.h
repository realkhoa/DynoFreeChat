#pragma once

#include "Core/contracts/common/ProgressCancelCallbacks.h"
#include "shared/core/VbResult.h"
#include <memory>
#include <string>
#include <utility>

// Capability for exporting IFC/Navisworks files or RVT clash-review models
// to a Visualize scene cache (.vsfx) that the host can load into an MDI
// Visualize Scene without running a native importer in-process.
// Implementation-agnostic: the production implementation runs the
// import/export in an isolated worker process (Infrastructure/Worker), but
// callers only see this ODA-free contract.

// Scene-cache manifest resolved by the implementation (parsed from the
// worker's manifest.txt — callers never touch the transport format).
// modelNameA/B are the fixed names assigned to the two models inside the
// .vsfx (role resolution is by name, never iterator order). sourceFileA/B
// are the user-facing RVT paths (session identity); importedFileA/B are the
// local paths actually imported — they differ when a network-hosted model
// was snapshotted first.
//
struct VisualizeSceneManifest
{
	std::wstring modelNameA;
	std::wstring modelNameB;
	std::wstring sourceFileA;
	std::wstring sourceFileB;
	std::wstring importedFileA;
	std::wstring importedFileB;
};

// Machine-readable failure classification, consumed by the caller's routing
// policy (BackendUnavailable/LaunchFailed surface as installation errors and
// never silently degrade to an in-process import in release builds).
//
enum class VisualizeExportFailureKind
{
	None,                // success
	BackendUnavailable,  // engine binaries missing from the installation
	LaunchFailed,        // engine present but could not be started
	Cancelled,           // caller requested cancellation mid-run
	TimedOut,            // run exceeded the configured time budget
	Failed,              // engine ran and reported a real job failure
	ResultInvalid,       // engine output failed integrity validation
};

// Result payload of ExportPairToVsfx. vsfxPath stays readable exactly as
// long as jobFolderGuard is alive: the guard is an RAII token whose
// destructor deletes the transport job folder (the .vsfx included) on every
// exit path — hold it until the cache has been loaded, then let it go out of
// scope. The implementation makes the deleter a no-op when a
// keep-for-diagnostics setting is enabled.
//
// On failure (vb::Result::ok == false) `failure` carries the kind while the
// Result's `error` string carries the human-readable message (same
// convention as ClashRunResult).
//
struct VisualizeExportResult
{
	std::wstring vsfxPath;
	VisualizeSceneManifest manifest;
	long long importMs = 0;
	long long exportMs = 0;
	std::shared_ptr<void> jobFolderGuard;
	VisualizeExportFailureKind failure = VisualizeExportFailureKind::None;
};

// Builds a failed vb::Result<VisualizeExportResult> carrying both the
// failure kind (value.failure) and the human-readable message (error).
// Implementations must use this instead of vb::Result::Err so the kind is
// never left at None on a failed result.
//
inline vb::Result<VisualizeExportResult> MakeVisualizeExportFailure(
	VisualizeExportFailureKind kind, std::wstring message)
{
	vb::Result<VisualizeExportResult> result;
	result.ok = false;
	result.error = std::move(message);
	result.value.failure = kind;
	return result;
}

// File-kind selector for ImportFileToVsfx: which filer module (Ifc2Visualize
// or Nw2Visualize) the worker backend loads to produce the scene cache.
//
enum class VisualizeFileKind
{
	Ifc, // IFC (.ifc) via OdTvIfc2VisualizeModuleName
	Nw,  // Navisworks (.nwd/.nwc) via OdTvNw2VisualizeModuleName
};

class IVisualizeExportCapability
{
public:
	virtual ~IVisualizeExportCapability() = default;

	// Imports filePathA + filePathB (local paths) and exports them as one
	// .vsfx scene cache; sourceFileA/B are the user-facing identity paths
	// echoed into the manifest (pass the originals when filePathA/B are
	// snapshots).
	//
	// Returns ok with the cache path, manifest, and the RAII jobFolderGuard
	// on success; on failure returns MakeVisualizeExportFailure(...) — the
	// job folder is kept for diagnosis.
	//
	// Blocks the calling thread for the duration of the run and pumps window
	// messages while waiting — UI thread only (matches WorkerProcessClient and
	// WorkerVisualizeExportCapability, the sole implementation). Progress
	// callbacks must marshal to UI themselves if they update controls.
	//
	virtual vb::Result<VisualizeExportResult> ExportPairToVsfx(
		const std::wstring& filePathA, const std::wstring& filePathB,
		const std::wstring& sourceFileA, const std::wstring& sourceFileB,
		const ProgressCancelCallbacks& callbacks) = 0;

	// Imports filePathA only and exports it as one .vsfx scene cache for
	// single-model clash review. sourceFileA is the user-facing identity path
	// echoed into the manifest. On success the manifest B fields are empty.
	//
	// Same failure-kind and jobFolderGuard lifetime rules as ExportPairToVsfx.
	//
	virtual vb::Result<VisualizeExportResult> ExportSingleToVsfx(
		const std::wstring& filePathA,
		const std::wstring& sourceFileA,
		const ProgressCancelCallbacks& callbacks) = 0;

	// Imports filePath (an IFC or Navisworks file) via the worker process and
	// writes a .vsfx scene cache — no Ifc2Visualize/Nw2Visualize runs in
	// VinaBIM.exe. Any native-reader crash kills only the worker, not the
	// host process. fileKind selects which filer the worker uses.
	//
	// sourceFilePath is the user-facing identity path echoed into the manifest
	// (pass the original when filePath is a local snapshot of a network file).
	//
	// Same failure-kind contract and jobFolderGuard lifetime rules as
	// ExportPairToVsfx. On success manifest B fields are empty (single-file).
	//
	virtual vb::Result<VisualizeExportResult> ImportFileToVsfx(
		const std::wstring& filePath, const std::wstring& sourceFilePath,
		VisualizeFileKind fileKind, const ProgressCancelCallbacks& callbacks) = 0;
};
