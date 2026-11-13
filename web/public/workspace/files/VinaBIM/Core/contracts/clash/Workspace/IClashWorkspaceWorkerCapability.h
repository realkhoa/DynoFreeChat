#pragma once

#include "Core/contracts/clash/Workspace/ClashWorkspaceModels.h"
#include "Core/contracts/visualize/IVisualizeExportCapability.h"
#include "shared/core/VbResult.h"

#include <memory>

struct ClashWorkspaceWorkerSceneResult
{
	std::wstring scenePath;
	ClashWorkspaceManifest manifest;
	std::vector<ClashWorkspaceSelectionNode> selectionCatalog;
	std::vector<ClashWorkspaceResultRow> rows;
	long long pairCount = 0;
	// Owns the worker job directory containing scenePath. Callers must retain
	// this handle while reading or packaging scenePath; releasing the last
	// reference may delete the directory and invalidate that path.
	std::shared_ptr<void> artifactLifetime;
};

class IClashWorkspaceWorkerCapability
{
public:
	virtual ~IClashWorkspaceWorkerCapability() = default;

	// Creates or incrementally updates a federated scene. When existingScenePath
	// is non-empty, models already present by sourceModelId are reused and only
	// missing models are imported. Collision is never run by this operation.
	virtual vb::Result<ClashWorkspaceWorkerSceneResult> BuildScene(
		const ClashWorkspaceManifest& manifest,
		const std::wstring& existingScenePath,
		const ProgressCancelCallbacks& callbacks) = 0;

	// Runs ODA collision from an existing VSFX scene in the isolated worker.
	// Source files are not imported and the input scene is not modified.
	virtual vb::Result<ClashWorkspaceWorkerSceneResult> RunSceneClash(
		const ClashWorkspaceManifest& manifest,
		const std::wstring& scenePath,
		const ProgressCancelCallbacks& callbacks) = 0;
};
