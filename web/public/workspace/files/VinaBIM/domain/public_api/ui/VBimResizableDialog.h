// VBimResizableDialog.h
//
// Dialog resizing API for VinaBIM SDK developers.
//
// Provides a unified resizable dialog contract and layout controller
// exported via VINABIMCORE_DLLEXPORT.
//
#pragma once

#include "../VinaBIMApiExport.h"

#include <afxwin.h>
#include <afxdialogex.h>
#include <vector>

// Specifies which edges of a dialog client area a control attaches to.
// Bitwise combinations are allowed (e.g. Left | Right stretches horizontally).
enum class VBimDialogAnchor : unsigned int
{
	None   = 0,
	Left   = 1 << 0,
	Top    = 1 << 1,
	Right  = 1 << 2,
	Bottom = 1 << 3
};

constexpr VBimDialogAnchor operator|(VBimDialogAnchor left, VBimDialogAnchor right)
{
	return static_cast<VBimDialogAnchor>(
		static_cast<unsigned int>(left) | static_cast<unsigned int>(right));
}

constexpr bool HasVBimDialogAnchor(VBimDialogAnchor value, VBimDialogAnchor anchor)
{
	return (static_cast<unsigned int>(value) & static_cast<unsigned int>(anchor)) != 0;
}

// Defines resizing behavior for a single child control ID.
struct VBimDialogResizeRule
{
	int controlId;
	VBimDialogAnchor anchors;
};

/**
 * @brief Interface implemented by dialogs that support dynamic co-resizing.
 */
class VINABIMCORE_DLLEXPORT IVBimResizableDialog
{
public:
	virtual ~IVBimResizableDialog() = default;

	/**
	 * @brief Returns stable control IDs and anchors used for the dialog lifetime.
	 */
	virtual const std::vector<VBimDialogResizeRule>& GetResizeRules() const = 0;
};

/**
 * @brief Reusable controller managing control layout recalculation and viewport safety on window resize.
 */
class VINABIMCORE_DLLEXPORT VBimDialogResizeController
{
public:
	/**
	 * @brief Captures initial dialog and child control geometries as resize baseline.
	 * Call once at the end of OnInitDialog.
	 * @param owner Reference to the owner dialog window.
	 * @param dialog Interface providing resize rules.
	 * @return true if initialized successfully.
	 */
	bool Initialize(CWnd& owner, const IVBimResizableDialog& dialog);

	/**
	 * @brief Releases captured window handles and baseline dimensions.
	 * Call in dialog's OnDestroy or when the dialog window is destroyed.
	 */
	void Reset();

	/**
	 * @brief Recalculates and repositions child controls during WM_SIZE.
	 * @param sizeType Resize type flag (e.g. SIZE_RESTORED).
	 * @param clientWidth New client width.
	 * @param clientHeight New client height.
	 * @return true if handled successfully.
	 */
	bool OnSize(UINT sizeType, int clientWidth, int clientHeight);

	/**
	 * @brief Restricts window shrinking below initial captured window dimensions while respecting monitor work area.
	 * @param minMaxInfo Reference to MINMAXINFO structure.
	 */
	void OnGetMinMaxInfo(MINMAXINFO& minMaxInfo) const;

	/**
	 * @brief Clamps window dimensions to fit within the main application window and monitor work area (excluding Taskbar).
	 * Repositions and centers the window safely with a 16px safety margin above the Taskbar.
	 * @param window Reference to the window to clamp and center.
	 */
	static void ClampAndCenterToApp(CWnd& window);

	/**
	 * @brief Returns true if owner window baseline is captured and valid.
	 */
	bool IsInitialized() const;

private:
	struct CapturedControl
	{
		VBimDialogResizeRule rule;
		CRect rect;
	};

	CRect CalculateTargetRect(const CapturedControl& control, int deltaX, int deltaY) const;

	HWND m_ownerHwnd = nullptr;
	CSize m_initialClientSize;
	CSize m_minimumWindowSize;
	std::vector<CapturedControl> m_controls;
};

/**
 * @class CVBimDialog
 * @brief Modern base dialog class for VinaBIM Public API with auto-clamping & resizing support.
 *
 * Provides:
 * 1. Automatic viewport and application window bounding (never bleeds onto Windows Taskbar).
 * 2. Automatic child control resizing via IVBimResizableDialog rules.
 * 3. Safe min-tracking enforcement.
 */
class VINABIMCORE_DLLEXPORT CVBimDialog : public CDialogEx, public IVBimResizableDialog
{
	DECLARE_DYNAMIC(CVBimDialog)

public:
	/** @brief Default constructor. */
	CVBimDialog();

	/**
	 * @brief Constructor with template ID and optional parent.
	 * @param nIDTemplate Dialog resource ID.
	 * @param pParent Optional parent window pointer.
	 */
	CVBimDialog(UINT nIDTemplate, CWnd* pParent = nullptr);

	/** @brief Virtual destructor. */
	virtual ~CVBimDialog();

	/**
	 * @brief Retrieves the resizing rules for child controls.
	 * Subclasses override this to register responsive control anchors.
	 * @return Reference to vector of resize rules.
	 */
	const std::vector<VBimDialogResizeRule>& GetResizeRules() const override;

	/**
	 * @brief Clamps dialog dimensions to fit inside the application window and monitor work area (excluding Taskbar).
	 */
	void ClampAndCenterToApp();

public:
	static constexpr UINT WM_VBIM_DIALOG_DEFERRED_INIT = WM_APP + 0x77C;

protected:
	virtual BOOL OnInitDialog() override;

	afx_msg void OnSize(UINT nType, int cx, int cy);
	afx_msg void OnGetMinMaxInfo(MINMAXINFO* lpMMI);
	afx_msg void OnDestroy();
	afx_msg LRESULT OnDeferredInit(WPARAM wParam, LPARAM lParam);

	DECLARE_MESSAGE_MAP()

	VBimDialogResizeController m_resizeController;
	std::vector<VBimDialogResizeRule> m_resizeRules;
};

