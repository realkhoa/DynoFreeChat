///////////////////////////////////////////////////////////////////////////////
// VinaBIM Native SDK — Public API
// Backward Compatibility Header: VBimSelectionService -> VBimSelection
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "VBimSelection.h"

/**
 * @class VBimSelectionService
 * @brief Backward compatibility subclass for legacy code referencing VBimSelectionService.
 */
class VINABIMCORE_DLLEXPORT VBimSelectionService : public VBimSelection
{
public:
    using VBimSelection::VBimSelection;
    using VBimSelection::Pick;
    using VBimSelection::PickObject;
    using VBimSelection::PickPoint;
    using VBimSelection::GetElementIds;
    using VBimSelection::SetElementIds;
    using VBimSelection::Clear;
};
