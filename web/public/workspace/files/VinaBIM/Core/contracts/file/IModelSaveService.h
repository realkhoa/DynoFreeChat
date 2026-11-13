#pragma once

#include "shared/core/VbResult.h"

#include <string>

namespace vb {
namespace file {

/** @brief Engine-neutral model write mode selected by the Application policy. */
enum class ModelSaveMode
{
	/** Write a standalone merged model file. */
	Full,
	/** Append changed elements using the engine's incremental format. */
	Partial
};

/** @brief Engine-neutral result returned after the model has been written. */
struct ModelSaveServiceOutcome
{
	/** File version produced by the engine. */
	int savedFileVersion = 0;
};

/**
 * @brief Engine-neutral capability for writing the attached BIM model.
 *
 * Implementations own the engine/database binding. The caller selects partial
 * or full mode before crossing this boundary.
 */
class IModelSaveService
{
public:
	/** @brief Destroys the engine-neutral save capability interface. */
	virtual ~IModelSaveService() = default;

	/**
	 * @brief Writes the attached model using the requested ODA-neutral save mode.
	 *
	 * A successful result reports the engine-produced file version. An error may
	 * be returned after the target has been written when required post-write
	 * finalization fails. Callers must report the error, keep the in-memory
	 * document unsaved/unfinalized, and must not assume the target was not created.
	 * Implementations reject an empty path and log engine or validation failures
	 * before returning Err.
	 * @param path Target file path.
	 * @param mode Full or partial write mode selected by the Application policy.
	 * @return Saved file metadata on success, or a logged failure.
	 */
	virtual vb::Result<ModelSaveServiceOutcome> Save(
		const std::wstring& path,
		ModelSaveMode mode) = 0;
};

} // namespace file
} // namespace vb
