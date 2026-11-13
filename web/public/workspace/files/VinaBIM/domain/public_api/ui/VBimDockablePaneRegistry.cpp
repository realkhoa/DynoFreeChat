#include "pch.h"
#include "domain/public_api/ui/VBimDockablePaneRegistry.h"
#include "domain/public_api/ui/internal/VBimDockablePaneBridge.h"

// VBimDockablePaneRegistry delegates all MFC-level work to VBimDockablePaneBridge.
// This keeps the public header free of MFC, CWnd, and CDockablePane types.

// ---------------------------------------------------------------------------
// VBimDockablePane
// ---------------------------------------------------------------------------

void VBimDockablePane::SetInternalId(const OdString& id)
{
    m_id = id;

}

const OdString& VBimDockablePane::Id() const
{
    return m_id;
}

bool VBimDockablePane::IsValid() const
{
    return !m_id.isEmpty();
}

void VBimDockablePane::Show()
{
    if (!m_id.isEmpty())
        VBimDockablePaneBridge::ShowPane(m_id);
}

void VBimDockablePane::Hide()
{
    if (!m_id.isEmpty())
        VBimDockablePaneBridge::HidePane(m_id);
}

bool VBimDockablePane::IsShown() const
{
    return !m_id.isEmpty() && VBimDockablePaneBridge::IsPaneVisible(m_id);
}

// ---------------------------------------------------------------------------
// VBimDockablePaneRegistry
// ---------------------------------------------------------------------------

bool VBimDockablePaneRegistry::RegisterPane(
    const VBimDockablePaneDescriptor& descriptor,
    IVBimDockablePaneProvider*        provider)
{
    return VBimDockablePaneBridge::RegisterPane(descriptor, provider);
}

VBimDockablePane VBimDockablePaneRegistry::GetPane(const OdString& id) const
{
    VBimDockablePane pane;
    if (VBimDockablePaneBridge::IsPaneRegistered(id))
        pane.SetInternalId(id);
    return pane;
}

bool VBimDockablePaneRegistry::ShowPane(const OdString& id)
{
    return VBimDockablePaneBridge::ShowPane(id);
}

bool VBimDockablePaneRegistry::HidePane(const OdString& id)
{
    return VBimDockablePaneBridge::HidePane(id);
}

bool VBimDockablePaneRegistry::IsPaneVisible(const OdString& id) const
{
    return VBimDockablePaneBridge::IsPaneVisible(id);
}

OdResult VBimDockablePaneRegistry::GetState(const OdString& id, VBimPaneState& state) const
{
    return VBimDockablePaneBridge::GetState(id, state);
}

OdResult VBimDockablePaneRegistry::SetState(const OdString& id, const VBimPaneState& state)
{
    return VBimDockablePaneBridge::SetState(id, state);
}

OdResult VBimDockablePaneRegistry::UnregisterPane(const OdString& id)
{
    return VBimDockablePaneBridge::UnregisterPane(id);
}

OdResult VBimDockablePaneRegistry::AttachToTab(const OdString& id, const OdString& targetId)
{
    return VBimDockablePaneBridge::AttachToTab(id, targetId);
}

void VBimDockablePaneRegistry::SetInternalOwner(void* pOwner)
{
    // Phase 1: stored but unused. Bridge accesses CMainFrame via theApp directly.
    m_pOwner = pOwner;
}
