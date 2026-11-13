// VBimTaskDialogService.h
//
// Task dialog facade for VinaBIM SDK developers.
//
// Provides a unified dialog surface without exposing MFC, HWND,
// CWnd, or TASKDIALOGCONFIG types in the public API.
//
// Obtain via VBimUIApplication::TaskDialogService() — deferred to
// a later prompt when VBimUIApplication::TaskDialogService() is added.
//
// Threading: All methods must be called from the UI thread.
// All Show* methods are modal (blocking) until the user dismisses.
//
#pragma once

#include "../VinaBIMApiExport.h"

#include "OdResult.h"
#include "OdString.h"

// Icon style for the dialog's main icon area.
//
enum class VBimTaskDialogIcon
{
    None,           // No icon
    Information,    // Informational (blue i)
    Warning,        // Warning (yellow !)
    Error,          // Error (red x)
    Question        // Question (blue ?)
};

// Result returned by a VBimTaskDialogService Show* call.
// Indicates which button the user pressed.
//
enum class VBimTaskDialogResult
{
    None,       // Dialog was not shown or closed without action
    Ok,         // User pressed OK
    Cancel,     // User pressed Cancel or closed the dialog
    Yes,        // User pressed Yes
    No,         // User pressed No
    Retry,      // User pressed Retry
    CommandLink1,  // ShowAdvanced: first command link
    CommandLink2,
    CommandLink3,
    CommandLink4
};

#include "AdvancedDialog/VBimTaskDialogOptions.h"

// Task dialog service facade. Wraps AfxMessageBox / Win32 TaskDialogIndirect.
//
// Analogous to Autodesk.Revit.UI.TaskDialog.
//
// Four typed convenience methods plus ShowAdvanced() for command links,
// expanded text, footer and a verification check box.
//
class VINABIMCORE_DLLEXPORT VBimTaskDialogService
{
public:

    // Shows an information dialog with OK button.
    // Returns VBimTaskDialogResult::Ok when the user dismisses.
    //
    // Analogous to TaskDialog.Show(title, message).
    //
    VBimTaskDialogResult ShowInfo(
        const OdString& title,
        const OdString& message);

    // Shows a warning dialog with OK button.
    // Returns VBimTaskDialogResult::Ok when the user dismisses.
    //
    VBimTaskDialogResult ShowWarning(
        const OdString& title,
        const OdString& message);

    // Shows an error dialog with OK button.
    // Returns VBimTaskDialogResult::Ok when the user dismisses.
    //
    VBimTaskDialogResult ShowError(
        const OdString& title,
        const OdString& message);

    // Shows a Yes/No question dialog.
    // Returns VBimTaskDialogResult::Yes or VBimTaskDialogResult::No.
    //
    // Analogous to TaskDialog.Show() with Yes/No common buttons.
    //
    VBimTaskDialogResult ShowQuestion(
        const OdString& title,
        const OdString& message);

    // Shows a Win32 task dialog built from options, parented to the main frame,
    // and fills response. Raises DialogBoxShowing first; a handler override
    // (IDOK, IDCANCEL, IDYES, IDNO, IDRETRY, or 1001..1004 for command links)
    // skips the dialog and is reported in response.
    //
    // Returns eOk, eInvalidInput when mainInstruction and content are both
    // empty, eNotApplicable without a main window, or the failure code of the
    // Win32 call as eNotApplicable. Modal; UI thread only.
    //
    // Analogous to Revit TaskDialog.Show() with a configured TaskDialog.
    //
    OdResult ShowAdvanced(const VBimTaskDialogOptions& options, VBimTaskDialogResponse& response);

private:
    // Internal owner handle — opaque to callers.
    // void* avoids exposing CWnd or HWND in this public header.
    // Set by VBimUIApplication before providing TaskDialogService() to callers.
    //
    friend class VBimUIApplication;
    void SetInternalOwner(void* pOwner);

    void* m_pOwner = nullptr;
};
