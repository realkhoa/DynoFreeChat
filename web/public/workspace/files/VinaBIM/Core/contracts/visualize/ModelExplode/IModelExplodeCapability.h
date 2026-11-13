#pragma once

#include "shared/core/VbResult.h"
#include <cstdint>

// Focused capability for radially exploding the top-level entities of the
// single BIM/IFC model currently loaded in the active Visualize Review
// session (see docs/behavior/features/visualize-model-explode-and-walker.md
// for the product/behavior rationale and known limitations).
//
// Core contract only — no ODA (OdTv*) type crosses this boundary. Backed by
// OdTvModelExplode, which operates on exactly one Visualize model: this
// capability is only available when the session holds a single model (an
// imported IFC file or a single-RVT clash session), not a two-model RVT-pair
// session — see IsAvailable().
//
class IModelExplodeCapability
{
public:
	virtual ~IModelExplodeCapability() = default;

	// Sets the fraction of each entity's origin-to-center vector length used
	// as its explode displacement per step (SDK default 0.05 = 5%).
	//
	// Takes effect on the next Explode() call. Returns an error when no
	// session is active.
	//
	virtual vb::Result<vb::Void> SetLengthCoef(double coef) = 0;

	// Displaces every top-level entity of the active session's model radially
	// away from the model's extents center by step * lengthCoef * (distance
	// from center to that entity). step = 0 collapses the model back to its
	// original, un-exploded layout.
	//
	// Returns an error when no session is active or IsAvailable() is false
	// (e.g. a two-model RVT-pair session).
	//
	virtual vb::Result<vb::Void> Explode(std::uint32_t step) = 0;

	// True when the active session holds exactly one model, the only layout
	// OdTvModelExplode supports. False with no session, an unbound session,
	// or a two-model RVT-pair session.
	//
	virtual bool IsAvailable() const = 0;
};
