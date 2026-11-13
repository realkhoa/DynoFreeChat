#include "pch.h"
// pch.h transitively provides:
//   CVinaBIMDockablePaneExt   — via VinaBIMCommon.h
//   CMDIFrameWndEx, CDockablePane, AFX_IDW_DOCKBAR_* — via framework.h > afxcontrolbars.h
//   AfxGetMainWnd()           — via afxwin.h
// No MainFrm.h — it transitively includes VinaBIMView.h which triggers the
// pre-existing missing BmDBView3d.h error in VimSectionBoxController.h.
#include "domain/public_api/ui/internal/VBimDockablePaneBridge.h"
#include "Host/application/resource.h"   // IDC_DOCK_PROPERTIES, IDC_DOCK_PROJECTS_BROWSERS

#include <map>
#include <string>

namespace {

struct PaneEntry
{
    VBimDockablePaneDescriptor  desc;
    IVBimDockablePaneProvider*  provider = nullptr;
    HWND                        hShell   = nullptr;  // null until lazily created
};

// Key: std::wstring (operator< is well-defined).
std::map<std::wstring, PaneEntry> s_panes;

// SDK pane ID counter — range 0xD000–0xDFFF, safe above VinaBIM existing IDs
// (IDC_DOCK_PROPERTIES=103, IDC_DOCK_PROJECTS_BROWSERS=0x7000).
UINT s_nextPaneId = 0xD000;
static constexpr UINT kPaneIdMax = 0xDFFF;

// Default pane width in logical pixels at 96 DPI; DPI-scaled at creation time.
static constexpr int kDefaultPaneWidthDp = 280;

// Converts an OdString pane id to the map key type.
static std::wstring ToKey(const OdString& id) { return std::wstring(id.c_str()); }

// Returns the main MDI frame, or nullptr if not yet created.
static CMDIFrameWndEx* GetMdiFrame()
{
    return DYNAMIC_DOWNCAST(CMDIFrameWndEx, AfxGetMainWnd());
}

// Creates the CVinaBIMDockablePaneExt shell and calls provider->CreateNativeWindow.
// Returns the shell HWND on success, nullptr on failure.
static HWND CreatePaneShell(PaneEntry& entry)
{
    CMDIFrameWndEx* pFrame = GetMdiFrame();
    if (!pFrame || !::IsWindow(pFrame->GetSafeHwnd()))
    {
        LOG(CString(L"VBimDockablePaneBridge: CreatePaneShell — main frame not ready"));
        return nullptr;
    }

    if (s_nextPaneId > kPaneIdMax)
    {
        LOG(CString(L"VBimDockablePaneBridge: pane ID pool exhausted (0xD000-0xDFFF)"));
        return nullptr;
    }

    CRect clientRect;
    pFrame->GetClientRect(&clientRect);
    const UINT dpi  = ::GetDpiForWindow(pFrame->GetSafeHwnd());
    const int paneW = ::MulDiv(kDefaultPaneWidthDp, static_cast<int>(dpi), 96);
    const int paneH = (clientRect.Height() > 200) ? clientRect.Height() : 200;

    auto* pPane = new CVinaBIMDockablePaneExt();
    const UINT nId    = s_nextPaneId++;
    const CString title(entry.desc.title.c_str());

    if (!pPane->Create(title, pFrame,
        CRect(0, 0, paneW, paneH),
        TRUE,  // bHasGripper
        nId,
        WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN | CBRS_RIGHT | CBRS_FLOAT_MULTI))
    {
        LOG(CString(L"VBimDockablePaneBridge: CDockablePane::Create failed"));
        // Create() failed — no HWND yet, delete manually (PostNcDestroy path not triggered).
        delete pPane;
        --s_nextPaneId;
        return nullptr;
    }

    pPane->EnableDocking(CBRS_ALIGN_ANY);

    // Dock to the requested side; default to right.
    const OdString& side = entry.desc.defaultDockSide;
    if (side == OdString(L"Left"))
        pFrame->DockPane(pPane, AFX_IDW_DOCKBAR_LEFT);
    else if (side == OdString(L"Bottom"))
        pFrame->DockPane(pPane, AFX_IDW_DOCKBAR_BOTTOM);
    else if (side == OdString(L"Top"))
        pFrame->DockPane(pPane, AFX_IDW_DOCKBAR_TOP);
    else if (side == OdString(L"Float"))
        pPane->FloatPane(CRect(100, 100, 100 + paneW, 100 + paneH));
    else
        pFrame->DockPane(pPane, AFX_IDW_DOCKBAR_RIGHT);

    const HWND hShell = pPane->GetSafeHwnd();

    // Ask the provider to create its content window as a child of the shell.
    // The provider receives the HWND as void* and creates via Win32 (CreateWindowEx).
    // The provider is responsible for sizing its content on WM_SIZE.
    if (entry.provider && hShell)
    {
        void* hContent = entry.provider->CreateNativeWindow(reinterpret_cast<void*>(hShell));
        if (!hContent)
        {
            LOG(CString(L"VBimDockablePaneBridge: provider CreateNativeWindow returned null — destroying shell"));
            ::DestroyWindow(hShell);
            return nullptr;
        }
    }

    return hShell;
}

// Returns the live docking shell of entry, or nullptr before first Show.
static CDockablePane* LivePane(const PaneEntry& entry)
{
    if (!entry.hShell || !::IsWindow(entry.hShell))
        return nullptr;
    CWnd* pCWnd = CWnd::FromHandle(entry.hShell);
    return pCWnd ? DYNAMIC_DOWNCAST(CDockablePane, pCWnd) : nullptr;
}

// defaultDockSide strings understood by CreatePaneShell.
static const wchar_t* SideName(VBimDockSide side)
{
    switch (side)
    {
    case VBimDockSide::Left:   return L"Left";
    case VBimDockSide::Top:    return L"Top";
    case VBimDockSide::Bottom: return L"Bottom";
    default:                   return L"Right";
    }
}

static VBimDockSide SideFromName(const OdString& name)
{
    if (name == OdString(L"Left"))   return VBimDockSide::Left;
    if (name == OdString(L"Top"))    return VBimDockSide::Top;
    if (name == OdString(L"Bottom")) return VBimDockSide::Bottom;
    return VBimDockSide::Right;
}

static DWORD SideAlignment(VBimDockSide side)
{
    switch (side)
    {
    case VBimDockSide::Left:   return CBRS_ALIGN_LEFT;
    case VBimDockSide::Top:    return CBRS_ALIGN_TOP;
    case VBimDockSide::Bottom: return CBRS_ALIGN_BOTTOM;
    default:                   return CBRS_ALIGN_RIGHT;
    }
}

static VBimDockSide SideFromAlignment(DWORD alignment)
{
    if (alignment & CBRS_ALIGN_LEFT)   return VBimDockSide::Left;
    if (alignment & CBRS_ALIGN_TOP)    return VBimDockSide::Top;
    if (alignment & CBRS_ALIGN_BOTTOM) return VBimDockSide::Bottom;
    return VBimDockSide::Right;
}

} // namespace

bool VBimDockablePaneBridge::RegisterPane(
    const VBimDockablePaneDescriptor& descriptor,
    IVBimDockablePaneProvider*        provider)
{
    if (descriptor.id.isEmpty() || !provider)
    {
        LOG(CString(L"VBimDockablePaneBridge::RegisterPane — empty id or null provider"));
        return false;
    }
    const std::wstring key = ToKey(descriptor.id);
    if (s_panes.count(key))
    {
        LOG(CString(L"VBimDockablePaneBridge::RegisterPane — duplicate id"));
        return false;
    }
    PaneEntry entry;
    entry.desc     = descriptor;
    entry.provider = provider;
    s_panes[key]   = entry;
    return true;
}

bool VBimDockablePaneBridge::ShowPane(const OdString& id)
{
    const std::wstring key = ToKey(id);
    auto it = s_panes.find(key);
    if (it == s_panes.end())
    {
        LOG(CString(L"VBimDockablePaneBridge::ShowPane — id not registered"));
        return false;
    }

    PaneEntry& entry = it->second;

    // Lazy-create on first Show (main frame must be ready).
    if (!entry.hShell || !::IsWindow(entry.hShell))
    {
        entry.hShell = CreatePaneShell(entry);
        if (!entry.hShell)
            return false;
    }

    CWnd*          pCWnd = CWnd::FromHandle(entry.hShell);
    CDockablePane* pPane = pCWnd ? DYNAMIC_DOWNCAST(CDockablePane, pCWnd) : nullptr;
    if (!pPane)
    {
        LOG(CString(L"VBimDockablePaneBridge::ShowPane — CDockablePane cast failed"));
        return false;
    }

    pPane->ShowPane(TRUE, FALSE, TRUE);
    return true;
}

bool VBimDockablePaneBridge::HidePane(const OdString& id)
{
    const std::wstring key = ToKey(id);
    auto it = s_panes.find(key);
    if (it == s_panes.end())
        return false;

    const HWND hShell = it->second.hShell;
    if (!hShell || !::IsWindow(hShell))
        return false;

    CWnd*          pCWnd = CWnd::FromHandle(hShell);
    CDockablePane* pPane = pCWnd ? DYNAMIC_DOWNCAST(CDockablePane, pCWnd) : nullptr;
    if (!pPane)
    {
        LOG(CString(L"VBimDockablePaneBridge::HidePane — CDockablePane cast failed"));
        return false;
    }

    pPane->ShowPane(FALSE, FALSE, FALSE);
    return true;
}

bool VBimDockablePaneBridge::IsPaneVisible(const OdString& id)
{
    const std::wstring key = ToKey(id);
    auto it = s_panes.find(key);
    if (it == s_panes.end())
        return false;

    const HWND hShell = it->second.hShell;
    if (!hShell || !::IsWindow(hShell))
        return false;

    CWnd*          pCWnd = CWnd::FromHandle(hShell);
    CDockablePane* pPane = pCWnd ? DYNAMIC_DOWNCAST(CDockablePane, pCWnd) : nullptr;
    return pPane ? (pPane->IsVisible() != FALSE) : false;
}

bool VBimDockablePaneBridge::IsPaneRegistered(const OdString& id)
{
    return s_panes.count(ToKey(id)) > 0;
}

OdResult VBimDockablePaneBridge::GetState(const OdString& id, VBimPaneState& state)
{
    auto it = s_panes.find(ToKey(id));
    if (it == s_panes.end())
        return eInvalidInput;
    const PaneEntry& entry = it->second;

    CDockablePane* pPane = LivePane(entry);
    if (!pPane)
    {
        state.title    = entry.desc.title;
        state.floating = entry.desc.defaultDockSide == OdString(L"Float");
        state.side     = SideFromName(entry.desc.defaultDockSide);
        return eOk;
    }

    CString title;
    pPane->GetWindowText(title);
    state.title    = OdString((LPCTSTR)title);
    state.floating = pPane->IsFloating() != FALSE;
    state.side     = SideFromAlignment(pPane->GetCurrentAlignment());
    return eOk;
}

OdResult VBimDockablePaneBridge::SetState(const OdString& id, const VBimPaneState& state)
{
    auto it = s_panes.find(ToKey(id));
    if (it == s_panes.end() || state.title.isEmpty())
        return eInvalidInput;
    PaneEntry& entry = it->second;

    // Stored first so a pane created later starts in the requested state.
    entry.desc.title           = state.title;
    entry.desc.defaultDockSide = state.floating ? OdString(L"Float") : OdString(SideName(state.side));

    CDockablePane* pPane = LivePane(entry);
    if (!pPane)
        return eOk;

    pPane->SetWindowText(CString(state.title.c_str()));
    if (state.floating)
    {
        if (!pPane->IsFloating())
        {
            CRect rect;
            pPane->GetWindowRect(&rect);
            if (!pPane->FloatPane(rect, DM_SHOW, pPane->IsVisible() != FALSE))
                return eNotApplicable;
        }
    }
    else if (pPane->IsFloating() || SideFromAlignment(pPane->GetCurrentAlignment()) != state.side)
    {
        if (!pPane->DockToFrameWindow(SideAlignment(state.side)))
            return eNotApplicable;
    }

    if (CMDIFrameWndEx* pFrame = GetMdiFrame())
        pFrame->RecalcLayout();
    return eOk;
}

OdResult VBimDockablePaneBridge::UnregisterPane(const OdString& id)
{
    auto it = s_panes.find(ToKey(id));
    if (it == s_panes.end())
        return eInvalidInput;

    if (CDockablePane* pPane = LivePane(it->second))
    {
        // CDockablePane::OnDestroy undocks a docked or floating pane but not a
        // tab of a tabbed group, so leave the group first.
        if (pPane->IsTabbed())
        {
            CWnd* pTabWnd = pPane->GetParent();
            CBaseTabbedPane* pTabbed = pTabWnd ? DYNAMIC_DOWNCAST(CBaseTabbedPane, pTabWnd->GetParent()) : nullptr;
            if (pTabbed)
                pTabbed->RemovePane(pPane);
        }
        pPane->DestroyWindow();
        // The shell was created with new in CreatePaneShell; MFC does not delete it.
        delete pPane;
        if (CMDIFrameWndEx* pFrame = GetMdiFrame())
            pFrame->RecalcLayout();
    }
    s_panes.erase(it);
    return eOk;
}

OdResult VBimDockablePaneBridge::AttachToTab(const OdString& id, const OdString& targetId)
{
    if (id == targetId || !IsPaneRegistered(id))
        return eInvalidInput;

    CMDIFrameWndEx* pFrame = GetMdiFrame();
    if (!pFrame)
        return eNotApplicable;

    CDockablePane* pTarget = nullptr;
    if (targetId == OdString(L"VinaBIM.Properties"))
        pTarget = DYNAMIC_DOWNCAST(CDockablePane, pFrame->GetPane(IDC_DOCK_PROPERTIES));
    else if (targetId == OdString(L"VinaBIM.ProjectBrowser"))
        pTarget = DYNAMIC_DOWNCAST(CDockablePane, pFrame->GetPane(IDC_DOCK_PROJECTS_BROWSERS));
    else if (IsPaneRegistered(targetId))
    {
        if (!ShowPane(targetId))
            return eNotApplicable;
        pTarget = LivePane(s_panes[ToKey(targetId)]);
    }
    else
        return eInvalidInput;

    if (!ShowPane(id))
        return eNotApplicable;
    CDockablePane* pPane = LivePane(s_panes[ToKey(id)]);
    if (!pTarget || !pPane)
        return eNotApplicable;

    if (!pPane->AttachToTabWnd(pTarget, DM_SHOW, TRUE))
        return eNotApplicable;
    pFrame->RecalcLayout();
    return eOk;
}
