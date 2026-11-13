// VBimPaneState.h
//
// Docking state of an SDK dockable pane, read and written through
// VBimDockablePaneRegistry::GetState() / SetState(). Analogous to Revit's
// DockablePaneState, reduced to what the MFC docking shell supports.
//
#pragma once

#include "OdString.h"

// Frame edge a docked pane is attached to.
//
enum class VBimDockSide
{
    Left,
    Right,
    Top,
    Bottom
};

// Docking state of one pane. The Host owns the window; this is a copy.
//
struct VBimPaneState
{
    OdString     title;             // Caption of the pane.
    VBimDockSide side = VBimDockSide::Right;  // Edge used when docked (last edge while floating).
    bool         floating = false;  // True when the pane floats in its own window.
};
