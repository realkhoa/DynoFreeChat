#include "pch.h"
#include "domain/public_api/ui/VBimProgressService.h"
#include "Host/application/VinaBIM.h"  // theApp, CVinaBIMApp::GetProgressDialog,
                                        // CreateAndShowProgressDialog, CleanupProgressDialog
// CVinaBimLoadingDlg is transitively included via VinaBIM.h

namespace
{
    // One progress session per process: CVinaBIMApp owns a single loading
    // dialog, so the session state is shared by every VBimProgressService
    // instance instead of living in the public header (ABI-neutral).
    struct ProgressSessionState
    {
        int  minValue = 0;
        int  maxValue = 100;
        bool active   = false;
    };

    ProgressSessionState& SessionState()
    {
        static ProgressSessionState s_state;
        return s_state;
    }
}

bool VBimProgressService::BeginProgress(
    const OdString& title,
    int             minValue,
    int             maxValue)
{
    ProgressSessionState& state = SessionState();
    if (state.active)
        return false;  // nested progress not supported

    if (!theApp.m_pMainWnd || !::IsWindow(theApp.m_pMainWnd->GetSafeHwnd()))
        return false;  // no main window — dialog cannot be created safely

    state.minValue = minValue;
    state.maxValue = maxValue;

    theApp.ShowProgressDialog(CString(title.c_str()));

    CVinaBimLoadingDlg* pDlg = theApp.GetProgressDialog();
    if (!pDlg)
        return false;  // CreateAndShowProgressDialog failed silently

    // Establish initial 0% ring render.
    pDlg->UpdateProgress(0);

    state.active = true;
    return true;
}

void VBimProgressService::SetProgressValue(int value)
{
    const ProgressSessionState& state = SessionState();
    if (!state.active)
        return;

    CVinaBimLoadingDlg* pDlg = theApp.GetProgressDialog();
    if (!pDlg)
        return;

    const int range = state.maxValue - state.minValue;
    if (range <= 0)
        return;

    int percent = ((value - state.minValue) * 100) / range;
    if (percent < 0)   percent = 0;
    if (percent > 100) percent = 100;

    pDlg->UpdateProgress(percent);
}

void VBimProgressService::SetProgressText(const OdString& text)
{
    if (!SessionState().active)
        return;

    CVinaBimLoadingDlg* pDlg = theApp.GetProgressDialog();
    if (!pDlg)
        return;

    // SetDescription stores the string; it becomes visible on the next
    // UpdateProgress call that triggers ApplyRoundedCorners.
    pDlg->SetDescription(CString(text.c_str()));
}

bool VBimProgressService::IsCancelled() const
{
    // Phase 1: no cancel button exists in CVinaBimLoadingDlg.
    return false;
}

void VBimProgressService::EndProgress()
{
    ProgressSessionState& state = SessionState();
    if (!state.active)
        return;

    theApp.HideProgressDialog();  // calls stop() (100%), DestroyWindow, re-enables main window
    state.active = false;
}

void VBimProgressService::SetInternalOwner(void* pOwner)
{
    // Stores the owner handle provided by VBimUIApplication.
    // Phase 1: not used — all operations route through theApp directly.
    m_pOwner = pOwner;
}
