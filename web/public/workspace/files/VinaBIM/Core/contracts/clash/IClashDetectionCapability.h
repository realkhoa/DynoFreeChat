#pragma once

#include "shared/core/VbResult.h"
#include "Core/contracts/clash/FederatedClashModels.h"
#include <cstdint>
#include <string>
#include <vector>

// Focused capability for running clash (interference) detection between one
// RVT file (self-collision) or two RVT files (pair collision) inside an ODA
// Visualize scene, without spawning the external ClashDetectionTool.exe
// process. Element handles are the native RVT element handles produced by the
// clash engine, carried as neutral std::uint64_t. Core contract only — no ODA
// (OdTv*/Od*) or MFC types cross this boundary.
//
struct ClashDetectionParams
{
	std::wstring filePathA;
	std::wstring filePathB;      // empty => self-collision on filePathA alone
	int engineCollisionType = 1; // 0 = Intersection ("Hard"), 1 = Clearance
	int collisionLevel = 0;      // 0..3 (entity/nested entity/geometry/sub-geometry)
	double tolerance = 0.0;
	bool calculateDistance = true;
};

struct ClashPairRow
{
	std::uint64_t nativeHandleA = 0;
	std::uint64_t nativeHandleB = 0;
	double distance = 0.0;
	std::wstring sourceModelIdA;
	std::wstring sourceModelIdB;
};

struct ClashDetectionResult
{
	std::vector<ClashPairRow> rows;
	double importMs = 0.0;
	double collideMs = 0.0;
};

class IClashDetectionCapability
{
public:
	virtual ~IClashDetectionCapability() = default;

	// Self-contained: imports filePathA (+ filePathB if non-empty) into THIS
	// adapter's session (replacing any prior session, same replace-semantics
	// as IVisualizeReviewCapability::ImportRvtPair/ImportIfcFile) and runs
	// collide(). Equivalent to today's one-shot external-tool call. UI thread
	// only.
	//
	virtual vb::Result<ClashDetectionResult> RunClash(const ClashDetectionParams& params) = 0;

	// True when the adapter already holds an imported session matching these
	// exact file paths (case-insensitive), usable to skip a redundant import.
	//
	virtual bool CanReuseSessionFor(
		const std::wstring& filePathA, const std::wstring& filePathB) const = 0;

	// Runs collide() against whatever model(s) are already imported in this
	// adapter's current session (no import). Caller must have verified
	// CanReuseSessionFor first. UI thread only.
	//
	virtual vb::Result<ClashDetectionResult> RunClashOnCurrentSession(
		const ClashDetectionParams& engineOptionsOnly) = 0;
};

// Segregated interface for multi-model federated clash detection. Keeps the
// legacy 2-file RVT adapter contract intact while allowing multi-model
// worker jobs to execute independently.
class IFederatedClashDetectionCapability
{
public:
  virtual ~IFederatedClashDetectionCapability() = default;

  virtual vb::Result<std::vector<FederatedClashPair>> RunFederatedDetection(
    const FederatedClashRequest& request) = 0;
};
