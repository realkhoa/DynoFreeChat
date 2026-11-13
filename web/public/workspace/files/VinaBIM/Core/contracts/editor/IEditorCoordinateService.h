#pragma once

#include "Infrastructure/Oda/sdk_includes/odBm.h"

/** UCS, planes, and WCS/UCS projection helpers tied to the active viewport. */
class IEditorCoordinateService
{
public:
	virtual ~IEditorCoordinateService() = default;

virtual OdGePlane getUcsPlane(OdBmObjectPtr pVpObj) = 0;
	virtual OdGePoint3d getPointUcsToPlane(OdGePoint3d wcsPt) = 0;
	virtual OdGePoint3d getLastPoint() = 0;
};
