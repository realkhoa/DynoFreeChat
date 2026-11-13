#pragma once

#include "Infrastructure/Oda/sdk_includes/odBm.h"
#include <OdString.h>

/** Ribbon, status line, property-browser bridge, app paths (Host shell). */
class IEditorShellService
{
public:
	virtual ~IEditorShellService() = default;

	virtual void activateModifyTab() = 0;
	virtual void setStatusText(const OdString& text) = 0;
	virtual void updateFamilyBrowser() = 0;
	virtual bool getComponentActionTrigger() = 0;
	virtual void setComponentActionTrigger(bool enabled) = 0;
	virtual OdBmObjectId getFamilySymbolIdFromProperties() = 0;
	virtual void setFamilySymbolIdFromProperties(OdBmObjectId id) = 0;
	virtual void setFamilySymbolIdFromPropertiesNull() = 0;
	virtual OdString getAppFolder() = 0;

	/** Called while an entity is being edited/dragged and its type changed.
	 *  Host should refresh only the property grid — must NOT touch the type bar. */
	virtual void notifyEntityChanged(OdBmObjectId id) = 0;

	/** Called after a new entity has been successfully committed to the database.
	 *  Host should refresh the Properties panel to display the placed entity. */
	virtual void notifyEntityPlaced(OdBmObjectId id) = 0;
};
