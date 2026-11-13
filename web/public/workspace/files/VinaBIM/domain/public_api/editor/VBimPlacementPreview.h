#pragma once

#include "../VinaBIMApiExport.h"

#include "Base/BmObjectId.h"
#include "Ge/GeMatrix3d.h"
#include "Ge/GePoint3d.h"
#include "OdResult.h"

class OdBmDatabase;
class OdGiWorldDraw;
class OdGiViewportDraw;

// Placement preview helpers for plugin creation commands (column, footing, MEP
// equipment, pipe, rebar...). The plugin owns its drawable and its point
// tracker; these functions only draw the Host's preview graphics into it, so
// a plugin preview looks like the Host Component / Move commands. No function
// here reads or writes the database except vbimCreateSymbolGhost (read only).

// Handle of a symbol ghost built by vbimCreateSymbolGhost(); 0 is invalid.
typedef unsigned long long VBimSymbolGhostId;

// Builds the preview geometry of a family symbol: its fine contours, or its
// outline box when the geometry is not supported. Uses the same read-only,
// native-fault-guarded extraction as the Host Component command.
//
// Returns eOk and a new ghost id; eInvalidInput when symbolId is not an
// OdBmFamilySymbol of the active document; eNotApplicable when the symbol has
// neither geometry nor bounds, or the extraction faulted. pBoundsOnly (optional)
// reports that only the outline box is available.
//
// The ghost belongs to the running command: the Host releases it when the
// outermost command ends (normally, on ESC or on error). UI thread only; call
// outside an open transaction.
VINABIM_API OdResult vbimCreateSymbolGhost(const OdBmObjectId& symbolId, VBimSymbolGhostId& ghost,
    bool* pBoundsOnly = nullptr);

// Draws the ghost under placement (symbol space -> world, e.g. translation to the
// cursor times rotation) in the theme preview colour. Call from the plugin
// drawable's subWorldDraw(). No database access; no-op for 0, unknown or
// released ids and for a null context.
VINABIM_API void vbimDrawSymbolGhost(VBimSymbolGhostId ghost, OdGiWorldDraw* pWd, const OdGeMatrix3d& placement);

// Returns the world extents of the ghost under placement, e.g. to publish them
// with vbimSetVbimSnapScopePreviewBounds() so Temporary Dimension labels avoid
// the ghost. Returns false (outputs untouched) for an unknown or released id.
VINABIM_API bool vbimSymbolGhostExtents(VBimSymbolGhostId ghost, const OdGeMatrix3d& placement,
    OdGePoint3d& minimum, OdGePoint3d& maximum);

// Releases a ghost before the command ends. Safe for 0, unknown or already
// released ids. UI thread only.
VINABIM_API void vbimReleaseSymbolGhost(VBimSymbolGhostId ghost);

// Draws the Host listening dimension of the segment start -> end, as the Move
// command does: the segment, the length dimension offset to its left (formatted
// in pDb's project units; millimetres when pDb is null) and the angle arc to the
// X axis at start. Theme accent colour, constant pixel size. Call from the plugin
// drawable's subViewportDraw(); combine with
// vbimSetVbimSnapScopeTemporaryDimensionsSuppressed(true) to replace the Host
// Temporary Dimensions. No database writes; no-op for a null context or a
// zero-length segment.
VINABIM_API void vbimDrawListeningDimension(OdGiViewportDraw* pVd, const OdGePoint3d& start,
    const OdGePoint3d& end, OdBmDatabase* pDb);
