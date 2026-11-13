#pragma once

#include "Core/contracts/clash/Workspace/ClashWorkspaceModels.h"
#include "shared/core/VbResult.h"

/**
 * @class IClashWorkspacePackageRepository
 * @brief Repository contract for serializing and deserializing Clash Workspace packages (.zip).
 */
class IClashWorkspacePackageRepository
{
public:
	virtual ~IClashWorkspacePackageRepository() = default;

	/**
	 * @brief Writes a complete .zip package through a temporary sibling file and
	 * replaces targetPath only after every payload has been flushed. scenePath
	 * is streamed and is never loaded fully into process memory.
	 *
	 * @param targetPath Destination path of the .zip clash workspace package.
	 * @param scenePath Path to the local federated .vsfx scene stream to package.
	 * @param manifest Authoritative workspace manifest metadata.
	 * @param selectionCatalog Visual selection tree catalog nodes.
	 * @param results Detected clash collision records.
	 * @return Success or error result with explanation.
	 */
	virtual vb::Result<vb::Void> Save(
		const std::wstring& targetPath,
		const std::wstring& scenePath,
		const ClashWorkspaceManifest& manifest,
		const std::vector<ClashWorkspaceSelectionNode>& selectionCatalog,
		const std::vector<ClashWorkspaceResultRow>& results) = 0;

	/**
	 * @brief Validates and extracts a .zip (or legacy .vbclash) package into stagingDirectory.
	 * Hash or schema mismatch rejects the complete package and leaves no usable result.
	 *
	 * @param packagePath Path to the workspace package to open.
	 * @param stagingDirectory Directory to extract the staging scene to.
	 * @return Extracted workspace package or error result.
	 */
	virtual vb::Result<ClashWorkspacePackage> Open(
		const std::wstring& packagePath,
		const std::wstring& stagingDirectory) = 0;
};
