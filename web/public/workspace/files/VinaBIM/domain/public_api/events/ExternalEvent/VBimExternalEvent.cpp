#include "pch.h"
#include "domain/public_api/app/VBimUIApplication.h"
#include "Host/sdk/ExternalEvent/VBimExternalEventDispatcher.h"

// VBimUIApplication external event members. Kept beside the public
// IVBimExternalEventHandler contract; the queue itself is Host-owned.

VBimExternalEventId VBimUIApplication::RegisterExternalEvent(IVBimExternalEventHandler* handler)
{
    return VBimExternalEventDispatcher::Register(handler);
}

OdResult VBimUIApplication::RaiseExternalEvent(VBimExternalEventId id) noexcept
{
    return VBimExternalEventDispatcher::Raise(id);
}

void VBimUIApplication::UnregisterExternalEvent(VBimExternalEventId id) noexcept
{
    VBimExternalEventDispatcher::Unregister(id);
}
