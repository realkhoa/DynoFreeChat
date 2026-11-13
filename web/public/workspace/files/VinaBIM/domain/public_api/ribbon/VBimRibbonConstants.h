/**
 * @file VBimRibbonConstants.h
 * @brief Standard constants for default VinaBIM Ribbon Tabs and Panels / Groups.
 *
 * Exposes canonical string identifiers for built-in application tabs and panels,
 * allowing SDK commands and plugin developers to target standard ribbon locations.
 */

#pragma once

namespace VBimRibbon
{

namespace Tabs
{
    // Common / Global Tabs
    constexpr const wchar_t* Home            = L"Home";
    constexpr const wchar_t* Toolbars        = L"ToolBars";
    constexpr const wchar_t* VinaBimPlus     = L"VinaBIM Plus";
    constexpr const wchar_t* VinaCde         = L"VinaCDE";
    constexpr const wchar_t* IfcVisualize    = L"IFC and Visualize";
    constexpr const wchar_t* ClashDetect     = L"Clash Detect";

    // Model (RVT Project) Tabs
    constexpr const wchar_t* Architecture    = L"Architecture";
    constexpr const wchar_t* Structure       = L"Structure";
    constexpr const wchar_t* Steel           = L"Steel";
    constexpr const wchar_t* Precast         = L"Precast";
    constexpr const wchar_t* Systems         = L"Systems";
    constexpr const wchar_t* InsertModel     = L"Insert";
    constexpr const wchar_t* AnnotateModel   = L"Annotate";
    constexpr const wchar_t* Analyze         = L"Analyze";
    constexpr const wchar_t* MassingSite     = L"Massing & Site";
    constexpr const wchar_t* ViewModel       = L"View";
    constexpr const wchar_t* Collaborate     = L"Collaborate";
    constexpr const wchar_t* Manage          = L"Manage";
    constexpr const wchar_t* AddIns          = L"Add-Ins";
    constexpr const wchar_t* ModifyModel     = L"Modify";

    // Family (RFA Editor) Tabs
    constexpr const wchar_t* CreateFamily    = L"Create";
    constexpr const wchar_t* InsertFamily    = L"Insert";
    constexpr const wchar_t* AnnotateFamily  = L"Annotate";
    constexpr const wchar_t* ViewFamily      = L"View";
    constexpr const wchar_t* ModifyFamily    = L"Modify";
} // namespace Tabs

namespace Panels
{
    // General / Common Panels
    constexpr const wchar_t* Window          = L"Window";
    constexpr const wchar_t* Commands        = L"Commands";
    constexpr const wchar_t* Properties      = L"Properties";
    constexpr const wchar_t* Windows         = L"Windows";
    constexpr const wchar_t* Cloud           = L"Cloud";
    constexpr const wchar_t* Automation      = L"Automation";
    constexpr const wchar_t* Clash           = L"Clash Detection";
    constexpr const wchar_t* Manage          = L"Manage";

    // Modeling & Construction Panels
    constexpr const wchar_t* Build           = L"Build";
    constexpr const wchar_t* Circulation     = L"Circulation";
    constexpr const wchar_t* Model           = L"Model";
    constexpr const wchar_t* ModelText       = L"Model Text";
    constexpr const wchar_t* RoomArea        = L"Room & Area";
    constexpr const wchar_t* Opening         = L"Opening";
    constexpr const wchar_t* WorkPlane       = L"Work Plane";
    constexpr const wchar_t* FamilyEditor    = L"Family Editor";

    // Annotation & Drafting Panels
    constexpr const wchar_t* Dimension       = L"Dimension";
    constexpr const wchar_t* Detail          = L"Detail";
    constexpr const wchar_t* Text            = L"Text";
    constexpr const wchar_t* Tag             = L"Tag";

    // Import / Link Panels
    constexpr const wchar_t* Link            = L"Link";
    constexpr const wchar_t* Import          = L"Import";

    // View & Composition Panels
    constexpr const wchar_t* Graphics        = L"Graphics";
    constexpr const wchar_t* Create          = L"Create";
    constexpr const wchar_t* Schedule        = L"Schedule";
    constexpr const wchar_t* SheetComposition= L"Sheet Composition";

    // Analyze Panels
    constexpr const wchar_t* CheckSystems    = L"Check Systems";

    // Modify Panels
    constexpr const wchar_t* Modify          = L"Modify";
    constexpr const wchar_t* Geometry        = L"Geometry";
} // namespace Panels

/**
 * @brief Canonical ordering priorities for Ribbon Tabs.
 *
 * Defines explicit ordering weights for all standard built-in tabs and plugin tabs.
 * Lower numerical values appear earlier (left-to-right).
 */
namespace TabOrders
{
    // Canonical Built-in Tab Priorities
    constexpr int Home            = 100;   ///< Home common tab.
    constexpr int Toolbars        = 200;   ///< Home toolbar tab.
    constexpr int CreateFamily    = 300;   ///< Family editor create tab.
    constexpr int InsertFamily    = 400;   ///< Family editor insert tab.
    constexpr int AnnotateFamily  = 500;   ///< Family editor annotate tab.
    constexpr int ViewFamily      = 600;   ///< Family editor view tab.
    constexpr int ModifyFamily    = 700;   ///< Family editor modify tab.
    constexpr int Architecture    = 800;   ///< Model Architecture tab.
    constexpr int Structure       = 900;   ///< Model Structure tab.
    constexpr int Steel           = 1000;  ///< Model Steel tab.
    constexpr int Precast         = 1100;  ///< Model Precast tab.
    constexpr int Systems         = 1200;  ///< Model Systems (MEP) tab.
    constexpr int InsertModel     = 1300;  ///< Model Insert tab.
    constexpr int AnnotateModel   = 1400;  ///< Model Annotate tab.
    constexpr int Analyze         = 1500;  ///< Model Analyze tab.
    constexpr int MassingSite     = 1600;  ///< Model Massing & Site tab.
    constexpr int ViewModel       = 1700;  ///< Model View tab.
    constexpr int Collaborate     = 1800;  ///< Model Collaborate tab.
    constexpr int Manage          = 1900;  ///< Model Manage tab.
    constexpr int AddIns          = 2000;  ///< Model Add-Ins tab.
    constexpr int ModifyModel     = 2100;  ///< Model Modify tab.
    constexpr int VinaBimPlus     = 2200;  ///< VinaBIM Plus common extension tab.
    constexpr int VinaCde         = 2300;  ///< VinaCDE cloud integration tab.
    constexpr int IfcVisualize    = 2400;  ///< IFC and Visualize tab.
    constexpr int ClashDetect     = 2500;  ///< Clash Detection tab.

    // Plugin Tab Priority Tiers
    constexpr int DefaultPlugin   = 3000;  ///< Default priority for external plugin tabs (placed after built-in tabs).
    constexpr int EndOfRibbon     = 10000; ///< Explicit priority guaranteeing placement at the far end of the ribbon bar.
} // namespace TabOrders

} // namespace VBimRibbon
