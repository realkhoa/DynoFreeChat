// VBimDockablePaneBridge.h
//
// Internal — NOT part of the public SDK surface.
// Host files include this header to create and manage SDK dockable panes.
// No MFC types appear in this header — HWND is forward-declared via vbedvds.h.
//
#pragma once

#include "domain/vinaBIMCore/vbedvds.h"    // OdString
#include "domain/public_api/ui/VBimDockablePaneRegistry.h"  // descriptor + provider types

// Internal bridge between VBimDockablePaneRegistry and the MFC docking framework.
//
// Pane shells (CVinaBIMDockablePaneExt) are created lazily on the first ShowPane()
// call. This avoids modifications to CMainFrame::CreateDockingWindows() in Phase 1.
//
// VBimDockablePaneDescriptor::defaultDockSide values "Left", "Right", "Top",
// "Bottom" and "Float" are all handled. Unrecognised values fall back to "Right".
//
// The pane ID pool is 0xD000–0xDFFF (4096 entries). RegisterPane beyond that limit
// logs and returns false.
//
// All methods must be called from the UI thread.
// CMainFrame must have a valid HWND before pane creation is attempted.
//
class VBimDockablePaneBridge
{
public:
    // Stores a registration entry. Pane window is NOT created here.
    // Returns false if id is empty, provider is null, id is already registered,
    // or the pane ID pool (0xD000–0xDFFF) is exhausted. Logs each failure path.
    static bool RegisterPane(
        const VBimDockablePaneDescriptor& descriptor,
        IVBimDockablePaneProvider*        provider);

    // Shows (and lazily creates) the pane for the given id. On first call,
    // creates the CVinaBIMDockablePaneExt shell, docks it, and calls
    // IVBimDockablePaneProvider::CreateNativeWindow. If content window
    // creation fails, the shell is destroyed and false is returned.
    // Returns false if not registered or any creation step fails.
    static bool ShowPane(const OdString& id);

    // Hides the pane for the given id.
    // Returns false if not registered or not yet created.
    static bool HidePane(const OdString& id);

    // Returns true when the pane is visible (created and not hidden).
    // Returns false when not registered, not yet created, or hidden.
    static bool IsPaneVisible(const OdString& id);

    // Returns true if the id has been registered via RegisterPane(),
    // regardless of whether the pane window has been created yet.
    static bool IsPaneRegistered(const OdString& id);

    // Reads title / side / floating from the live shell, or from the stored
    // descriptor before the shell exists. Returns eOk or eInvalidInput.
    static OdResult GetState(const OdString& id, VBimPaneState& state);

    // Writes the state to the live shell (SetWindowText, DockPane, FloatPane)
    // and to the stored descriptor used for lazy creation. Returns eOk,
    // eInvalidInput (unknown id / empty title) or eNotApplicable (MFC refused).
    static OdResult SetState(const OdString& id, const VBimPaneState& state);

    // Removes the pane from its tab group or dock site, destroys the shell (and
    // with it the provider's child content window), deletes the shell object and
    // forgets the id. Returns eOk, or eInvalidInput for an unknown id.
    static OdResult UnregisterPane(const OdString& id);

    // Creates both panes if needed (built-in targets "VinaBIM.Properties" and
    // "VinaBIM.ProjectBrowser" always exist) and docks id as a tab of targetId
    // with CDockablePane::AttachToTabWnd. Returns eOk, eInvalidInput for an
    // unknown / identical id, or eNotApplicable when creation or MFC failed.
    static OdResult AttachToTab(const OdString& id, const OdString& targetId);
};
