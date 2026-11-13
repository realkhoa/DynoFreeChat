// IVBimCommandAvailability.h
//
// Per-command availability check for plugin commands, analogous to Revit's
// IExternalCommandAvailability. Attach one with
// VBimUIApplication::SetCommandAvailability() after registering the ODA
// command with odedRegCmds()->addCommand().
//
#pragma once

class VBimUIApplication;

// Plugin-implemented availability check.
//
class IVBimCommandAvailability
{
public:
    virtual ~IVBimCommandAvailability() = default;

    // Returns whether the command may run in the current context (active
    // document, view, selection). Called on the UI thread whenever the ribbon
    // refreshes its buttons and before CanPostCommand / PostCommand /
    // RequestPostCommand run the command, so it must be cheap and read only:
    // no database write, no dialog, no nested command. An exception is logged
    // by the Host and treated as "not available".
    //
    virtual bool IsCommandAvailable(VBimUIApplication& app) const = 0;
};
