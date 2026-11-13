// VBimRibbonPluginApi.h
//
// Public plugin ABI for VinaBIM ribbon extension.
// External DLLs that contribute ribbon tabs implement this interface.
//
// Command-name-based equivalent of VbimRibbon::IRibbonPlugin.
//
// ABI notes:
//   - In-process plugin ABI: Plugins must be compiled with the same toolchain (MSVC v143+)
//     and compatible CRT/STL runtime.
//   - OdString and std::vector<TabDef> cross the boundary; this is safe for same-toolchain DLLs.
//   - Exception safety: Methods that cannot fail are marked noexcept. Any std::exception
//     thrown by GetTabDefinitions() (e.g. std::bad_alloc) is caught by the host adapter
//     and cleanly mapped to PluginApiResult::HostUnavailable.
//
// To register a ribbon plugin, export a C function:
//
//   extern "C" __declspec(dllexport)
//   bool __cdecl RegisterVBimRibbonPlugin(VBimRibbon::IRibbonPluginHostApi* pHost);
//
// The host calls this function during startup after the main frame is created.
// See VBIM_RIBBON_PLUGIN_EXPORT_SYMBOL for the exported symbol name.
//
#pragma once

#include "../VinaBIMApiExport.h"
#include "VBimRibbonTypes.h"  // ButtonDef, PanelDef, TabDef

// Export symbol name for the ribbon plugin registration function.
//
#define VBIM_RIBBON_PLUGIN_EXPORT_SYMBOL "RegisterVBimRibbonPlugin"

namespace VBimRibbon
{

class IVBimRibbonPlugin;

// Return codes from IRibbonPluginHostApi operations.
//
// New values may be added in future versions without breaking ABI.
// Callers should treat unknown codes as errors.
//
enum class PluginApiResult : int
{
    Ok                 = 0,
    NullProvider       = 1,  // pPlugin was nullptr
    EmptyProviderId    = 2,  // GetProviderId() returned empty string
    EmptyTabName       = 3,  // A TabDef has an empty name
    EmptyPanelName     = 4,  // A PanelDef has an empty name
    DuplicateProvider  = 5,  // Same provider ID already registered
    DuplicateTab       = 6,  // Tab name already claimed
    DuplicatePanel     = 7,  // (tab, panel) pair already claimed
    DuplicateCommand        = 8,  // commandName already used by another provider
    HostUnavailable         = 9,  // Host API not yet initialized
    UnsupportedButtonKind   = 10, // SlideOut is not supported by RibbonBuilder (no MFC slide-out panel)
};

// Interface passed to the plugin registration function.
// Implemented by VinaBIM's ribbon host (not exposed to plugins).
//
class IRibbonPluginHostApi
{
public:
    virtual ~IRibbonPluginHostApi() = default;

    // Register a plugin. On Ok, host takes ownership. On failure, caller owns.
    // Never throws. providerId must be unique across all registered plugins.
    //
    virtual PluginApiResult RegisterPlugin(IVBimRibbonPlugin* pPlugin) noexcept = 0;

    // Remove a previously registered plugin by provider ID. No-op for unknowns.
    //
    virtual void UnregisterPlugin(const wchar_t* providerId) noexcept = 0;

    // Pre-check helpers. Call before registering to detect conflicts early.
    //
    virtual bool IsTabNameUsed(const wchar_t* tabName) const noexcept = 0;
    virtual bool IsCommandNameUsed(const wchar_t* commandName) const noexcept = 0;
};

// Interface that ribbon plugins implement to register UI elements.
//
class IVBimRibbonPlugin
{
public:
    virtual ~IVBimRibbonPlugin() = default;

    // Unique string ID for this plugin (e.g. "VendorName.PluginName").
    // Used for de-dup and unregister. Never throws.
    //
    virtual const wchar_t* GetProviderId() const noexcept = 0;

    // Returns the tab definitions this plugin contributes.
    // Called during ribbon construction; host caches validated definitions.
    //
    virtual std::vector<TabDef> GetTabDefinitions() const = 0;

    // Relative priority — lower value means earlier in the merged tab list.
    // Return 100 for a typical plugin (built-ins use 0–50).
    //
    virtual int GetPriority() const noexcept = 0;

    // Called by the host before unloading this plugin's DLL.
    // Perform cleanup here. Default is a no-op.
    //
    virtual void OnUnload() noexcept {}
};

} // namespace VBimRibbon
