#pragma once

#include "shared/core/VbResult.h"
#include <cstdint>
#include <string>

// Result of a successful IVisualizeSceneCapability::OpenFile call. ODA-free;
// filled directly from Infrastructure/Oda/VisualizeScene.
//
struct VisualizeSceneInfo
{
	std::wstring fileName;
	std::uint64_t objectsSizeBytes = 0;
};

// Focused capability for one Document-View `.vsfx` viewer instance:
// lifecycle (open/bind/resize/render/activate/release) only — see
// IVisualizeSceneNavigationCapability for pan/orbit/zoom, kept in a separate
// interface so this one stays single-concern.
//
// One instance per open document: a new instance is created for every
// CVisualizeSceneDoc, so multiple `.vsfx` files can be viewed at once in
// separate MDI child windows.
//
// Core contract only — no ODA (OdTv*) or MFC types cross this boundary.
//
class IVisualizeSceneCapability
{
public:
	virtual ~IVisualizeSceneCapability() = default;

	// Reads the .vsfx file at filePath (SEH-guarded in the Infrastructure
	// adapter — a corrupt/truncated cache file must not crash the process)
	// into a new scene, replacing any session already held by this
	// capability. Selects the file's first Visualize device and, when the
	// database holds exactly one model, resolves it for capabilities that
	// need a single-model layout (e.g. Explode/Walk); an arbitrary `.vsfx`
	// file is not assumed to follow any particular model-naming convention.
	// Views and their model attachments come from the .vsfx file itself, as
	// deserialized by readVSFX — OpenFile does not add models to any view.
	//
	// Returns session metadata on success, or an error message on failure.
	// Does not bind the scene to a window.
	//
	virtual vb::Result<VisualizeSceneInfo> OpenFile(const std::wstring& filePath) = 0;

	// Binds the current session's Visualize device to a native window and
	// sizes it to widthPx x heightPx. hwndHandle is an HWND value carried as
	// an opaque uint64_t handle (Core stays ODA/Windows-type-free). Selects
	// which of the device's deserialized views to bind — the active view if
	// it already has a model attached, otherwise the first view found that
	// does — since a .vsfx-restored device can have an active view with no
	// models even when another view on it does.
	//
	// Must be called after a successful OpenFile. Returns an error when no
	// session is active.
	//
	virtual vb::Result<vb::Void> BindToWindow(std::uint64_t hwndHandle, int widthPx, int heightPx) = 0;

	// Resizes the bound Visualize device to widthPx x heightPx. No-op
	// (returns Ok) when no session is active. Does not itself trigger a
	// redraw — call Render() afterward.
	//
	virtual vb::Result<vb::Void> Resize(int widthPx, int heightPx) = 0;

	// Requests a redraw of the bound device (invalidate() then update()).
	// No-op when no session is active or no window is bound.
	//
	virtual vb::Result<vb::Void> Render() = 0;

	// Marks the bound device active/inactive, mirroring MDI child
	// activate/deactivate. No-op when no session is active.
	//
	virtual vb::Result<vb::Void> SetActive(bool active) = 0;

	// Releases the current Visualize session (device and scene database).
	// Safe to call when no session is active, and safe to call more than
	// once (idempotent) — both the owning View (on window destroy) and the
	// owning Document (as a defensive fallback) call this.
	//
	virtual vb::Result<vb::Void> ReleaseSession() = 0;
};
