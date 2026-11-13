#pragma once

#include "CreateLineElementTypes.h"

/** Infrastructure port: persists a line curve element in the host BIM database (ODA implementation). */
class IBimLineElementWriter
{
public:
	virtual ~IBimLineElementWriter() = default;

	virtual CreateLineElementOutcome createLineElement(
		void* nativeBimDatabase,
		const CreateLineElementRequest& request) = 0;
};
