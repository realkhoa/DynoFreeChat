#pragma once

/** UI dialogs; implementations own dialog classes and DoModal(). Pointers are native ODA/MFC (OdBmDatabase*, OdBmDBView*, CWnd*). */
class IDialogService
{
public:
	virtual ~IDialogService() = default;

	virtual bool showUnhideElements(void* bmDatabase, void* bmDbView) = 0;
	virtual void showFamilyTypesForCurrentModel(void* bmDatabase) = 0;
	virtual bool showFamilyTypesForEditing(void* bmDatabase) = 0;
	virtual void showCannotEditFamily() = 0;
	virtual void showInvalidVisualStyle() = 0;
	virtual void showZoomCommandFailed() = 0;
	/** @return IDOK, IDCANCEL, etc. */
	virtual int showVisibilityGraphics(void* bmDatabase, void* bmDbView, void* parentWnd) = 0;
	virtual void showVisibilityGraphicsError() = 0;
};
