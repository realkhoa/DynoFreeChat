#pragma once

#include "shared/core/VbResult.h"

// Pan/orbit/zoom navigation for an IVisualizeSceneCapability session. Kept as
// a separate interface so IVisualizeSceneCapability (lifecycle/bind/render)
// stays single-concern. Implemented by the same adapter that implements
// IVisualizeSceneCapability — obtain a pointer through
// VisualizeSceneCapabilityFactory::GetNavigationInterface.
//
// Core contract only — no ODA (OdTv*) or MFC types cross this boundary.
//
class IVisualizeSceneNavigationCapability
{
public:
	virtual ~IVisualizeSceneNavigationCapability() = default;

	// Captures the pivot/reference state for a pan drag starting at client
	// pixel (x, y). Call once on drag start, before any UpdatePan calls.
	//
	virtual vb::Result<vb::Void> BeginPan(int x, int y) = 0;

	// Moves the camera so the world point under the drag start now tracks
	// the current mouse position (x, y), in client pixels. Call on every
	// mouse-move while the pan drag button is held.
	//
	virtual vb::Result<vb::Void> UpdatePan(int x, int y) = 0;

	// Captures the pivot/reference state for an orbit drag starting at
	// client pixel (x, y). Call once on drag start, before any UpdateOrbit
	// calls.
	//
	virtual vb::Result<vb::Void> BeginOrbit(int x, int y) = 0;

	// Orbits the camera based on mouse movement from the orbit drag start to
	// the current position (x, y), in client pixels. The pivot is fixed at
	// BeginOrbit: the center of the element selected through
	// IVisualizeSceneSelectionCapability, otherwise the view's extents center.
	// Call on every mouse-move while the orbit drag button is held.
	//
	virtual vb::Result<vb::Void> UpdateOrbit(int x, int y) = 0;

	// Zooms in/out centered on cursor client position (cursorClientX,
	// cursorClientY). wheelDelta follows WM_MOUSEWHEEL sign convention
	// (positive = zoom in, negative = zoom out).
	//
	virtual vb::Result<vb::Void> Zoom(int wheelDelta, int cursorClientX, int cursorClientY) = 0;

	// Forwards a mouse-move at client pixel (x, y) to the ViewCube overlay
	// hit-test. Returns true when the cube consumed it (e.g. highlighted a
	// face) — callers should skip further hover handling in that case.
	// Safe to call with no active session (returns Ok(false)).
	//
	virtual vb::Result<bool> HandleViewCubeHover(int x, int y) = 0;

	// Forwards a left-click at client pixel (x, y) to the ViewCube overlay
	// hit-test. Returns true when the cube consumed it — the camera has
	// already snapped to the clicked face/edge/corner; callers must NOT
	// start a pan/orbit drag in that case. Safe to call with no active
	// session (returns Ok(false)).
	//
	virtual vb::Result<bool> HandleViewCubeClick(int x, int y) = 0;

	// Shows/hides the ViewCube overlay. Independent of the WCS axis triad —
	// see SetWcsAxisVisible. Safe to call with no active session (no-op).
	//
	virtual vb::Result<vb::Void> SetViewCubeVisible(bool visible) = 0;

	// True when the ViewCube is currently shown (default true after a
	// successful BindToWindow). False with no active session.
	//
	virtual bool IsViewCubeVisible() const = 0;

	// Shows/hides the WCS axis triad ("UCS" in the UI — Visualize SDK has no
	// movable UCS, only this fixed world-axis indicator; see
	// OdaVisualizeSceneAdapter). Independent of the ViewCube — see
	// SetViewCubeVisible. Safe to call with no active session (no-op).
	//
	virtual vb::Result<vb::Void> SetWcsAxisVisible(bool visible) = 0;

	// True when the WCS axis triad is currently shown (default true after a
	// successful BindToWindow). False with no active session.
	//
	virtual bool IsWcsAxisVisible() const = 0;

	// Toggles wireframe-style review while retaining shaded-with-wireframe
	// rendering. The implementation changes layer/entity face transparency and
	// redraws the active view; returns an error when no view can be updated.
	//
	virtual vb::Result<vb::Void> SetWireframeMode(bool enabled) = 0;

	// Reports the internal wireframe-style state set by SetWireframeMode.
	//
	virtual bool IsWireframeMode() const = 0;
};
