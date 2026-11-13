#pragma once

#include "shared/core/VbResult.h"

#include <cstddef>
#include <functional>

// Outcome of IGroundedWalkCapability::EnterGrounded. Every value except Entered
// is a deliberate refusal (grounded mode stays off, free Walk continues); the
// Host maps each to a localized message.
//
enum class GroundedEntryStatus
{
	Entered,
	UnitsUnverified,      // scene units cannot be converted to meters
	GeometryUnsupported,  // geometry that cannot be checked for collision exists (fail-closed)
	GeometryTooLarge,     // triangle/grid/memory budget exceeded
	GeometryMismatch,     // sampled engine ray trace disagrees with the copied geometry
	NotAtEyeHeight,       // no walkable floor below the camera (missing or too steep)
	SpawnBlocked,         // the body does not fit at the spawn point
	SpawnInsideSolid,     // camera or body inside a closed solid
	SpawnAmbiguous,       // inside a volume-like open shell; safety cannot be decided
	DisplayConflict       // Section Box or Explode active
};

/** @brief Details of an EnterGrounded attempt (counts for the message and diagnostics). */
struct GroundedEntryResult
{
	GroundedEntryStatus status = GroundedEntryStatus::GeometryUnsupported;
	std::size_t triangles = 0;
	std::size_t unsupportedItems = 0;
	std::size_t skippedDegenerate = 0;
};

// Receives EnterGrounded progress in percent (0-100), synchronously on the UI thread
// between entry stages. May be empty. Must not re-enter the capability.
//
using GroundedEntryProgress = std::function<void(int percent)>;

// Outcome of one IGroundedWalkCapability::StepGrounded call.
//
enum class GroundedStepStatus
{
	Moved,        // camera moved to the accepted position
	Blocked,      // body would collide or the step is too high; camera unchanged
	NoSupport,    // no admissible floor ahead; camera unchanged
	SceneChanged  // displayed scene changed since entry; grounded mode was exited
};

// Outcome of IGroundedWalkCapability::TogglePassThroughAhead.
//
enum class GroundedPassThroughResult
{
	NothingAhead,    // no object within reach along the view direction; nothing changed
	PassThroughOn,   // the object ahead (and parts inside its bounds) no longer collides
	PassThroughOff   // the object ahead collides again
};

// Focused capability for grounded (body + floor) navigation on top of an
// active walk camera (IWalkerCapability). Engine-neutral: no SDK or MFC types.
//
// Grounded mode copies the scene geometry once at entry and moves the walk
// camera only to positions accepted by the engine-free controller in
// Core/walk. It never writes the BIM model. All methods are UI-thread only.
// Collision safety is limited to the documented controller and geometry policy
// (plan §7/§8); open geometry and footprint sampling have known limits.
//
class IGroundedWalkCapability
{
public:
	virtual ~IGroundedWalkCapability() = default;

	/** @brief Builds the collision snapshot and places the body below the current camera eye.
	 * @return Ok(Entered) when grounded mode is now active and the camera eye was
	 * moved vertically to feet + eye height; Ok(other status) for a deliberate
	 * refusal (state unchanged); Err only for an SDK/camera failure.
	 * @param progress Optional stage progress (see GroundedEntryProgress); entry takes
	 * seconds on large models.
	 * @note Requires an active walk camera. UI thread; reads the scene, no BIM writes.
	 */
	virtual vb::Result<GroundedEntryResult> EnterGrounded(const GroundedEntryProgress& progress) = 0;

	/** @brief Leaves grounded mode and frees the snapshot; the camera stays where it is.
	 * @note Idempotent, UI thread, never fails.
	 */
	virtual void ExitGrounded() = 0;

	/** @brief True while grounded mode is active. */
	virtual bool IsGrounded() const = 0;

	/** @brief Moves the body by a horizontal intent relative to the camera heading.
	 * @param forwardMeters Signed distance along the horizontal view direction.
	 * @param rightMeters Signed distance along the horizontal right axis.
	 * @return Ok(status) as described by GroundedStepStatus; Err for an SDK/camera
	 * failure (the camera may have partially moved; callers stop input).
	 * @note UI thread; transient scene camera only, no BIM writes.
	 */
	virtual vb::Result<GroundedStepStatus> StepGrounded(double forwardMeters, double rightMeters) = 0;

	/** @brief Jumps or climbs forward along the horizontal view direction (Space).
	 * @return Ok(Moved) at the farthest admissible landing within reach (up to 0.70 m
	 * higher or 1.20 m lower); Ok(Blocked/NoSupport) with the camera unchanged;
	 * Ok(SceneChanged) after exiting grounded mode; Err for an SDK/camera failure.
	 * @note No free fall: the move is one checked step. UI thread, no BIM writes.
	 */
	virtual vb::Result<GroundedStepStatus> JumpGrounded() = 0;

	/** @brief Crouches (lower body and eye) or tries to stand up again (hold C).
	 * @return Ok(true) when crouched after the call, Ok(false) when standing. Standing up
	 * is refused (stays crouched) while there is no headroom; callers retry later.
	 * After the displayed scene changed, the stance is left unchanged and the next
	 * StepGrounded/JumpGrounded reports SceneChanged.
	 * @note Moves the camera vertically by the eye-height difference. UI thread.
	 */
	virtual vb::Result<bool> SetGroundedCrouch(bool crouch) = 0;

	/** @brief Toggles collision of the object straight ahead of the camera within 3 m (F).
	 * @return Ok(result) as described by GroundedPassThroughResult; Err for a camera failure.
	 * @note Only this grounded session's collision copy changes; the displayed scene and
	 * the BIM model are untouched. Reset when grounded mode ends. UI thread.
	 */
	virtual vb::Result<GroundedPassThroughResult> TogglePassThroughAhead() = 0;
};
