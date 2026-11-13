#pragma once

#include "shared/core/VbResult.h"

// Movement axis for IWalkerCapability::Move. Forward/Backward/Left/Right
// move on the horizontal (world Z-up) plane along the camera's viewing/right
// direction projected flat — human-like walking, unaffected by the camera's
// current look-up/look-down pitch. Up/Down are free vertical elevation along
// world Z (fly), independent of the horizontal plane — not stair climbing;
// there is no floor support or collision in this free-navigation mode.
//
enum class WalkDirection
{
	Forward,
	Backward,
	Left,
	Right,
	Up,
	Down
};

// Focused capability for first-person walkthrough navigation of the active
// Visualize Review session, backed by OdTvCameraWalker (see
// docs/behavior/features/visualize-model-explode-and-walker.md for the
// product/behavior rationale, known SDK-assumption risks, and dismiss
// rules).
//
// Core contract only — no ODA (OdTv*) type crosses this boundary. Walk mode
// is mutually exclusive with Pan/Orbit: entering it assigns a dedicated
// camera entity to the session's view, which takes over the view's camera
// transform; ExitWalkMode() must be called before Pan/Orbit (or any other
// direct OdTvGsView camera manipulation) is used again. Every method must be
// called from the UI thread, and must not be called while an import worker
// owns the session (see the adapter's import-running gating).
//
class IWalkerCapability
{
public:
	virtual ~IWalkerCapability() = default;

	// Enters walk mode: creates (or reuses) a camera entity for the active
	// session's model, seeds its pose from the session's current view, and
	// assigns it to the view so the view starts following the camera.
	//
	// Returns an error, and does not enter walk mode, when no session is
	// active, the session already holds an assigned walk camera from a prior
	// failed exit, or any underlying OdTv* call fails.
	//
	virtual vb::Result<vb::Void> EnterWalkMode() = 0;

	// Suggested per-tick Move() distance, scaled to the active session's
	// model extents (a fixed absolute distance is meaningless across models
	// of wildly different scale/units — 0.5 "units" is imperceptible on a
	// model with a 27,000-unit extents diagonal but would be a huge jump on
	// a 10-unit one). Valid only while IsWalking() is true; returns 0.0
	// otherwise. Host queries this once after a successful EnterWalkMode()
	// and uses it as the per-timer-tick Move() distance instead of a
	// hardcoded constant.
	//
	virtual double SuggestedMoveDistance() const = 0;

	/** @brief Returns how many scene (camera WCS) units make one meter.
	 * @return Positive finite value only when the active model's units, units
	 * matrix and modeling matrix are all read successfully and both matrices are
	 * uniformly scaled; 0.0 when not walking or the scale cannot be verified.
	 * Callers then keep the extent-relative SuggestedMoveDistance() and must not
	 * present the speed as meters.
	 * @note UI thread only; read-only, no model writes or transaction.
	 */
	virtual double SceneUnitsPerMeter() const = 0;

	// Exits walk mode: unassigns the walk camera from the session's view,
	// leaving the view at the camera's last pose so Pan/Orbit resume from
	// there. Safe to call when not walking (no-op, returns Ok).
	//
	// On failure, the underlying camera may remain assigned to the view and
	// IsWalking() stays true. Callers must stop movement input, keep Pan/Orbit
	// blocked, and offer an explicit exit retry — never EnterWalkMode() again
	// while IsWalking() is true (it returns an error in that state).
	//
	virtual vb::Result<vb::Void> ExitWalkMode() = 0;

	// True when a walk camera is currently assigned to the active session's
	// view (walk mode entered and not yet successfully exited).
	//
	virtual bool IsWalking() const = 0;

	// Translates the walk camera by distance along the given direction (see
	// WalkDirection — horizontal-plane for Forward/Backward/Left/Right,
	// vertical for Up/Down). Returns an error when not walking or the
	// underlying move call fails.
	//
	/** @brief Moves one axis using the same world-Z-up basis as MoveAxes.
	 * @param direction Valid movement axis.
	 * @param distance Finite nonnegative distance in scene units.
	 * @return Checked camera/render outcome; failure may follow a pose change.
	 * @note UI thread only; transient scene camera, no native BIM writes/transaction.
	 */
	virtual vb::Result<vb::Void> Move(WalkDirection direction, double distance) = 0;

	/** @brief Applies a combined free-navigation displacement with one render update.
	 * @param forward Signed scene-unit displacement along the horizontal camera direction.
	 * @param right Signed scene-unit displacement along the horizontal right axis.
	 * @param up Signed scene-unit displacement along world Z, independent of pitch.
	 * @return Checked outcome; on failure stop input, since pose may already have changed.
	 * @note UI thread, active scene session only. No collision/grounding guarantee,
	 * native BIM writes, transactions or owning pointers cross this boundary.
	 */
	virtual vb::Result<vb::Void> MoveAxes(double forward, double right, double up) = 0;

	// Rotates the walk camera by yawDelta (radians, positive turns right)
	// around world Z and pitchDelta (radians, positive looks up), typically
	// driven by a mouse-look drag delta. Pitch is clamped to +/-85 degrees and
	// the camera never rolls (its right axis stays horizontal). Returns an
	// error when not walking or the camera pose cannot be read or applied.
	//
	virtual vb::Result<vb::Void> Turn(double yawDelta, double pitchDelta) = 0;
};
