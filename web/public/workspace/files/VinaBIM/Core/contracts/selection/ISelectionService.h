#pragma once

#include "Infrastructure/Oda/sdk_includes/odBm.h"
#include <cstdint>
#include <vector>

/** Interactive selection and point acquisition (Host editor I/O). */
class ISelectionService
{
public:
	virtual ~ISelectionService() = default;

	virtual int entSel(const OdString& str, OdSelectionSetPtr& entres, OdGePoint3d& ptres) = 0;
	virtual int getPoint(const OdGePoint3d* pt, const OdString& prompt, OdGePoint3d& result) = 0;
	virtual int ssGet(const OdString& str, OdBmObjectIdArray& ids) = 0;

	/** Element handles from the pending PickFirst buffer (opaque native object-id handles). */
	virtual std::vector<std::uint64_t> getPickFirst() = 0;

	virtual OdBmObjectIdArray getObjectIdsFromSelectionSet(const OdSelectionSetPtr& pSet) = 0;
	virtual void unselect() = 0;
};
