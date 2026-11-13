#pragma once

#include "shared/core/VbResult.h"

// Click selection of one element in a Visualize scene session, used as the orbit
// pivot (docs/behavior/features/ifc-visualize-navisworks-ribbon.md §6). Implemented
// by the same adapter as IVisualizeSceneCapability — obtain a pointer through
// VisualizeSceneCapabilityFactory::GetSelectionInterface.
//
// An element is a model-level insert (family instance) or the outermost sub-entity of
// a model-level container entity (e.g. one wall inside a "LEVEL n" entity), never the
// whole container. The selection only changes the view highlight; no model or scene
// geometry is written. While an element is selected, IVisualizeSceneNavigationCapability
// orbits around the center of its world bounds.
//
// Core contract only — no ODA (OdTv*) or MFC types cross this boundary. UI thread only.
//
class IVisualizeSceneSelectionCapability
{
public:
	virtual ~IVisualizeSceneSelectionCapability() = default;

	/** @brief Selects the element under client pixel (x, y) and highlights it, replacing
	 * the previous selection.
	 * @return Ok(true) when an element is now selected; Ok(false) when nothing was hit
	 * (the previous selection is cleared); Err when no session is bound or the SDK fails
	 * (the previous selection is cleared as well).
	 * @note Does not touch clash-review highlights.
	 */
	virtual vb::Result<bool> SelectAt(int x, int y) = 0;

	/** @brief Removes the highlight and forgets the selection. Idempotent; never fails. */
	virtual void ClearSelection() = 0;

	/** @brief True while an element is selected. */
	virtual bool HasSelection() const = 0;
};
