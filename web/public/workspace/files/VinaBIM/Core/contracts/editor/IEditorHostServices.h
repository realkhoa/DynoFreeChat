#pragma once

#include "IEditorCoordinateService.h"
#include "IEditorDocumentQueryService.h"
#include "IEditorShellService.h"
#include "../ui/IFileDialogService.h"
#include "../ui/IPropertiesPanelHost.h"
#include "IRegenService.h"
#include "../selection/ISelectionService.h"

/** Aggregate of editor Host ports; default implementation lives in VbimHostEditorServicesImpl.cpp. */
class IEditorHostServices
	: public ISelectionService
	, public IRegenService
	, public IFileDialogService
	, public IEditorCoordinateService
	, public IEditorDocumentQueryService
	, public IEditorShellService
	, public IPropertiesPanelHost
{
public:
	~IEditorHostServices() override = default;
};
