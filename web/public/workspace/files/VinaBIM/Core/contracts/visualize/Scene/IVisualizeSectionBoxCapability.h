#pragma once

#include "shared/core/VbResult.h"
#include <cstdint>

/** @brief Engine-neutral world extents used to initialize a Visualize Section Box. */
struct VisualizeExtents3d
{
	double minPt[3];
	double maxPt[3];
};

/** @brief Controls the session-only Section Box overlay and clipping in a Visualize view. */
class IVisualizeSectionBoxCapability
{
public:
	/** @brief Releases the capability without transferring ownership of its scene. */
	virtual ~IVisualizeSectionBoxCapability() = default;

	/** @brief Enables six cutting planes initialized from the supplied extents. */
	virtual vb::Result<vb::Void> EnableSectionBox(const VisualizeExtents3d& extents) = 0;
	/** @brief Removes cutting planes and all Section Box overlay geometry. */
	virtual vb::Result<vb::Void> DisableSectionBox() = 0;
	/** @brief Shows or hides interactive grips while retaining the passive wireframe. */
	virtual vb::Result<vb::Void> SetGizmoSelected(bool selected) = 0;
	/** @brief Tests projected wireframe edges without consuming clicks inside box faces. */
	virtual vb::Result<vb::Void> HitTestBoxEdge(int x, int y, bool& outHit) = 0;
	/** @brief Tests visible face and rotate grips and prepares a drag snapshot on hit. */
	virtual vb::Result<vb::Void> HitTestGrip(int x, int y, bool& outHit) = 0;
	/** @brief Applies one client-pixel drag delta to the active preview geometry. */
	virtual vb::Result<vb::Void> UpdateDrag(int dx, int dy) = 0;
	/** @brief Commits the current preview bounds to the in-memory Visualize session. */
	virtual vb::Result<vb::Void> CommitDrag() = 0;
	/** @brief Restores the complete bounds snapshot captured before the active drag. */
	virtual vb::Result<vb::Void> CancelDrag() = 0;
};
