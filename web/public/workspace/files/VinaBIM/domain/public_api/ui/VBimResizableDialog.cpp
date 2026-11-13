#include "pch.h"
#include "VBimResizableDialog.h"

#include <algorithm>
#include <utility>

bool VBimDialogResizeController::Initialize(CWnd& owner, const IVBimResizableDialog& dialog)
{
	Reset();

	const HWND ownerHwnd = owner.GetSafeHwnd();
	if (!::IsWindow(ownerHwnd))
		return false;

	CRect clientRect;
	owner.GetClientRect(&clientRect);
	if (clientRect.IsRectEmpty())
		return false;

	CRect windowRect;
	owner.GetWindowRect(&windowRect);
	m_initialClientSize = clientRect.Size();
	m_minimumWindowSize = windowRect.Size();

	for (const VBimDialogResizeRule& rule : dialog.GetResizeRules())
	{
		HWND controlHwnd = ::GetDlgItem(ownerHwnd, rule.controlId);
		if (controlHwnd == nullptr || !::IsWindow(controlHwnd))
			continue;

		const auto duplicate = std::find_if(
			m_controls.begin(), m_controls.end(),
			[&rule](const CapturedControl& captured) {
				return captured.rule.controlId == rule.controlId;
			});
		if (duplicate != m_controls.end())
			continue;

		CRect controlRect;
		::GetWindowRect(controlHwnd, &controlRect);
		owner.ScreenToClient(&controlRect);
		m_controls.push_back({ rule, controlRect });
	}

	m_ownerHwnd = ownerHwnd;
	return true;
}

void VBimDialogResizeController::Reset()
{
	m_ownerHwnd = nullptr;
	m_initialClientSize = CSize(0, 0);
	m_minimumWindowSize = CSize(0, 0);
	m_controls.clear();
}

bool VBimDialogResizeController::OnSize(UINT sizeType, int clientWidth, int clientHeight)
{
	if (!IsInitialized() || sizeType == SIZE_MINIMIZED || clientWidth <= 0 || clientHeight <= 0)
		return false;

	const int deltaX = clientWidth - m_initialClientSize.cx;
	const int deltaY = clientHeight - m_initialClientSize.cy;
	std::vector<std::pair<HWND, CRect>> targets;
	targets.reserve(m_controls.size());

	for (const CapturedControl& captured : m_controls)
	{
		HWND controlHwnd = ::GetDlgItem(m_ownerHwnd, captured.rule.controlId);
		if (controlHwnd == nullptr || !::IsWindow(controlHwnd))
			continue;

		targets.push_back({ controlHwnd, CalculateTargetRect(captured, deltaX, deltaY) });
	}

	HDWP deferredPositions = targets.empty()
		? nullptr
		: ::BeginDeferWindowPos(static_cast<int>(targets.size()));
	bool deferred = deferredPositions != nullptr;
	if (deferred)
	{
		for (const auto& target : targets)
		{
			const CRect& rect = target.second;
			deferredPositions = ::DeferWindowPos(
				deferredPositions,
				target.first,
				nullptr,
				rect.left,
				rect.top,
				rect.Width(),
				rect.Height(),
				SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
			if (deferredPositions == nullptr)
			{
				deferred = false;
				break;
			}
		}
	}

	if (deferred)
		deferred = ::EndDeferWindowPos(deferredPositions) != FALSE;

	if (!deferred)
	{
		for (const auto& target : targets)
		{
			const CRect& rect = target.second;
			::SetWindowPos(
				target.first,
				nullptr,
				rect.left,
				rect.top,
				rect.Width(),
				rect.Height(),
				SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
		}
	}

	if (::IsWindow(m_ownerHwnd))
	{
		::InvalidateRect(m_ownerHwnd, nullptr, TRUE);
	}

	return true;
}

void VBimDialogResizeController::OnGetMinMaxInfo(MINMAXINFO& minMaxInfo) const
{
	if (!IsInitialized())
		return;

	// Ensure min tracking size does not exceed the monitor work area or app bounds
	HWND hRef = m_ownerHwnd ? m_ownerHwnd : ::GetDesktopWindow();
	CWnd* pMainWnd = AfxGetMainWnd();
	if (pMainWnd != nullptr && ::IsWindow(pMainWnd->GetSafeHwnd()) && pMainWnd->IsWindowVisible())
	{
		hRef = pMainWnd->GetSafeHwnd();
	}
	HMONITOR hMon = ::MonitorFromWindow(hRef, MONITOR_DEFAULTTONEAREST);
	MONITORINFO mi = { sizeof(MONITORINFO) };
	::GetMonitorInfo(hMon, &mi);
	const CRect rcWork = mi.rcWork;

	constexpr int kMargin = 32;
	int safeMaxMinW = (std::max)(1, static_cast<int>(rcWork.Width()) - kMargin);
	int safeMaxMinH = (std::max)(1, static_cast<int>(rcWork.Height()) - kMargin);

	if (pMainWnd != nullptr && ::IsWindow(pMainWnd->GetSafeHwnd()) && pMainWnd->IsWindowVisible())
	{
		CRect rcMain;
		pMainWnd->GetWindowRect(&rcMain);
		CRect rcIntersect;
		if (rcIntersect.IntersectRect(&rcMain, &rcWork) &&
			rcIntersect.Width() > kMargin && rcIntersect.Height() > kMargin)
		{
			safeMaxMinW = (std::min)(safeMaxMinW, rcIntersect.Width() - kMargin);
			safeMaxMinH = (std::min)(safeMaxMinH, rcIntersect.Height() - kMargin);
		}
	}

	const int effectiveMinW = (std::min)(static_cast<int>(m_minimumWindowSize.cx), safeMaxMinW);
	const int effectiveMinH = (std::min)(static_cast<int>(m_minimumWindowSize.cy), safeMaxMinH);

	minMaxInfo.ptMinTrackSize.x = static_cast<LONG>(effectiveMinW);
	minMaxInfo.ptMinTrackSize.y = static_cast<LONG>(effectiveMinH);
}

void VBimDialogResizeController::ClampAndCenterToApp(CWnd& window)
{
	HWND hWnd = window.GetSafeHwnd();
	if (!::IsWindow(hWnd))
		return;

	// 1. Get reference window to select active monitor (prioritize MainFrame / Owner over unpositioned dialog)
	HWND hRefWnd = hWnd;
	CWnd* pMainWnd = AfxGetMainWnd();
	if (pMainWnd != nullptr && ::IsWindow(pMainWnd->GetSafeHwnd()) && pMainWnd->IsWindowVisible())
	{
		hRefWnd = pMainWnd->GetSafeHwnd();
	}
	else if (CWnd* pOwner = window.GetOwner())
	{
		if (::IsWindow(pOwner->GetSafeHwnd()))
			hRefWnd = pOwner->GetSafeHwnd();
	}

	HMONITOR hMon = ::MonitorFromWindow(hRefWnd, MONITOR_DEFAULTTONEAREST);
	MONITORINFO mi = { sizeof(MONITORINFO) };
	::GetMonitorInfo(hMon, &mi);
	const CRect rcWork = mi.rcWork; // Excludes Taskbar

	// 2. Query application window bounds (CMainFrame) intersected with monitor work area
	CRect rcApp = rcWork;
	if (pMainWnd != nullptr && ::IsWindow(pMainWnd->GetSafeHwnd()) && pMainWnd->IsWindowVisible())
	{
		CRect rcMain;
		pMainWnd->GetWindowRect(&rcMain);
		CRect rcIntersect;
		if (rcIntersect.IntersectRect(&rcMain, &rcWork) &&
			rcIntersect.Width() >= 360 && rcIntersect.Height() >= 240)
		{
			rcApp = rcIntersect;
		}
	}

	// 3. Safety margins from screen / taskbar boundaries (16px)
	constexpr int kSafetyMarginX = 16;
	constexpr int kSafetyMarginY = 16;

	CRect rcDlg;
	window.GetWindowRect(&rcDlg);
	int targetW = rcDlg.Width();
	int targetH = rcDlg.Height();
	bool bSizeChanged = false;

	const DWORD dwStyle = window.GetStyle();
	const bool bResizable = (dwStyle & WS_THICKFRAME) != 0;

	// Only limit dimensions against monitor work area rcWork and only shrink when window has WS_THICKFRAME
	if (bResizable)
	{
		const int maxWorkW = (std::max)(1, static_cast<int>(rcWork.Width()) - kSafetyMarginX * 2);
		const int maxWorkH = (std::max)(1, static_cast<int>(rcWork.Height()) - kSafetyMarginY * 2);

		if (targetW > maxWorkW)
		{
			targetW = maxWorkW;
			bSizeChanged = true;
		}
		if (targetH > maxWorkH)
		{
			targetH = maxWorkH;
			bSizeChanged = true;
		}
	}

	// Center relative to rcApp
	int posX = rcApp.left + (rcApp.Width() - targetW) / 2;
	int posY = rcApp.top + (rcApp.Height() - targetH) / 2;

	// Clamp position strictly within monitor work area (never overlapping Taskbar)
	if (posX + targetW > rcWork.right - kSafetyMarginX)
		posX = rcWork.right - kSafetyMarginX - targetW;
	if (posX < rcWork.left + kSafetyMarginX)
		posX = rcWork.left + kSafetyMarginX;

	if (posY + targetH > rcWork.bottom - kSafetyMarginY)
		posY = rcWork.bottom - kSafetyMarginY - targetH;
	if (posY < rcWork.top + kSafetyMarginY)
		posY = rcWork.top + kSafetyMarginY;

	window.SetWindowPos(nullptr, posX, posY, targetW, targetH,
		SWP_NOZORDER | SWP_NOACTIVATE | (bSizeChanged ? 0 : SWP_NOSIZE));
}

bool VBimDialogResizeController::IsInitialized() const
{
	return ::IsWindow(m_ownerHwnd)
		&& m_initialClientSize.cx > 0
		&& m_initialClientSize.cy > 0;
}

CRect VBimDialogResizeController::CalculateTargetRect(
	const CapturedControl& control,
	int deltaX,
	int deltaY) const
{
	CRect target = control.rect;
	const VBimDialogAnchor anchors = control.rule.anchors;
	const bool left = HasVBimDialogAnchor(anchors, VBimDialogAnchor::Left);
	const bool top = HasVBimDialogAnchor(anchors, VBimDialogAnchor::Top);
	const bool right = HasVBimDialogAnchor(anchors, VBimDialogAnchor::Right);
	const bool bottom = HasVBimDialogAnchor(anchors, VBimDialogAnchor::Bottom);

	if (right)
	{
		if (left)
			target.right += deltaX;
		else
			target.OffsetRect(deltaX, 0);
	}

	if (bottom)
	{
		if (top)
			target.bottom += deltaY;
		else
			target.OffsetRect(0, deltaY);
	}

	target.right = target.left + std::max(1, static_cast<int>(target.Width()));
	target.bottom = target.top + std::max(1, static_cast<int>(target.Height()));
	return target;
}

// ── CVBimDialog Implementation ──────────────────────────────────────────────

IMPLEMENT_DYNAMIC(CVBimDialog, CDialogEx)

BEGIN_MESSAGE_MAP(CVBimDialog, CDialogEx)
	ON_WM_SIZE()
	ON_WM_GETMINMAXINFO()
	ON_WM_DESTROY()
	ON_MESSAGE(WM_VBIM_DIALOG_DEFERRED_INIT, &CVBimDialog::OnDeferredInit)
END_MESSAGE_MAP()

CVBimDialog::CVBimDialog()
	: CDialogEx()
{
}

CVBimDialog::CVBimDialog(UINT nIDTemplate, CWnd* pParent)
	: CDialogEx(nIDTemplate, pParent)
{
}

CVBimDialog::~CVBimDialog()
{
}

const std::vector<VBimDialogResizeRule>& CVBimDialog::GetResizeRules() const
{
	return m_resizeRules;
}

void CVBimDialog::ClampAndCenterToApp()
{
	VBimDialogResizeController::ClampAndCenterToApp(*this);
}

BOOL CVBimDialog::OnInitDialog()
{
	const BOOL bResult = CDialogEx::OnInitDialog();
	PostMessage(WM_VBIM_DIALOG_DEFERRED_INIT);
	return bResult;
}

LRESULT CVBimDialog::OnDeferredInit(WPARAM /*wParam*/, LPARAM /*lParam*/)
{
	m_resizeController.Initialize(*this, *this);
	ClampAndCenterToApp();
	return 0;
}

void CVBimDialog::OnSize(UINT nType, int cx, int cy)
{
	CDialogEx::OnSize(nType, cx, cy);
	m_resizeController.OnSize(nType, cx, cy);
}

void CVBimDialog::OnGetMinMaxInfo(MINMAXINFO* lpMMI)
{
	CDialogEx::OnGetMinMaxInfo(lpMMI);
	if (lpMMI != nullptr)
	{
		m_resizeController.OnGetMinMaxInfo(*lpMMI);
	}
}

void CVBimDialog::OnDestroy()
{
	m_resizeController.Reset();
	CDialogEx::OnDestroy();
}

