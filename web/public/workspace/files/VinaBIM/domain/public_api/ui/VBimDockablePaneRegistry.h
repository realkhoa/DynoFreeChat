// VBimDockablePaneRegistry.h
//
// Dockable pane registry facade for VinaBIM SDK developers.
//
// Provides public declarations for plugin-owned dockable panes without
// exposing MFC CWnd, CDockablePane, or CMainFrame types.
//
// Obtain via VBimUIApplication::DockablePaneRegistry() — deferred to
// a later prompt when VBimUIApplication::DockablePaneRegistry() is added.
//
// Threading: All methods must be called from the UI thread.
// RegisterPane() must be called before the main frame is fully shown
// (on startup, from a module init function). Runtime registration is
// not guaranteed to work after CMainFrame::CreateDockingWindows().
//
#pragma once

#include "../VinaBIMApiExport.h"

#include "OdResult.h"
#include "OdString.h"
#include "DockablePaneState/VBimPaneState.h"

// ─────────────────────────────────────────────
// VBimDockablePaneDescriptor
// ─────────────────────────────────────────────

// Registration metadata for a SDK-owned dockable pane.
//
// Contains public properties only — no MFC resource IDs,
// no HWND, no CWnd pointers.
//
struct VBimDockablePaneDescriptor
{
    OdString id;               // Unique string identifier for this pane.
                               // Recommended format: "VendorName.PaneName"

    OdString title;            // Caption shown in the pane's title bar.

    OdString defaultDockSide;  // Initial dock position hint: "Left", "Right",
                               // "Top", "Bottom", or "Float". The implementation
                               // may ignore this value if docking state is
                               // already persisted.
};

// ─────────────────────────────────────────────
// IVBimDockablePaneProvider
// ─────────────────────────────────────────────

// Interface implemented by the plugin to create the pane's content window.
//
// The plugin owns the content window; VBimDockablePaneRegistry manages
// the docking shell (CDockablePane subclass) that hosts it.
//
class VINABIMCORE_DLLEXPORT IVBimDockablePaneProvider
{
public:
    virtual ~IVBimDockablePaneProvider() = default;

    // Creates and returns the native content window handle.
    // parentWindow is the HWND of the host docking shell, passed as void*
    // so this header needs no Windows or MFC includes. Create the content
    // as a Win32 child of that HWND (for example with CreateWindowEx).
    //
    // Returns the native window handle (HWND) as void*.
    // Returns nullptr if creation fails.
    //
    // Called once by VBimDockablePaneRegistry during pane creation.
    // The returned window will be reparented into the docking shell.
    //
    virtual void* CreateNativeWindow(void* parentWindow) = 0;
};

// ─────────────────────────────────────────────
// VBimDockablePane
// ─────────────────────────────────────────────

// Pane instance handle returned by VBimDockablePaneRegistry::GetPane().
// Call Show(), Hide(), IsShown() directly on the object.
//
// Proxy pattern: obtain only via VBimDockablePaneRegistry::GetPane().
// Lightweight value type — safe to copy and store by the caller.
// Valid only while the pane remains registered (for the app lifetime).
//
// Threading: All methods must be called from the UI thread.
//
class VINABIMCORE_DLLEXPORT VBimDockablePane
{
public:

    // Returns the unique string identifier for this pane.
    //
    // Analogous to DockablePane.Id.
    //
    const OdString& Id() const;

    // If the pane is not currently visible, display it at its last docked location.
    // No-op if the pane is already shown or the id is no longer registered.
    //
    // Analogous to DockablePane.Show().
    //
    void Show();

    // If the pane is currently visible, hide it.
    // No-op if the pane is already hidden or the id is no longer registered.
    //
    // Analogous to DockablePane.Hide().
    //
    void Hide();

    // Returns true if the pane is currently visible or present in a tab group.
    // Returns false if hidden or not registered.
    //
    // Analogous to DockablePane.IsShown().
    //
    bool IsShown() const;

    // Returns true if this handle refers to a registered pane (i.e. Id() is non-empty).
    // A default-constructed VBimDockablePane is invalid.
    //
    bool IsValid() const;

private:
    // Only VBimDockablePaneRegistry may set the internal id.
    friend class VBimDockablePaneRegistry;
    void SetInternalId(const OdString& id);

    OdString m_id;
};

// ─────────────────────────────────────────────
// VBimDockablePaneRegistry
// ─────────────────────────────────────────────

// Dockable pane registry service facade. Manages SDK-owned panes
// within VinaBIM's MFC docking framework.
//
// Supports register, show, hide, visibility query, docking state
// (GetState / SetState), tab attachment (AttachToTab) and UnregisterPane.
// Call UnregisterPane from uninitApp for every pane the plugin registered.
//
class VINABIMCORE_DLLEXPORT VBimDockablePaneRegistry
{
public:

    // Registers a new dockable pane with the given descriptor and provider.
    // Returns true if the pane was registered; false if the id is already
    // in use or registration cannot proceed at this point.
    //
    // The provider is borrowed — its lifetime must exceed the pane's lifetime.
    // The caller is responsible for keeping the provider alive until the pane
    // is destroyed (currently: until VinaBIM closes).
    //
    // Analogous to UIApplication.RegisterDockablePane(id, title, provider).
    //
    bool RegisterPane(
        const VBimDockablePaneDescriptor& descriptor,
        IVBimDockablePaneProvider*        provider);

    // Returns a VBimDockablePane handle for the pane with the given id.
    // The returned object has IsValid() == true if the id is registered.
    // If the id is not registered, returns a default-constructed (invalid) pane.
    //
    // Analogous to UIApplication.GetDockablePane(id).
    //
    VBimDockablePane GetPane(const OdString& id) const;

    // Shows the pane with the given id.
    // Returns true if the pane was found and shown; false if not registered.
    //
    // Prefer GetPane(id).Show() for object-oriented usage.
    // Analogous to DockablePane.Show().
    //
    bool ShowPane(const OdString& id);

    // Hides the pane with the given id.
    // Returns true if the pane was found and hidden; false if not registered.
    //
    // Prefer GetPane(id).Hide() for object-oriented usage.
    // Analogous to DockablePane.Hide().
    //
    bool HidePane(const OdString& id);

    // Returns true if the pane with the given id is currently visible.
    // Returns false if the pane is hidden or not registered.
    //
    // Prefer GetPane(id).IsShown() for object-oriented usage.
    // Analogous to DockablePane.IsShown().
    //
    bool IsPaneVisible(const OdString& id) const;

    // Copies the docking state of pane id into state. Before the pane was first
    // shown, reports the registered title and default dock side.
    //
    // Returns eOk, or eInvalidInput when id is not registered. Read only;
    // UI thread only.
    //
    // Analogous to Revit DockablePane / DockablePaneState queries.
    //
    OdResult GetState(const OdString& id, VBimPaneState& state) const;

    // Applies title, dock side and floating state to pane id. A pane not yet
    // shown stores the values and uses them when it is first created. The pane
    // is not shown or hidden by this call.
    //
    // Returns eOk, eInvalidInput when id is not registered or the title is
    // empty, or eNotApplicable when the docking shell refuses the change.
    // UI thread only.
    //
    OdResult SetState(const OdString& id, const VBimPaneState& state);

    // Destroys pane id (its docking shell and, with it, the content window the
    // provider created as a child) and forgets the registration; the id can be
    // registered again. Call it from uninitApp, before the plugin code that
    // owns the content window and the provider is unloaded.
    //
    // Returns eOk, or eInvalidInput when id is not registered. UI thread only.
    //
    OdResult UnregisterPane(const OdString& id);

    // Docks pane id as a tab next to targetId: another registered SDK pane id,
    // or the built-in "VinaBIM.Properties" / "VinaBIM.ProjectBrowser". Panes
    // not shown yet are created and shown first.
    //
    // Returns eOk, eInvalidInput for an unknown or identical id, or
    // eNotApplicable when a pane cannot be created or the docking shell refuses.
    // UI thread only.
    //
    // Analogous to Revit DockablePaneProviderData.InitialState tab placement.
    //
    OdResult AttachToTab(const OdString& id, const OdString& targetId);

private:
    // Internal owner handle.
    // Set by VBimUIApplication before providing DockablePaneRegistry() to callers.
    //
    friend class VBimUIApplication;
    void SetInternalOwner(void* pOwner);

    void* m_pOwner = nullptr;
};
