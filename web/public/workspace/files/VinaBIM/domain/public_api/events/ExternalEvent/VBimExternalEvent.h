// VBimExternalEvent.h
//
// Modeless / worker-thread entry into VinaBIM, analogous to Revit's
// IExternalEventHandler + ExternalEvent.
//
// A plugin registers a handler once (UI thread), then calls
// VBimUIApplication::RaiseExternalEvent(id) from any thread — typically a
// modeless dialog or a worker. The Host runs Execute() later on the UI thread
// at an idle point where no command is running and no document is loading.
//
#pragma once

#include "../../VinaBIMApiExport.h"

class VBimUIApplication;

// Identifier returned by VBimUIApplication::RegisterExternalEvent().
// 0 is never a valid id.
//
using VBimExternalEventId = unsigned long long;

// Plugin-implemented callback for an external event.
//
class IVBimExternalEventHandler
{
public:
    virtual ~IVBimExternalEventHandler() = default;

    // Runs once per raised request on the UI thread at a safe idle point.
    // May show UI and read / write the database; opens its own OdBmTransaction
    // for writes. An exception escaping Execute() is caught and logged by the
    // Host; the registration stays valid.
    //
    virtual void Execute(VBimUIApplication& app) = 0;
};
