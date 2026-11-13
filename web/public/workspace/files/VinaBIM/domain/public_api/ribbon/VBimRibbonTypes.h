/**
 * @file VBimRibbonTypes.h
 * @brief Public ribbon data types for VinaBIM SDK and external plugin developers.
 *
 * ABI-safe equivalent of host ribbon definitions using @c OdString and domain types.
 * Free of MFC, Windows, and GUI headers. Forward-declares Win32 opaque handles (HICON, HDC)
 * so consumers do not need <windows.h> unless using procedural drawing (VBimRibbonGdi.h).
 */

#pragma once

#include <vector>
#include "../VinaBIMApiExport.h"
#include "OdString.h"
#include "VBimRibbonConstants.h"

#ifndef _WINDEF_
struct HICON__; typedef struct HICON__* HICON;
struct HDC__; typedef struct HDC__* HDC;
#endif

namespace VBimRibbon
{

/**
 * @enum ButtonSize
 * @brief Button size preference for ribbon layout.
 */
enum class ButtonSize
{
    Small,   ///< 16x16 icon.
    Medium,  ///< 24x24 icon.
    Large    ///< 32x32 icon (auto-collapses to 16x16 when responsive).
};

/**
 * @enum ButtonKind
 * @brief Type of button presentation in ribbon panels.
 */
enum class ButtonKind
{
    Button,           ///< Standard push button.
    SplitButton,      ///< Primary action with dropdown list.
    Dropdown,         ///< Menu dropdown.
    Toggle,           ///< Checkable toggle button.
    CheckBox = Toggle,///< Checkable toggle button (backward compatibility alias).
    RadioButtonGroup, ///< Group of mutually exclusive radio buttons (subItems = choices).
    ComboBox,         ///< Dropdown list (comboItems); value changes reach IVBimRibbonControlHandler.
    TextBox,          ///< Text input box; the value reaches IVBimRibbonControlHandler on Enter.
    Separator,        ///< Visual separator line.
    SlideOut,         ///< Slideout panel separator marker. Not supported: the MFC ribbon has no slide-out panel.
    CommandInput,     ///< Push button that sends commandName as input to the command waiting for input
                      ///< (VBimUIApplication::SubmitCommandInput) instead of starting a command; e.g. Finish.
                      ///< Enabled only while a command waits for input. Appended last to keep enum values stable.
    ButtonGroup       ///< Group of compact small buttons (e.g. Draw gallery/palette) displayed in a CMFCRibbonButtonsGroup.
};

/**
 * @enum TabVisibility
 * @brief Contextual visibility rule for ribbon tabs.
 */
enum class TabVisibility
{
    DocumentOnly = 0, ///< Visible whenever an active document (Model or Family) exists.
    Always,           ///< Always visible (including startup / zero-doc screen).
    ModelOnly,        ///< Visible only when editing a project (.rvt) document.
    FamilyOnly        ///< Visible only when editing a family (.rfa) document.
};

/**
 * @struct ButtonDef
 * @brief Definition of a single ribbon button item or control.
 */
struct ButtonDef
{
    OdString              commandName;         ///< Registered ODA command name (e.g. "DIMALIGNED").
    OdString              text;                ///< Button label text.
    OdString              tooltip;             ///< Short tooltip description.
    OdString              longDescription;     ///< Extended tooltip description.
    OdString              iconPath;            ///< Path to icon (.svg, .png, .ico, .bmp).
    OdString              smallIconPath;       ///< Explicit 16x16 icon path (optional).
    OdString              largeIconPath;       ///< Explicit 32x32 icon path (optional).
    unsigned int          iconResId   = 0;     ///< Win32 embedded resource ID (e.g. IDI_*).
    HICON                 hCustomIcon      = nullptr; ///< Direct 32x32 (or default) Win32 icon handle (e.g. from GDI draw or custom source).
    HICON                 hCustomSmallIcon = nullptr; ///< Direct 16x16 Win32 icon handle for compact layouts (e.g. ButtonGroup).
    ButtonSize            size        = ButtonSize::Small; ///< Preferred button size.
    ButtonKind            kind        = ButtonKind::Button;///< Button presentation style.
    bool                  responsive  = true;  ///< Auto-collapse to small icon on narrow window width.
    bool                  visible     = true;  ///< Initial visibility state of button.
    bool                  enabled     = true;  ///< Initial enabled state.
    bool                  checked     = false; ///< Initial checked state (for Toggle/Radio).
    bool                  isStacked   = false; ///< Whether this item is part of a vertical stack.
    bool                  isSlideOut  = false; ///< Whether this item belongs to the slideout panel.
    OdString              groupName;           ///< Radio button group identifier.
    std::vector<ButtonDef> subItems;           ///< Child menu items for SplitButton / Dropdown / RadioButtonGroup.
    std::vector<OdString>  comboItems;         ///< Dropdown options for ComboBox.
    int                   comboSelectedIndex = 0; ///< Initially selected index for ComboBox.
    int                   order              = 0; ///< Ordering priority within panel (lower values appear first).
    OdString              helpUrl;             ///< Opened (URL or file) when the user presses F1 over this item; none when empty.

    /**
     * @brief Helper to construct a compact small button (16x16 icon) suitable for button groups.
     */
    static ButtonDef CreateSmall(const OdString& commandName,
                                 const OdString& text = OD_T(""),
                                 const OdString& tooltip = OD_T(""),
                                 unsigned int iconResId = 0,
                                 const OdString& iconPath = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::Button;
        btn.commandName = commandName;
        btn.text = text;
        btn.tooltip = tooltip;
        btn.iconResId = iconResId;
        btn.iconPath = iconPath;
        btn.size = ButtonSize::Small;
        btn.visible = true;
        btn.enabled = true;
        return btn;
    }

    /**
     * @brief Helper to construct a compact small button with custom Win32/GDI icon handles.
     */
    static ButtonDef CreateSmallWithIcon(const OdString& commandName,
                                         HICON hIcon,
                                         const OdString& text = OD_T(""),
                                         const OdString& tooltip = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::Button;
        btn.commandName = commandName;
        btn.text = text;
        btn.tooltip = tooltip;
        btn.hCustomSmallIcon = hIcon;
        btn.hCustomIcon = hIcon;
        btn.size = ButtonSize::Small;
        btn.visible = true;
        btn.enabled = true;
        return btn;
    }

    /**
     * @brief Helper to construct a standard large button (32x32 icon) with prominent caption.
     */
    static ButtonDef CreateLarge(const OdString& commandName,
                                 const OdString& text,
                                 const OdString& tooltip = OD_T(""),
                                 unsigned int iconResId = 0,
                                 const OdString& iconPath = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::Button;
        btn.commandName = commandName;
        btn.text = text;
        btn.tooltip = tooltip;
        btn.iconResId = iconResId;
        btn.iconPath = iconPath;
        btn.size = ButtonSize::Large;
        btn.visible = true;
        btn.enabled = true;
        return btn;
    }

    /**
     * @brief Helper to construct a standard large button with custom Win32/GDI icon handles.
     */
    static ButtonDef CreateLargeWithIcon(const OdString& commandName,
                                         HICON hIcon,
                                         const OdString& text,
                                         const OdString& tooltip = OD_T(""),
                                         HICON hSmallIcon = nullptr)
    {
        ButtonDef btn;
        btn.kind = ButtonKind::Button;
        btn.commandName = commandName;
        btn.text = text;
        btn.tooltip = tooltip;
        btn.hCustomIcon = hIcon;
        btn.hCustomSmallIcon = hSmallIcon ? hSmallIcon : hIcon;
        btn.size = ButtonSize::Large;
        btn.visible = true;
        btn.enabled = true;
        return btn;
    }
};

/**
 * @struct PanelDef
 * @brief Definition of a panel (group) within a ribbon tab.
 */
struct PanelDef
{
    OdString              name;     ///< Panel caption text.
    std::vector<ButtonDef> buttons; ///< Buttons and controls contained within this panel.
    int                   order = 0;///< Ordering priority within tab (lower values appear first).

    /**
     * @brief Fluent builder to add a standard push button to this panel.
     */
    PanelDef& AddButton(const OdString& commandName,
                        const OdString& text,
                        const OdString& tooltip = OD_T(""),
                        unsigned int iconResId = 0,
                        ButtonSize size = ButtonSize::Large,
                        const OdString& iconPath = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::Button;
        btn.commandName = commandName;
        btn.text = text;
        btn.tooltip = tooltip;
        btn.iconResId = iconResId;
        btn.iconPath = iconPath;
        btn.size = size;
        btn.visible = true;
        btn.enabled = true;
        buttons.push_back(std::move(btn));
        return *this;
    }

    /**
     * @brief Fluent builder to add a compact small button (16x16 icon) to this panel.
     */
    PanelDef& AddSmallButton(const OdString& commandName,
                             const OdString& text = OD_T(""),
                             const OdString& tooltip = OD_T(""),
                             unsigned int iconResId = 0,
                             const OdString& iconPath = OD_T(""))
    {
        buttons.push_back(ButtonDef::CreateSmall(commandName, text, tooltip, iconResId, iconPath));
        return *this;
    }

    /**
     * @brief Fluent builder to add a compact small button with custom GDI/Win32 icon to this panel.
     */
    PanelDef& AddSmallButtonWithIcon(const OdString& commandName,
                                     HICON hIcon,
                                     const OdString& text = OD_T(""),
                                     const OdString& tooltip = OD_T(""))
    {
        buttons.push_back(ButtonDef::CreateSmallWithIcon(commandName, hIcon, text, tooltip));
        return *this;
    }

    /**
     * @brief Fluent builder to add a standard large button (32x32 icon) to this panel.
     */
    PanelDef& AddLargeButton(const OdString& commandName,
                             const OdString& text,
                             const OdString& tooltip = OD_T(""),
                             unsigned int iconResId = 0,
                             const OdString& iconPath = OD_T(""))
    {
        buttons.push_back(ButtonDef::CreateLarge(commandName, text, tooltip, iconResId, iconPath));
        return *this;
    }

    /**
     * @brief Fluent builder to add a standard large button with custom GDI/Win32 icon to this panel.
     */
    PanelDef& AddLargeButtonWithIcon(const OdString& commandName,
                                     HICON hIcon,
                                     const OdString& text,
                                     const OdString& tooltip = OD_T(""),
                                     HICON hSmallIcon = nullptr)
    {
        buttons.push_back(ButtonDef::CreateLargeWithIcon(commandName, hIcon, text, tooltip, hSmallIcon));
        return *this;
    }

    /**
     * @brief Fluent builder to add a compact button group (e.g. Draw palette / gallery) to this panel.
     * @param groupButtons Vector of small buttons to place inside the CMFCRibbonButtonsGroup.
     * @param label Optional heading label preceding the group.
     */
    PanelDef& AddButtonGroup(const std::vector<ButtonDef>& groupButtons, const OdString& label = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::ButtonGroup;
        btn.text = label;
        btn.subItems = groupButtons;
        buttons.push_back(std::move(btn));
        return *this;
    }

    /**
     * @brief Fluent builder to add a command input button (e.g. Finish / Cancel) that feeds the waiting command.
     */
    PanelDef& AddCommandInput(const OdString& commandName,
                             const OdString& text,
                             const OdString& tooltip = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::CommandInput;
        btn.commandName = commandName;
        btn.text = text;
        btn.tooltip = tooltip;
        btn.visible = true;
        btn.enabled = true;
        buttons.push_back(std::move(btn));
        return *this;
    }

    /**
     * @brief Fluent builder to add a checkable toggle / checkbox button.
     */
    PanelDef& AddToggle(const OdString& commandName,
                        const OdString& text,
                        bool checked = false,
                        const OdString& tooltip = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::Toggle;
        btn.commandName = commandName;
        btn.text = text;
        btn.checked = checked;
        btn.tooltip = tooltip;
        btn.visible = true;
        btn.enabled = true;
        buttons.push_back(std::move(btn));
        return *this;
    }

    /**
     * @brief Fluent builder to add a dropdown combobox control.
     */
    PanelDef& AddComboBox(const OdString& commandName,
                          const OdString& text,
                          const std::vector<OdString>& items,
                          int selectedIndex = 0,
                          const OdString& tooltip = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::ComboBox;
        btn.commandName = commandName;
        btn.text = text;
        btn.comboItems = items;
        btn.comboSelectedIndex = selectedIndex;
        btn.tooltip = tooltip;
        btn.visible = true;
        btn.enabled = true;
        buttons.push_back(std::move(btn));
        return *this;
    }

    /**
     * @brief Fluent builder to add a single-line text input box.
     */
    PanelDef& AddTextBox(const OdString& commandName,
                         const OdString& text,
                         const OdString& tooltip = OD_T(""))
    {
        ButtonDef btn;
        btn.kind = ButtonKind::TextBox;
        btn.commandName = commandName;
        btn.text = text;
        btn.tooltip = tooltip;
        btn.visible = true;
        btn.enabled = true;
        buttons.push_back(std::move(btn));
        return *this;
    }

    /**
     * @brief Fluent builder to add a visual separator between items.
     */
    PanelDef& AddSeparator()
    {
        ButtonDef btn;
        btn.kind = ButtonKind::Separator;
        buttons.push_back(std::move(btn));
        return *this;
    }

    /**
     * @brief Fluent builder to add any arbitrary custom button descriptor.
     */
    PanelDef& AddControl(const ButtonDef& btn)
    {
        buttons.push_back(btn);
        return *this;
    }
};

/**
 * @brief Default ordering priority for external plugin tabs (placed after built-in tabs).
 */
constexpr int kDefaultPluginTabOrder = TabOrders::DefaultPlugin;

/**
 * @brief Ordering priority to guarantee placement at the far end of the ribbon bar.
 */
constexpr int kEndOfRibbonTabOrder = TabOrders::EndOfRibbon;

/**
 * @brief Helper creating a standard Revit-style Mode panel with Finish and Cancel buttons.
 * @param finishCmd Keyword sent to waiting command on Finish (default "Finish").
 * @param cancelCmd Keyword sent to waiting command on Cancel (default "Cancel").
 * @return Populated PanelDef configured with ButtonKind::CommandInput buttons.
 */
inline PanelDef CreateModePanel(const OdString& finishCmd = OD_T("Finish"),
                                const OdString& cancelCmd = OD_T("Cancel"))
{
    PanelDef mode;
    mode.name = OD_T("Mode");
    mode.AddCommandInput(finishCmd, finishCmd, OD_T("Finish Edit Mode"));
    mode.AddCommandInput(cancelCmd, cancelCmd, OD_T("Cancel Edit Mode"));
    return mode;
}

/**
 * @struct TabDef
 * @brief Definition of a ribbon tab contributed by an SDK plugin or module.
 */
struct TabDef
{
    OdString              name;                ///< Tab label.
    std::vector<PanelDef> panels;              ///< Panels in this tab.
    TabVisibility         visibility   = TabVisibility::DocumentOnly; ///< Contextual visibility rule.
    int                   order        = kDefaultPluginTabOrder;      ///< Ordering priority (lower values appear first).
    bool                  isContextual = false;///< Whether this tab is contextual.
    OdString              contextId;           ///< Context identifier.
    OdString              returnTab;           ///< Tab to return to when context ends.

    /**
     * @brief Adds a new panel to this tab definition and returns a reference for chaining.
     * @param panelName Panel caption.
     * @param panelOrder Relative panel ordering priority.
     * @return Reference to created PanelDef.
     */
    PanelDef& AddPanel(const OdString& panelName, int panelOrder = 0)
    {
        PanelDef panel;
        panel.name = panelName;
        panel.order = panelOrder;
        panels.push_back(std::move(panel));
        return panels.back();
    }

    /**
     * @brief Appends a standard Revit-style Mode panel with Finish and Cancel buttons.
     * @param finishCmd Keyword sent to waiting command on Finish (default "Finish").
     * @param cancelCmd Keyword sent to waiting command on Cancel (default "Cancel").
     * @return Reference to self for chaining.
     */
    TabDef& AddModePanel(const OdString& finishCmd = OD_T("Finish"),
                         const OdString& cancelCmd = OD_T("Cancel"))
    {
        panels.push_back(CreateModePanel(finishCmd, cancelCmd));
        return *this;
    }
};

/**
 * @brief Receives value changes of plugin ComboBox, TextBox and RadioButtonGroup items.
 *
 * Register with VBimUIApplication::RegisterRibbonControlHandler() using the item's
 * commandName as control id. Called on the UI thread from the ribbon command
 * routing (an active document is required, as for plugin buttons). Must not run a
 * nested command; queue one with VBimUIApplication::RequestPostCommand() instead.
 * An exception is caught and logged by the Host.
 */
class IVBimRibbonControlHandler
{
public:
    virtual ~IVBimRibbonControlHandler() = default;

    /**
     * @brief Called after the user changed a value control.
     * @param controlId commandName of the ComboBox / TextBox / CheckBox / RadioButtonGroup item.
     * @param value Selected combo text, edited text, "1"/"0" for a CheckBox (Toggle), or commandName
     *        of the chosen radio sub item. A CheckBox reports here only while a handler is registered
     *        for it; without one, clicking it runs commandName as a command.
     */
    virtual void OnValueChanged(const OdString& controlId, const OdString& value) = 0;
};

/**
 * @brief Receives the stable key of the item the user chose in a keyed ComboBox.
 *
 * Fill the combo with VBimUIApplication::SetRibbonComboKeyedItems() and register
 * with VBimUIApplication::RegisterRibbonComboKeyHandler(). Unlike
 * IVBimRibbonControlHandler (which receives the label), two items with the same
 * label are told apart. Called on the UI thread after a user choice only, never
 * for a selection set by the plugin. An exception is caught and logged by the Host.
 * The handler is borrowed: remove it (nullptr) before destroying it.
 */
class IVBimRibbonComboKeyHandler
{
public:
    virtual ~IVBimRibbonComboKeyHandler() = default;

    /**
     * @brief Called after the user chose an item of a keyed ComboBox.
     * @param controlId commandName of the ComboBox item.
     * @param key Key given for the chosen item in SetRibbonComboKeyedItems().
     */
    virtual void OnComboKeyChanged(const OdString& controlId, const OdString& key) = 0;
};

} // namespace VBimRibbon

#include "VBimRibbonGdi.h"
