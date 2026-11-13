#pragma once

#include "Infrastructure/Oda/sdk_includes/odBm.h"

/** Read-only element collection against the active database (no interactive pick). */
class IEditorDocumentQueryService
{
public:
	virtual ~IEditorDocumentQueryService() = default;

	virtual int selectAllIdFamilySymbol(OdBmElementPtrArray& elemSymbols) = 0;
	virtual int selectAllIdFamilySymbolByCategory(OdBmElementPtrArray& elemSymbols, OdBmObjectId idCategory) = 0;
	virtual int selectElementsByCategoryAndClass(OdBmElementPtrArray& elemElements, OdBmObjectId idCategory, const OdTfClass* pClass) = 0;
	virtual int selectAllIdFamily(OdBmElementPtrArray& elemFamilyArr) = 0;
	virtual int findElementsByClass(const OdTfClass* pClass, OdBmElementPtrArray& idElements) = 0;
	virtual OdBmElementPtrArray selectFamilySymbolsByComponent() = 0;
};
