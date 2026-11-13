#pragma once

#include "IBimLineElementWriter.h"
#include <memory>

/** Composition root: returns the host-specific writer (ODA in Infrastructure/Oda). */
std::unique_ptr<IBimLineElementWriter> createLineElementWriter();
