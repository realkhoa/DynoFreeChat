#pragma once

#include "Core/contracts/visualize/IVisualizeReviewCapability.h"
#include "Core/contracts/visualize/IVisualizeExportCapability.h"
#include "shared/core/VbResult.h"
#include <cstdint>
#include <string>

// Focused capability for reviewing a clash (interference) test between two
// RVT files inside one Visualize scene: both models are imported into a
// single scene database so collided elements from BOTH files are visible
// together — the host document viewport can only ever show file A.
//
// Implemented as an optional facet of the MDI Visualize Scene adapter and
// shares that document's scene session: ImportRvtPair replaces any prior
// scene in that document, and the document/view ReleaseSession path also
// discards the pair session and its highlights.
//
// Element handles are the native RVT element handles produced by the clash
// report (ClashDetectionTool), carried as neutral std::uint64_t. Core
// contracts do not depend on ODA headers.
struct VisualizeClashCamera
{
	double posX = 0.0;
	double posY = 0.0;
	double posZ = 0.0;
	double dirX = -0.5773502692;
	double dirY = 0.5773502692;
	double dirZ = -0.5773502692;
	double upX = -0.4082482905;
	double upY = 0.4082482905;
	double upZ = 0.8164965809;
	double fov = 60.0;

	// Bounding box in metres for BCF 2.1 Section Box / ClippingPlanes
	double bboxMinX = 0.0;
	double bboxMinY = 0.0;
	double bboxMinZ = 0.0;
	double bboxMaxX = 0.0;
	double bboxMaxY = 0.0;
	double bboxMaxZ = 0.0;
	double centerX = 0.0;
	double centerY = 0.0;
	double centerZ = 0.0;
	bool hasBbox = false;
	bool valid = false;
};

struct VisualizeClashPairTarget
{
	std::wstring sourceModelIdA;
	std::uint64_t handleA = 0;
	std::wstring sourceModelIdB;
	std::uint64_t handleB = 0;
};

struct VisualizeClashSnapshotResult
{
	std::string base64Png;
	VisualizeClashCamera camera;
};

class IVisualizeClashReviewCapability
{
public:
	virtual ~IVisualizeClashReviewCapability() = default;

	// Imports two RVT files into ONE new Visualize scene database (two models
	// sharing the scene), replacing any session already held by the adapter,
	// and attaches both models to the scene's first view so a subsequent
	// BindToWindow shows them together.
	//
	// Returns combined session metadata on success, or an error message on
	// failure (a mid-pair failure releases the partial session). Does not
	// bind the scene to a window. Safe to call from a worker thread — the
	// required Bim2Visualize module is pre-loaded on the UI thread by the
	// adapter constructor.
	//
	virtual vb::Result<VisualizeSessionInfo> ImportRvtPair(
		const std::wstring& filePathA, const std::wstring& filePathB) = 0;

	// Imports one RVT file into ONE new Visualize scene database for
	// single-model clash review, replacing any session already held by the
	// adapter. Both clash handles are resolved against model A's native-handle
	// map; model B remains absent.
	//
	// Returns session metadata on success, or an error message on failure.
	// Does not bind the scene to a window. UI thread only in the current
	// Visualize Review integration.
	//
	virtual vb::Result<VisualizeSessionInfo> ImportRvtSingle(
		const std::wstring& filePathA) = 0;

	// Loads a worker-exported .vsfx scene cache instead of importing the RVT
	// pair in-process (no Bim2Visualize runs in this process — the crash-safe
	// path). manifest supplies the fixed model names used to resolve A/B
	// roles and the user-facing source paths that become the session
	// identity. Replaces any session already held by the adapter.
	//
	// Returns combined session metadata on success (importMs = cache read
	// time); a corrupt or non-conforming cache is reported as a failure,
	// never a crash. Does not bind the scene to a window. UI thread only.
	//
	virtual vb::Result<VisualizeSessionInfo> ImportRvtPairFromVsfx(
		const std::wstring& vsfxPath, const VisualizeSceneManifest& manifest) = 0;

	// Loads a worker-exported single-model .vsfx scene cache for self-clash
	// review. manifest.modelNameA identifies the model role and
	// manifest.sourceFileA becomes the session identity; manifest B fields are
	// ignored. Replaces any session already held by the adapter.
	//
	// Returns session metadata on success. Corrupt or non-conforming caches
	// are reported as failures, never crashes. UI thread only.
	//
	virtual vb::Result<VisualizeSessionInfo> ImportRvtSingleFromVsfx(
		const std::wstring& vsfxPath, const VisualizeSceneManifest& manifest) = 0;

	// Returns true while a two-RVT session imported by ImportRvtPair is held.
	// False for IFC sessions or when no session is active.
	//
	virtual bool HasRvtPairSession() const = 0;

	// Selects the two fixed Visualize model names that subsequent highlight
	// and zoom calls resolve against. This keeps equal native handles from
	// different federated sources isolated. Passing the same model name on
	// both sides configures an explicit self-clash pair.
	//
	virtual vb::Result<vb::Void> ConfigureClashModelPair(
		const std::wstring& modelNameA, const std::wstring& modelNameB) = 0;

	// Sets the clash isolation / dim display mode once across the scene:
	// mode: 0 = None (Standard), 1 = Dim Other (75% opacity/wire), 2 = Hide Other (Isolate)
	//
	virtual vb::Result<vb::Void> SetClashDisplayMode(int mode) = 0;

	// Highlights the clash pair identified by native RVT element handles:
	// append-model sessions map handleA to model A and handleB to model B;
	// single-model sessions map both handles to model A. Clears any previous
	// clash highlight first and redraws the bound device.
	//
	// Fails when no bound RVT clash-review session is active or neither handle maps to
	// a scene entity. Must be called on the UI thread.
	//
	virtual vb::Result<vb::Void> HighlightClashPair(
		std::uint64_t handleA, std::uint64_t handleB) = 0;

	// Highlights the clash pair:
	// highlight: true = highlight in red/green styles, false = plain rendering without highlight
	//
	virtual vb::Result<vb::Void> HighlightClashPairEx(
		std::uint64_t handleA, std::uint64_t handleB,
		bool highlight) = 0;

	// Highlights all clash pairs in a group:
	// Model A elements in Red, Model B elements in Green.
	virtual vb::Result<vb::Void> HighlightClashGroup(
		const std::vector<VisualizeClashPairTarget>& targets,
		bool highlight = true) = 0;

	// Removes the current clash highlight, if any, and redraws. Safe to call
	// when nothing is highlighted or no session is active. UI thread only.
	//
	virtual vb::Result<vb::Void> ClearClashHighlights() = 0;

	// Zooms the bound view to the union of the extents of all scene entities
	// mapped to the two native handles and redraws. Fails when no bound
	// RVT clash-review session is active or extents are unavailable. UI thread only.
	//
	virtual vb::Result<vb::Void> ZoomToClashPair(
		std::uint64_t handleA, std::uint64_t handleB) = 0;

	// Zooms the bound view to the union extents of all scene entities in a clash group.
	virtual vb::Result<vb::Void> ZoomToClashGroup(
		const std::vector<VisualizeClashPairTarget>& targets) = 0;

	// Captures a standardized 3D isometric viewpoint snapshot of the clash pair
	// using a dedicated offscreen bitmap device in RAM (independent of user UI view).
	// Returns Base64-encoded PNG string on success.
	//
	virtual vb::Result<std::string> CaptureClashSnapshotPngBase64(
		const std::wstring& sourceModelIdA, std::uint64_t handleA,
		const std::wstring& sourceModelIdB, std::uint64_t handleB,
		int widthPx, int heightPx) = 0;

	virtual vb::Result<VisualizeClashSnapshotResult> CaptureClashSnapshotWithCamera(
		const std::wstring& sourceModelIdA, std::uint64_t handleA,
		const std::wstring& sourceModelIdB, std::uint64_t handleB,
		int widthPx, int heightPx)
	{
		auto res = CaptureClashSnapshotPngBase64(sourceModelIdA, handleA, sourceModelIdB, handleB, widthPx, heightPx);
		if (!res.ok) return vb::Result<VisualizeClashSnapshotResult>::Err(res.error);
		VisualizeClashSnapshotResult out;
		out.base64Png = res.value;
		return vb::Result<VisualizeClashSnapshotResult>::Ok(std::move(out));
	}
};
