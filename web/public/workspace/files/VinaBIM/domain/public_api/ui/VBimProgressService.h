// VBimProgressService.h
//
// Progress reporting facade for VinaBIM SDK developers.
//
// Provides a public progress surface for long-running SDK commands
// without exposing CVinaBimLoadingDlg or ODA host meter internals.
//
// Obtain via VBimUIApplication::ProgressService().
//
// Threading: All methods must be called from the UI thread.
// Begin/End calls must be balanced; nested progress is not supported.
// The session state is shared application-wide (VinaBIM has one loading
// dialog), so a second BeginProgress() from any instance fails until the
// active session ends.
//
// Cancel support: IsCancelled() always returns false in Phase 1.
// The current loading dialog has no cancel button.
//
#pragma once

#include "../VinaBIMApiExport.h"

#include "OdString.h"

// Progress service facade. Wraps CVinaBimLoadingDlg and
// CVinaBIMApp progress management (CreateAndShowProgressDialog /
// CleanupProgressDialog / UpdateProgress).
//
// Phase 1 provides basic begin/set/end operations.
// Indeterminate progress, cancel, and nested sessions are deferred.
//
class VINABIMCORE_DLLEXPORT VBimProgressService
{
public:

    // Begins a progress session with the given title and value range.
    // Shows the VinaBIM loading dialog if one is not already visible.
    // Returns true if the session started; false if already in progress
    // or the dialog could not be created.
    //
    // minValue and maxValue define the range for SetProgressValue().
    // The dialog displays percent = (value - minValue) / (maxValue - minValue) * 100.
    // Maps to CVinaBIMApp::CreateAndShowProgressDialog() + UpdateProgress(0).
    //
    bool BeginProgress(
        const OdString& title,
        int             minValue,
        int             maxValue);

    // Updates the displayed progress to the given value.
    // value must be within [minValue, maxValue] as passed to BeginProgress().
    // No-op if no active progress session.
    //
    // Maps to CVinaBimLoadingDlg::UpdateProgress(percent).
    //
    void SetProgressValue(int value);

    // Updates the descriptive text shown in the loading dialog.
    // No-op if no active progress session.
    //
    // Maps to CVinaBimLoadingDlg::SetDescription().
    //
    void SetProgressText(const OdString& text);

    // Returns true if the user has requested cancellation.
    // Always returns false in Phase 1 — no cancel button in the current UI.
    // Reserved for Phase 2 when cancel support is added.
    //
    bool IsCancelled() const;

    // Ends the current progress session and hides the loading dialog.
    // No-op if no active progress session.
    // Must be called to balance every successful BeginProgress() call.
    //
    // Maps to CVinaBIMApp::CleanupProgressDialog().
    //
    void EndProgress();

private:
    // Internal owner handle — opaque to callers.
    // void* avoids exposing CWnd or MFC types in this public header.
    // Set by VBimUIApplication before providing ProgressService() to callers.
    //
    friend class VBimUIApplication;
    void SetInternalOwner(void* pOwner);

    void* m_pOwner  = nullptr;
};
