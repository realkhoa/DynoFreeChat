#pragma once

#include "shared/core/VbResult.h"
#include <cstdint>
#include <string>

// Result of a successful external-file import (IFC or Navisworks) into a
// Visualize scene. All fields are ODA-free; filled by Infrastructure
// adapters from ODA Visualize session metadata.
//
struct VisualizeSessionInfo
{
	std::wstring fileName;
	double importMs = 0.0;
	std::uint64_t objectsSizeBytes = 0;
};

// Focused capability for viewing one external file (IFC or Navisworks)
// through the ODA Visualize SDK, independent of any VinaBIM
// document/database. Only one session is held at a time; ImportIfcFile,
// ImportNwFile, and LoadSceneFromVsfx each replace any prior session.
//
// Core contract only — no ODA (OdTv*) or MFC types cross this boundary. See
// docs/behavior/features/view-external-ifc-file.md for the product/behavior
// rationale.
//
class IVisualizeReviewCapability
{
public:
	virtual ~IVisualizeReviewCapability() = default;

	// Imports the IFC file at filePath into a new Visualize scene, replacing
	// any session already held by this capability.
	//
	// Returns session metadata (import time, scene size) on success, or an
	// error message on failure. Does not bind the scene to a window.
	//
	virtual vb::Result<VisualizeSessionInfo> ImportIfcFile(const std::wstring& filePath) = 0;

	// Imports the Navisworks file (.nwd/.nwc) at filePath into a new
	// Visualize scene, replacing any session already held by this capability.
	//
	// Returns session metadata (import time, scene size) on success, or an
	// error message on failure. Does not bind the scene to a window.
	//
	virtual vb::Result<VisualizeSessionInfo> ImportNwFile(const std::wstring& filePath) = 0;

	// Binds the current session's Visualize device to a native window and
	// sizes it to widthPx x heightPx. hwndHandle is an HWND value carried as
	// an opaque uint64_t handle (Core stays ODA/Windows-type-free).
	//
	// Must be called after a successful ImportIfcFile, ImportNwFile, or
	// LoadSceneFromVsfx. Returns an error when no session is active.
	//
	virtual vb::Result<vb::Void> BindToWindow(std::uint64_t hwndHandle, int widthPx, int heightPx) = 0;

	// Resizes the bound Visualize device to widthPx x heightPx and requests a
	// redraw. No-op (returns Ok) when no session is active.
	//
	virtual vb::Result<vb::Void> Resize(int widthPx, int heightPx) = 0;

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

	// Orbits the camera around the view's extents center based on mouse
	// movement from the orbit drag start to the current position (x, y), in
	// client pixels. Call on every mouse-move while the orbit drag button is
	// held.
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

	// Loads a worker-produced .vsfx scene cache (from either an IFC or a
	// Navisworks source file — the worker already ran Ifc2Visualize/
	// Nw2Visualize in isolation, so this call is format-agnostic) into this
	// session via readVSFX. vsfxPath is the path of the scene.vsfx file;
	// modelNameA is the fixed model name written by the worker
	// (VisualizeImportJobEngine::ModelNameA()); sourceFilePath is the
	// user-facing file identity echoed back as session info.
	//
	// Replaces any session already held. Does not bind the scene to a window;
	// call BindToWindow after a successful return.
	//
	virtual vb::Result<VisualizeSessionInfo> LoadSceneFromVsfx(
		const std::wstring& vsfxPath,
		const std::wstring& modelNameA,
		const std::wstring& sourceFilePath) = 0;

	// Releases the current Visualize session (device and scene database).
	// Safe to call when no session is active. Must be called before the
	// owning window is destroyed.
	//
	virtual vb::Result<vb::Void> ReleaseSession() = 0;
};
