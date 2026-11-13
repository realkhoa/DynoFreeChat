#pragma once
#include "Infrastructure/Oda/sdk_includes/odBm.h"

/// Focused contract for Properties panel event routing.
/// Implemented by VbimHostEditorServicesImpl, which delegates to PropertiesPanelCoordinator.
/// Event sources (CVinaBIMView, CVinaBIMDoc) call this instead of GetMainFrame() directly.
class IPropertiesPanelHost
{
public:
    virtual ~IPropertiesPanelHost() = default;

    // Notify the Properties panel that the active selection has changed.
    // Called from CVinaBIMView pick-first and from PrepareForViewDeactivation
    // (which passes a null id when the ODA selection is cleared on deactivation).
    //
    // Null id: selection cleared — panel falls back to the active view's
    // properties (Revit parity). The implementation routes through the deferred
    // sync path (IsReadyForPropertiesSync gate + up to 5 retries) so it is safe
    // to call mid-view-transition when the render device is not yet bound.
    //
    // Non-null id: panel is updated for the selected BIM element.
    //
    // Debug logging in the implementation is wrapped in try/catch(OdError) so
    // an ODA exception during element inspection never blocks the update path.
    // Must be called from the UI thread.
    virtual void onSelectionChanged(OdBmObjectId id) = 0;

    /// Component ribbon button / toolbar triggered placement flow.
    virtual void beginComponentPlacement() = 0;
};
