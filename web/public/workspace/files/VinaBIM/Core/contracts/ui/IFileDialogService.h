#pragma once

#include "Infrastructure/Oda/sdk_includes/odBm.h"
#include <OdString.h>

/** File picking and model open paths (Host application services). */
class IFileDialogService
{
public:
	virtual ~IFileDialogService() = default;

	virtual OdString pickFamilyFileForLoad() = 0;
	virtual OdBmDatabasePtr openFile(const OdString& path) = 0;
};
