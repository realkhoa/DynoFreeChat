#pragma once

#include "Infrastructure/Oda/sdk_includes/odBm.h"

/** View / document regeneration (Host-owned device + document). */
class IRegenService
{
public:
	virtual ~IRegenService() = default;

	virtual void regenActiveView() = 0;
	virtual void regenAllModel() = 0;
	virtual void regenAll() = 0;
	virtual void regenVisible() = 0;

	// Cleans the DB view element cache and invalidates the GS model with
	// kInvalidateAll, so geometry that the model has never seen is loaded on the
	// next update. Required after committing a NEW element: regenVisible() only
	// invalidates drawables the model already knows about, so a freshly created
	// element stays invisible until a full regen. Suppresses the Regen wait
	// cursor and repaints directly instead of posting WM_PAINT.
	virtual void refreshAfterModelChange() = 0;

	// Marks the active viewport dirty without a full regen. Reads the drawing
	// ID from the Host rendering device — immune to the ODA side-effect where
	// a rollback-only dim-probe switches pDb->getActiveDBDrawingId() to the
	// probe's Drafting view. Prefer over regenActiveView() after lightweight
	// geometry commits (e.g., a placed dimension string).
	virtual void invalidateActiveView(OdBmDatabase* pDb) = 0;

	// Returns the active drawing ID from the Host rendering device, NOT from
	// OdBmDatabase::getActiveDBDrawingId(). The database pointer is corrupted
	// by rollback-only probe transactions (addElement + set + rollback on
	// OdBmLinearDimString). Returns OdBmObjectId::kNull when no device is up.
	virtual OdBmObjectId getStableActiveDrawingId() = 0;

	// Restores the active drawing to drawingId via ActivateLayoutUseCase.
	// Idempotent: no-op if drawingId is null or already active.
	// Do NOT call inside an open ODA transaction.
	virtual void restoreActiveDrawing(OdBmDatabase* pDb,
	                                   const OdBmObjectId& drawingId) = 0;
};
