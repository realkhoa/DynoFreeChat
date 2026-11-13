#include "pch.h"
#include "domain/public_api/ui/VBimTaskDialogService.h"
#include "Host/application/VinaBIM.h"  // theApp, CVinaBIMApp::messageBox (public)
#include "domain/public_api/events/internal/VBimEventBridge.h"  // DialogBoxShowing
#include <commctrl.h>  // TaskDialogIndirect
                                        // MB_*, IDYES, IDNO — via transitively included Windows headers

// All Show* methods route through theApp.messageBox(caption, text, flags)
// which calls ::MessageBox(GetMainWnd()->GetSafeHwnd(), lpText, lpCaption, uType).
// Owner is always the application's main window (m_pMainWnd).
// m_pOwner is stored but not used in Phase 1; the main-window owner is correct for all cases.

VBimTaskDialogResult VBimTaskDialogService::ShowInfo(
    const OdString& title,
    const OdString& message)
{
    theApp.messageBox(title.c_str(), message.c_str(), MB_OK | MB_ICONINFORMATION);
    return VBimTaskDialogResult::Ok;
}

VBimTaskDialogResult VBimTaskDialogService::ShowWarning(
    const OdString& title,
    const OdString& message)
{
    theApp.messageBox(title.c_str(), message.c_str(), MB_OK | MB_ICONWARNING);
    return VBimTaskDialogResult::Ok;
}

VBimTaskDialogResult VBimTaskDialogService::ShowError(
    const OdString& title,
    const OdString& message)
{
    theApp.messageBox(title.c_str(), message.c_str(), MB_OK | MB_ICONERROR);
    return VBimTaskDialogResult::Ok;
}

VBimTaskDialogResult VBimTaskDialogService::ShowQuestion(
    const OdString& title,
    const OdString& message)
{
    const int result = theApp.messageBox(
        title.c_str(), message.c_str(), MB_YESNO | MB_ICONQUESTION);
    return (result == IDYES) ? VBimTaskDialogResult::Yes : VBimTaskDialogResult::No;
}

void VBimTaskDialogService::SetInternalOwner(void* pOwner)
{
    // Phase 1: stored but unused. theApp.messageBox uses GetMainWnd() internally.
    m_pOwner = pOwner;
}

namespace {

// Command link button ids, as in Revit (TaskDialogResult.CommandLink1 = 1001).
const int kFirstCommandLinkId = 1001;

VBimTaskDialogResult ResultFromButtonId(int id)
{
    switch (id)
    {
    case IDOK:     return VBimTaskDialogResult::Ok;
    case IDCANCEL: return VBimTaskDialogResult::Cancel;
    case IDYES:    return VBimTaskDialogResult::Yes;
    case IDNO:     return VBimTaskDialogResult::No;
    case IDRETRY:  return VBimTaskDialogResult::Retry;
    case kFirstCommandLinkId:     return VBimTaskDialogResult::CommandLink1;
    case kFirstCommandLinkId + 1: return VBimTaskDialogResult::CommandLink2;
    case kFirstCommandLinkId + 2: return VBimTaskDialogResult::CommandLink3;
    case kFirstCommandLinkId + 3: return VBimTaskDialogResult::CommandLink4;
    }
    return VBimTaskDialogResult::None;
}

PCWSTR MainIcon(VBimTaskDialogIcon icon)
{
    switch (icon)
    {
    case VBimTaskDialogIcon::Information: return TD_INFORMATION_ICON;
    case VBimTaskDialogIcon::Warning:     return TD_WARNING_ICON;
    case VBimTaskDialogIcon::Error:       return TD_ERROR_ICON;
    // Win32 task dialogs have no question icon; information is the closest.
    case VBimTaskDialogIcon::Question:    return TD_INFORMATION_ICON;
    default:                              return nullptr;
    }
}

TASKDIALOG_COMMON_BUTTON_FLAGS CommonButtons(unsigned int flags)
{
    TASKDIALOG_COMMON_BUTTON_FLAGS result = 0;
    if (flags & kVBimTaskDialogOk)     result |= TDCBF_OK_BUTTON;
    if (flags & kVBimTaskDialogYes)    result |= TDCBF_YES_BUTTON;
    if (flags & kVBimTaskDialogNo)     result |= TDCBF_NO_BUTTON;
    if (flags & kVBimTaskDialogCancel) result |= TDCBF_CANCEL_BUTTON;
    if (flags & kVBimTaskDialogRetry)  result |= TDCBF_RETRY_BUTTON;
    return result;
}

} // namespace

OdResult VBimTaskDialogService::ShowAdvanced(const VBimTaskDialogOptions& options,
    VBimTaskDialogResponse& response)
{
    response = VBimTaskDialogResponse();
    response.verificationChecked = options.verificationChecked;
    if (options.mainInstruction.isEmpty() && options.content.isEmpty())
        return eInvalidInput;
    CWnd* pMain = theApp.GetMainWnd();
    if (!pMain || !::IsWindow(pMain->GetSafeHwnd()))
        return eNotApplicable;

    CString title(options.title.c_str());
    if (title.IsEmpty())
        title.LoadString(IDR_MAINFRAME);

    int overridden = 0;
    const OdString text = options.mainInstruction.isEmpty() ? options.content : options.mainInstruction;
    if (VBimEventBridge::NotifyDialogBoxShowing(OdString((LPCTSTR)title), text, overridden))
    {
        response.result = ResultFromButtonId(overridden);
        return eOk;
    }

    TASKDIALOG_BUTTON links[VBimTaskDialogOptions::kMaxCommandLinks] = {};
    UINT linkCount = 0;
    for (int i = 0; i < VBimTaskDialogOptions::kMaxCommandLinks; ++i)
    {
        if (options.commandLinks[i].isEmpty())
            continue;
        links[linkCount].nButtonID     = kFirstCommandLinkId + i;
        links[linkCount].pszButtonText = options.commandLinks[i].c_str();
        ++linkCount;
    }

    TASKDIALOGCONFIG cfg = {};
    cfg.cbSize             = sizeof(cfg);
    cfg.hwndParent         = pMain->GetSafeHwnd();
    cfg.dwFlags            = TDF_POSITION_RELATIVE_TO_WINDOW;
    if (options.allowCancellation)
        cfg.dwFlags |= TDF_ALLOW_DIALOG_CANCELLATION;
    if (linkCount > 0)
        cfg.dwFlags |= TDF_USE_COMMAND_LINKS;
    if (options.verificationChecked)
        cfg.dwFlags |= TDF_VERIFICATION_FLAG_CHECKED;
    cfg.dwCommonButtons    = CommonButtons(options.commonButtons);
    if (cfg.dwCommonButtons == 0 && linkCount == 0)
        cfg.dwCommonButtons = TDCBF_OK_BUTTON;
    cfg.pszWindowTitle     = title.GetString();
    cfg.pszMainIcon        = MainIcon(options.icon);
    cfg.pszMainInstruction = options.mainInstruction.isEmpty() ? nullptr : options.mainInstruction.c_str();
    cfg.pszContent         = options.content.isEmpty() ? nullptr : options.content.c_str();
    cfg.pszExpandedInformation = options.expandedContent.isEmpty() ? nullptr : options.expandedContent.c_str();
    cfg.pszFooter          = options.footer.isEmpty() ? nullptr : options.footer.c_str();
    cfg.pszVerificationText = options.verificationText.isEmpty() ? nullptr : options.verificationText.c_str();
    cfg.pButtons           = linkCount > 0 ? links : nullptr;
    cfg.cButtons           = linkCount;

    int pressed = 0;
    BOOL verified = options.verificationChecked ? TRUE : FALSE;
    const HRESULT hr = ::TaskDialogIndirect(&cfg, &pressed, nullptr, &verified);
    if (FAILED(hr))
    {
        CString msg;
        msg.Format(L"[SDK] ShowAdvanced: TaskDialogIndirect failed (0x%08X).", static_cast<unsigned int>(hr));
        LOG(msg);
        return eNotApplicable;
    }
    response.result = ResultFromButtonId(pressed);
    response.verificationChecked = (verified != FALSE);
    return eOk;
}
