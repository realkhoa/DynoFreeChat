// VBimTaskDialogOptions.h
//
// Input and output of VBimTaskDialogService::ShowAdvanced(), the SDK
// counterpart of a fully configured Revit TaskDialog (main instruction,
// command links, expanded text, footer, verification check box).
// Plain data only: no MFC, HWND or TASKDIALOGCONFIG types.
//
// Include through VBimTaskDialogService.h, which defines VBimTaskDialogIcon
// and VBimTaskDialogResult before including this file.
//
#pragma once

#include "OdString.h"

// Common buttons shown at the bottom of the dialog; combine with |.
// When none is set and no command link is given, OK is shown.
//
enum VBimTaskDialogCommonButtons : unsigned int
{
    kVBimTaskDialogNone   = 0,
    kVBimTaskDialogOk     = 1,
    kVBimTaskDialogYes    = 2,
    kVBimTaskDialogNo     = 4,
    kVBimTaskDialogCancel = 8,
    kVBimTaskDialogRetry  = 16,
};

// Content of an advanced task dialog. All text is plugin data shown as given.
//
struct VBimTaskDialogOptions
{
    static const int kMaxCommandLinks = 4;

    OdString     title;             // Window caption; the application name when empty.
    OdString     mainInstruction;   // Large first line.
    OdString     content;           // Body text under the main instruction.
    OdString     expandedContent;   // Shown after the user expands "details"; hidden when empty.
    OdString     footer;            // Small text at the bottom; hidden when empty.
    OdString     verificationText;  // Check box label (e.g. "Do not show again"); hidden when empty.
    bool         verificationChecked = false;  // Initial check box state.
    OdString     commandLinks[kMaxCommandLinks];  // Large choice buttons; empty entries are skipped.
    unsigned int commonButtons = kVBimTaskDialogNone;  // VBimTaskDialogCommonButtons flags.
    VBimTaskDialogIcon icon = VBimTaskDialogIcon::None;
    bool         allowCancellation = true;  // Esc / title-bar close allowed (result Cancel).
};

// What the user chose in an advanced task dialog.
//
struct VBimTaskDialogResponse
{
    // Ok / Cancel / Yes / No / Retry for a common button, CommandLink1..4 for a
    // command link, Cancel for Esc or close.
    VBimTaskDialogResult result = VBimTaskDialogResult::None;

    // Final state of the verification check box.
    bool verificationChecked = false;
};
