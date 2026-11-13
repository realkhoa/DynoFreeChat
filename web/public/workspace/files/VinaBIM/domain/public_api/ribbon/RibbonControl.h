/**
 * @file RibbonControl.h
 * @brief Object-oriented Ribbon API for VinaBIM modeled after Autodesk Revit UI API.
 *
 * Provides a fluent, domain-clean API for dynamically constructing Ribbon Tabs, Panels,
 * PushButtons, SplitButtons, PulldownButtons, ToggleButtons, RadioButtonGroups, ComboBoxes,
 * TextBoxes, Stacked Items, and SlideOut panels with multi-format icon support.
 * Free of MFC and Windows GUI dependencies.
 */

#pragma once

#include <memory>
#include <vector>
#include <string>

#include "OdString.h"
#include "VBimRibbonTypes.h"
#include "VBimRibbonConstants.h"

namespace VBimRibbon
{

class RibbonItem;
class PushButton;
class SplitButton;
class PulldownButton;
class ToggleButton;
class RadioButtonGroup;
class ComboBox;
class TextBox;
class RibbonSeparator;
class RibbonSlideOut;
class RibbonPanel;
class RibbonTab;

/**
 * @enum RibbonItemType
 * @brief Identifies the concrete type of a ribbon element.
 */
enum class RibbonItemType
{
    PushButton,       ///< Standard push button.
    SplitButton,      ///< Split button with default command and dropdown menu.
    PulldownButton,   ///< Menu dropdown without default action.
    ToggleButton,     ///< Checkable toggle button.
    RadioButtonGroup, ///< Mutually exclusive radio button group.
    ComboBox,         ///< Dropdown combobox.
    TextBox,          ///< Single-line text input field.
    Separator,        ///< Panel separator.
    SlideOut          ///< Slideout panel division.
};

/**
 * @class RibbonItemData
 * @brief Base data descriptor for defining ribbon items before instantiation in a panel.
 */
class RibbonItemData
{
public:
    /**
     * @brief Virtual destructor for polymorphic cleanup.
     */
    virtual ~RibbonItemData() = default;

    /**
     * @brief Gets the programmatic unique identifier name of this item.
     * @return Unique item name as OdString.
     */
    OdString GetName() const { return m_name; }

    /**
     * @brief Sets the programmatic unique identifier name of this item.
     * @param name Unique item name.
     */
    void SetName(const OdString& name) { m_name = name; }

    /**
     * @brief Gets the visible display text / label for this item.
     * @return Display text.
     */
    OdString GetText() const { return m_text; }

    /**
     * @brief Sets the visible display text / label for this item.
     * @param text Display text.
     */
    void SetText(const OdString& text) { m_text = text; }

    /**
     * @brief Gets the short tooltip summary text.
     * @return Tooltip text.
     */
    OdString GetToolTip() const { return m_toolTip; }

    /**
     * @brief Sets the short tooltip summary text.
     * @param toolTip Tooltip text.
     */
    void SetToolTip(const OdString& toolTip) { m_toolTip = toolTip; }

    /**
     * @brief Gets the extended detailed description text.
     * @return Long description text.
     */
    OdString GetLongDescription() const { return m_longDescription; }

    /**
     * @brief Sets the extended detailed description text.
     * @param desc Long description text.
     */
    void SetLongDescription(const OdString& desc) { m_longDescription = desc; }

    /**
     * @brief Gets the 32x32 large icon image path.
     * @return Path to large image.
     */
    OdString GetLargeImage() const { return m_largeImage; }

    /**
     * @brief Sets the 32x32 large icon image path.
     * @param imagePath Path or name of the image.
     */
    void SetLargeImage(const OdString& imagePath) { m_largeImage = imagePath; }

    /**
     * @brief Sets the 32x32 large icon from an embedded Win32 resource ID.
     * @param resId Win32 resource identifier (e.g. IDI_*).
     */
    void SetLargeImage(unsigned int resId)
    {
        m_iconResId = resId;
        m_largeImage = OdString((L"#" + std::to_wstring(resId)).c_str());
    }

    /**
     * @brief Gets the 16x16 small icon image path.
     * @return Path to small image.
     */
    OdString GetImage() const { return m_smallImage; }

    /**
     * @brief Sets the 16x16 small icon image path.
     * @param imagePath Path or name of the image.
     */
    void SetImage(const OdString& imagePath) { m_smallImage = imagePath; }

    /**
     * @brief Sets the 16x16 small icon from an embedded Win32 resource ID.
     * @param resId Win32 resource identifier (e.g. IDI_*).
     */
    void SetImage(unsigned int resId)
    {
        m_iconResId = resId;
        m_smallImage = OdString((L"#" + std::to_wstring(resId)).c_str());
    }

    /**
     * @brief Gets the embedded Win32 icon resource ID.
     * @return Resource identifier or 0 if file-based.
     */
    unsigned int GetIconResId() const { return m_iconResId; }

    /**
     * @brief Sets the embedded Win32 icon resource ID.
     * @param resId Resource identifier.
     */
    void SetIconResId(unsigned int resId) { m_iconResId = resId; }

    /**
     * @brief Queries whether the button dynamically collapses between large and small on resize.
     * @return true if responsive; otherwise false.
     */
    bool IsResponsive() const { return m_responsive; }

    /**
     * @brief Sets whether the button dynamically collapses between large and small on resize.
     * @param responsive true to enable responsive layout.
     */
    void SetResponsive(bool responsive) { m_responsive = responsive; }

    /**
     * @brief Queries the initial visibility state of the item.
     * @return true if visible; otherwise false.
     */
    bool IsVisible() const { return m_visible; }

    /**
     * @brief Sets the initial visibility state of the item.
     * @param visible true to show item; false to hide.
     */
    void SetVisible(bool visible) { m_visible = visible; }

    /**
     * @brief Queries the initial enabled state of the item.
     * @return true if enabled; otherwise false.
     */
    bool IsEnabled() const { return m_enabled; }

    /**
     * @brief Sets the initial enabled state of the item.
     * @param enabled true to enable item.
     */
    void SetEnabled(bool enabled) { m_enabled = enabled; }

    /**
     * @brief Queries whether the item is part of a stacked button group.
     * @return true if stacked; otherwise false.
     */
    bool IsStacked() const { return m_isStacked; }

    /**
     * @brief Sets whether the item is part of a stacked button group.
     * @param stacked true to mark as stacked.
     */
    void SetStacked(bool stacked) { m_isStacked = stacked; }

    /**
     * @brief Queries whether the item belongs to the slideout panel section.
     * @return true if inside slideout; otherwise false.
     */
    bool IsSlideOut() const { return m_isSlideOut; }

    /**
     * @brief Sets whether the item belongs to the slideout panel section.
     * @param slideOut true to place inside slideout.
     */
    void SetSlideOut(bool slideOut) { m_isSlideOut = slideOut; }

    /**
     * @brief Queries the ordering priority of this item within the panel.
     * @return Ordering integer (lower values appear first; default 0).
     */
    int GetOrder() const { return m_order; }

    /**
     * @brief Sets the ordering priority of this item within the panel.
     * @param order Ordering integer (lower values appear first).
     */
    void SetOrder(int order) { m_order = order; }

    /**
     * @brief Queries the help target opened when the user presses F1 over this item.
     * @return URL or file path; empty when the item has no contextual help.
     */
    const OdString& GetContextualHelpUrl() const { return m_helpUrl; }

    /**
     * @brief Sets the help target (URL or file path) opened on F1 over this item.
     * @param url Help target; empty removes contextual help.
     */
    void SetContextualHelpUrl(const OdString& url) { m_helpUrl = url; }

    /**
     * @brief Retrieves the polymorphic item type classification.
     * @return RibbonItemType enum value.
     */
    virtual RibbonItemType GetItemType() const = 0;

protected:
    /**
     * @brief Protected constructor for derived descriptor initialization.
     * @param name Unique item name.
     * @param text Display text.
     */
    RibbonItemData(const OdString& name, const OdString& text)
        : m_name(name)
        , m_text(text)
        , m_iconResId(0)
        , m_responsive(true)
        , m_visible(true)
        , m_enabled(true)
        , m_isStacked(false)
        , m_isSlideOut(false)
        , m_order(0)
    {
    }

    OdString     m_name;
    OdString     m_text;
    OdString     m_toolTip;
    OdString     m_longDescription;
    OdString     m_largeImage;
    OdString     m_smallImage;
    unsigned int m_iconResId;
    bool         m_responsive;
    bool         m_visible;
    bool         m_enabled;
    bool         m_isStacked;
    bool         m_isSlideOut;
    int          m_order;
    OdString     m_helpUrl;
};

/**
 * @class PushButtonData
 * @brief Data descriptor for standard push buttons bound to ODA commands.
 */
class PushButtonData : public RibbonItemData
{
public:
    /**
     * @brief Constructs push button data from parameters.
     * @param name Unique item name.
     * @param text Display label.
     * @param commandName Registered ODA global command name.
     */
    PushButtonData(const OdString& name, const OdString& text, const OdString& commandName)
        : RibbonItemData(name, text), m_commandName(commandName) {}

    /**
     * @brief Gets the bound ODA command name.
     * @return Command global name.
     */
    OdString GetCommandName() const { return m_commandName; }

    /**
     * @brief Fluent setter for the bound ODA command name.
     * @param cmd Command global name.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetCommandName(const OdString& cmd) { m_commandName = cmd; return *this; }

    /**
     * @brief Fluent setter for the 32x32 large icon path.
     * @param path Image path.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetLargeImage(const OdString& path) { RibbonItemData::SetLargeImage(path); return *this; }

    /**
     * @brief Fluent setter for the 32x32 large icon from Win32 resource ID.
     * @param resId Win32 resource ID.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetLargeImage(unsigned int resId) { RibbonItemData::SetLargeImage(resId); return *this; }

    /**
     * @brief Fluent setter for the 16x16 small icon path.
     * @param path Image path.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetImage(const OdString& path) { RibbonItemData::SetImage(path); return *this; }

    /**
     * @brief Fluent setter for the 16x16 small icon from Win32 resource ID.
     * @param resId Win32 resource ID.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetImage(unsigned int resId) { RibbonItemData::SetImage(resId); return *this; }

    /**
     * @brief Fluent setter for the short tooltip text.
     * @param tip Tooltip text.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetToolTip(const OdString& tip) { RibbonItemData::SetToolTip(tip); return *this; }

    /**
     * @brief Fluent setter for extended long description text.
     * @param desc Extended description.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetLongDescription(const OdString& desc) { RibbonItemData::SetLongDescription(desc); return *this; }

    /**
     * @brief Fluent setter for responsive button auto-collapse.
     * @param responsive true to enable responsive resizing.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetResponsive(bool responsive) { RibbonItemData::SetResponsive(responsive); return *this; }

    /**
     * @brief Fluent setter for initial enabled state.
     * @param enabled true to enable.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetEnabled(bool enabled) { RibbonItemData::SetEnabled(enabled); return *this; }

    /**
     * @brief Fluent setter for initial visibility state.
     * @param visible true to show; false to hide.
     * @return Reference to self for chaining.
     */
    PushButtonData& SetVisible(bool visible) { RibbonItemData::SetVisible(visible); return *this; }

    /**
     * @brief Fluent setter for ordering priority within panel.
     * @param order Ordering integer (lower values appear first).
     * @return Reference to self for chaining.
     */
    PushButtonData& SetOrder(int order) { RibbonItemData::SetOrder(order); return *this; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::PushButton.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::PushButton; }

private:
    OdString m_commandName;
};

/**
 * @class PulldownButtonData
 * @brief Data descriptor for dropdown menus containing sub-items.
 */
class PulldownButtonData : public RibbonItemData
{
public:
    /**
     * @brief Constructs pulldown button descriptor from parameters.
     * @param name Unique item name.
     * @param text Display text.
     */
    PulldownButtonData(const OdString& name, const OdString& text)
        : RibbonItemData(name, text) {}

    /**
     * @brief Fluent setter for the 32x32 large icon path.
     * @param path Image path.
     * @return Reference to self for chaining.
     */
    PulldownButtonData& SetLargeImage(const OdString& path) { RibbonItemData::SetLargeImage(path); return *this; }

    /**
     * @brief Fluent setter for the 32x32 large icon from Win32 resource ID.
     * @param resId Win32 resource ID.
     * @return Reference to self for chaining.
     */
    PulldownButtonData& SetLargeImage(unsigned int resId) { RibbonItemData::SetLargeImage(resId); return *this; }

    /**
     * @brief Fluent setter for the 16x16 small icon path.
     * @param path Image path.
     * @return Reference to self for chaining.
     */
    PulldownButtonData& SetImage(const OdString& path) { RibbonItemData::SetImage(path); return *this; }

    /**
     * @brief Fluent setter for the 16x16 small icon from Win32 resource ID.
     * @param resId Win32 resource ID.
     * @return Reference to self for chaining.
     */
    PulldownButtonData& SetImage(unsigned int resId) { RibbonItemData::SetImage(resId); return *this; }

    /**
     * @brief Fluent setter for the short tooltip text.
     * @param tip Tooltip text.
     * @return Reference to self for chaining.
     */
    PulldownButtonData& SetToolTip(const OdString& tip) { RibbonItemData::SetToolTip(tip); return *this; }

    /**
     * @brief Fluent setter for extended long description text.
     * @param desc Extended description.
     * @return Reference to self for chaining.
     */
    PulldownButtonData& SetLongDescription(const OdString& desc) { RibbonItemData::SetLongDescription(desc); return *this; }

    /**
     * @brief Fluent setter for responsive button auto-collapse.
     * @param responsive true to enable responsive resizing.
     * @return Reference to self for chaining.
     */
    PulldownButtonData& SetResponsive(bool responsive) { RibbonItemData::SetResponsive(responsive); return *this; }

    /**
     * @brief Fluent setter for ordering priority within panel.
     * @param order Ordering integer (lower values appear first).
     * @return Reference to self for chaining.
     */
    PulldownButtonData& SetOrder(int order) { RibbonItemData::SetOrder(order); return *this; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::PulldownButton.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::PulldownButton; }
};

/**
 * @class SplitButtonData
 * @brief Data descriptor for split buttons with a primary command and dropdown sub-items.
 */
class SplitButtonData : public RibbonItemData
{
public:
    /**
     * @brief Constructs split button descriptor from parameters.
     * @param name Unique item name.
     * @param text Display text.
     */
    SplitButtonData(const OdString& name, const OdString& text)
        : RibbonItemData(name, text) {}

    /**
     * @brief Fluent setter for the 32x32 large icon path.
     * @param path Image path.
     * @return Reference to self for chaining.
     */
    SplitButtonData& SetLargeImage(const OdString& path) { RibbonItemData::SetLargeImage(path); return *this; }

    /**
     * @brief Fluent setter for the 32x32 large icon from Win32 resource ID.
     * @param resId Win32 resource ID.
     * @return Reference to self for chaining.
     */
    SplitButtonData& SetLargeImage(unsigned int resId) { RibbonItemData::SetLargeImage(resId); return *this; }

    /**
     * @brief Fluent setter for the 16x16 small icon path.
     * @param path Image path.
     * @return Reference to self for chaining.
     */
    SplitButtonData& SetImage(const OdString& path) { RibbonItemData::SetImage(path); return *this; }

    /**
     * @brief Fluent setter for the 16x16 small icon from Win32 resource ID.
     * @param resId Win32 resource ID.
     * @return Reference to self for chaining.
     */
    SplitButtonData& SetImage(unsigned int resId) { RibbonItemData::SetImage(resId); return *this; }

    /**
     * @brief Fluent setter for the short tooltip text.
     * @param tip Tooltip text.
     * @return Reference to self for chaining.
     */
    SplitButtonData& SetToolTip(const OdString& tip) { RibbonItemData::SetToolTip(tip); return *this; }

    /**
     * @brief Fluent setter for extended long description text.
     * @param desc Extended description.
     * @return Reference to self for chaining.
     */
    SplitButtonData& SetLongDescription(const OdString& desc) { RibbonItemData::SetLongDescription(desc); return *this; }

    /**
     * @brief Fluent setter for responsive button auto-collapse.
     * @param responsive true to enable responsive resizing.
     * @return Reference to self for chaining.
     */
    SplitButtonData& SetResponsive(bool responsive) { RibbonItemData::SetResponsive(responsive); return *this; }

    /**
     * @brief Fluent setter for ordering priority within panel.
     * @param order Ordering integer (lower values appear first).
     * @return Reference to self for chaining.
     */
    SplitButtonData& SetOrder(int order) { RibbonItemData::SetOrder(order); return *this; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::SplitButton.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::SplitButton; }
};

/**
 * @class ToggleButtonData
 * @brief Data descriptor for checkable push buttons.
 */
class ToggleButtonData : public PushButtonData
{
public:
    /**
     * @brief Constructs toggle button descriptor from parameters.
     * @param name Unique item name.
     * @param text Display label.
     * @param commandName Registered ODA global command name.
     */
    ToggleButtonData(const OdString& name, const OdString& text, const OdString& commandName)
        : PushButtonData(name, text, commandName), m_checked(false) {}

    /**
     * @brief Queries whether the button is checked.
     * @return true if checked; otherwise false.
     */
    bool IsChecked() const { return m_checked; }

    /**
     * @brief Fluent setter for checked state.
     * @param checked true for checked.
     * @return Reference to self for chaining.
     */
    ToggleButtonData& SetChecked(bool checked) { m_checked = checked; return *this; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::ToggleButton.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::ToggleButton; }

private:
    bool m_checked;
};

/**
 * @class RadioButtonGroupData
 * @brief Data descriptor for radio button groups containing mutually exclusive buttons.
 */
class RadioButtonGroupData : public RibbonItemData
{
public:
    /**
     * @brief Constructs radio group descriptor from name.
     * @param name Unique group name.
     */
    explicit RadioButtonGroupData(const OdString& name)
        : RibbonItemData(name, name) {}

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::RadioButtonGroup.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::RadioButtonGroup; }
};

/**
 * @class ComboBoxData
 * @brief Data descriptor for dropdown combo box selections.
 */
class ComboBoxData : public RibbonItemData
{
public:
    /**
     * @brief Constructs combobox descriptor from name.
     * @param name Unique control name.
     */
    explicit ComboBoxData(const OdString& name)
        : RibbonItemData(name, name), m_selectedIndex(0) {}

    /**
     * @brief Adds an item to the dropdown options.
     * @param itemText Option label.
     * @return Reference to self for chaining.
     */
    ComboBoxData& AddItem(const OdString& itemText) { m_items.push_back(itemText); return *this; }

    /**
     * @brief Gets all dropdown options.
     * @return Vector of option labels.
     */
    const std::vector<OdString>& GetItems() const { return m_items; }

    /**
     * @brief Gets the initially selected index.
     * @return 0-based selected index.
     */
    int GetSelectedIndex() const { return m_selectedIndex; }

    /**
     * @brief Sets the initially selected index.
     * @param index 0-based index.
     * @return Reference to self for chaining.
     */
    ComboBoxData& SetSelectedIndex(int index) { m_selectedIndex = index; return *this; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::ComboBox.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::ComboBox; }

private:
    std::vector<OdString> m_items;
    int                   m_selectedIndex;
};

/**
 * @class TextBoxData
 * @brief Data descriptor for text entry fields inside ribbon panels.
 */
class TextBoxData : public RibbonItemData
{
public:
    /**
     * @brief Constructs text box descriptor from name.
     * @param name Unique control name.
     */
    explicit TextBoxData(const OdString& name)
        : RibbonItemData(name, name) {}

    /**
     * @brief Gets current text value.
     * @return Text value.
     */
    OdString GetValue() const { return m_value; }

    /**
     * @brief Sets current text value.
     * @param val Text value.
     * @return Reference to self for chaining.
     */
    TextBoxData& SetValue(const OdString& val) { m_value = val; return *this; }

    /**
     * @brief Gets prompt / placeholder text.
     * @return Placeholder text.
     */
    OdString GetPromptText() const { return m_promptText; }

    /**
     * @brief Sets prompt / placeholder text.
     * @param prompt Placeholder text.
     * @return Reference to self for chaining.
     */
    TextBoxData& SetPromptText(const OdString& prompt) { m_promptText = prompt; return *this; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::TextBox.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::TextBox; }

private:
    OdString m_value;
    OdString m_promptText;
};

/**
 * @class SeparatorData
 * @brief Data descriptor for ribbon visual separators.
 */
class SeparatorData : public RibbonItemData
{
public:
    /**
     * @brief Constructs separator descriptor.
     */
    SeparatorData() : RibbonItemData(OD_T(""), OD_T("")) {}

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::Separator.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::Separator; }
};

/**
 * @class SlideOutData
 * @brief Data descriptor marking the start of a slideout panel section.
 */
class SlideOutData : public RibbonItemData
{
public:
    /**
     * @brief Constructs slideout division marker descriptor.
     */
    SlideOutData() : RibbonItemData(OD_T(""), OD_T("")) {}

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::SlideOut.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::SlideOut; }
};

/**
 * @class RibbonItem
 * @brief Base class for all ribbon UI items instantiated within a panel.
 */
class RibbonItem
{
public:
    /**
     * @brief Virtual destructor for polymorphic cleanup.
     */
    virtual ~RibbonItem() = default;

    /**
     * @brief Gets the programmatic unique identifier name of this item.
     * @return Unique item name as OdString.
     */
    OdString GetName() const { return m_name; }

    /**
     * @brief Gets the visible display text / label for this item.
     * @return Display text.
     */
    OdString GetText() const { return m_text; }

    /**
     * @brief Gets the short tooltip summary text.
     * @return Tooltip text.
     */
    OdString GetToolTip() const { return m_toolTip; }

    /**
     * @brief Gets the extended detailed description text.
     * @return Long description text.
     */
    OdString GetLongDescription() const { return m_longDescription; }

    /**
     * @brief Gets the 32x32 large icon image path.
     * @return Path to large image.
     */
    OdString GetLargeImage() const { return m_largeImage; }

    /**
     * @brief Gets the 16x16 small icon image path.
     * @return Path to small image.
     */
    OdString GetImage() const { return m_smallImage; }

    /**
     * @brief Gets the embedded Win32 icon resource ID.
     * @return Resource identifier or 0 if file-based.
     */
    unsigned int GetIconResId() const { return m_iconResId; }

    /**
     * @brief Sets the 32x32 large icon image path.
     * @param imagePath Path or name of the image.
     */
    void SetLargeImage(const OdString& imagePath) { m_largeImage = imagePath; }

    /**
     * @brief Sets the 32x32 large icon from an embedded Win32 resource ID.
     * @param resId Win32 resource identifier (e.g. IDI_*).
     */
    void SetLargeImage(unsigned int resId)
    {
        m_iconResId = resId;
        m_largeImage = OdString((L"#" + std::to_wstring(resId)).c_str());
    }

    /**
     * @brief Sets the 16x16 small icon image path.
     * @param imagePath Path or name of the image.
     */
    void SetImage(const OdString& imagePath) { m_smallImage = imagePath; }

    /**
     * @brief Sets the 16x16 small icon from an embedded Win32 resource ID.
     * @param resId Win32 resource identifier (e.g. IDI_*).
     */
    void SetImage(unsigned int resId)
    {
        m_iconResId = resId;
        m_smallImage = OdString((L"#" + std::to_wstring(resId)).c_str());
    }

    /**
     * @brief Sets the short tooltip summary text.
     * @param toolTip Tooltip text.
     */
    void SetToolTip(const OdString& toolTip) { m_toolTip = toolTip; }

    /**
     * @brief Sets the extended detailed description text.
     * @param desc Long description text.
     */
    void SetLongDescription(const OdString& desc) { m_longDescription = desc; }

    /**
     * @brief Sets the visibility state of the item.
     * @param visible true to show item; false to hide.
     */
    void SetVisible(bool visible) { m_visible = visible; }

    /**
     * @brief Queries whether the item is visible.
     * @return true if visible; otherwise false.
     */
    bool IsVisible() const { return m_visible; }

    /**
     * @brief Sets the enabled state of the item.
     * @param enabled true to enable item.
     */
    void SetEnabled(bool enabled) { m_enabled = enabled; }

    /**
     * @brief Queries whether the item is enabled.
     * @return true if enabled; otherwise false.
     */
    bool IsEnabled() const { return m_enabled; }

    /**
     * @brief Sets whether the button dynamically collapses between large and small on resize.
     * @param responsive true to enable responsive layout.
     */
    void SetResponsive(bool responsive) { m_responsive = responsive; }

    /**
     * @brief Queries whether the button dynamically collapses between large and small on resize.
     * @return true if responsive; otherwise false.
     */
    bool IsResponsive() const { return m_responsive; }

    /**
     * @brief Sets whether the item is part of a stacked button group.
     * @param stacked true to mark as stacked.
     */
    void SetStacked(bool stacked) { m_isStacked = stacked; }

    /**
     * @brief Queries whether the item is part of a stacked button group.
     * @return true if stacked; otherwise false.
     */
    bool IsStacked() const { return m_isStacked; }

    /**
     * @brief Sets whether the item belongs to the slideout panel section.
     * @param slideOut true to place inside slideout.
     */
    void SetSlideOut(bool slideOut) { m_isSlideOut = slideOut; }

    /**
     * @brief Queries whether the item belongs to the slideout panel section.
     * @return true if inside slideout; otherwise false.
     */
    bool IsSlideOut() const { return m_isSlideOut; }

    /**
     * @brief Queries the ordering priority of this item within the panel.
     * @return Ordering integer (lower values appear first; default 0).
     */
    int GetOrder() const { return m_order; }

    /**
     * @brief Sets the ordering priority of this item within the panel.
     * @param order Ordering integer (lower values appear first).
     */
    void SetOrder(int order) { m_order = order; }

    /**
     * @brief Queries the help target opened when the user presses F1 over this item.
     * @return URL or file path; empty when the item has no contextual help.
     */
    const OdString& GetContextualHelpUrl() const { return m_helpUrl; }

    /**
     * @brief Sets the help target (URL or file path) opened on F1 over this item.
     * @param url Help target; empty removes contextual help.
     */
    void SetContextualHelpUrl(const OdString& url) { m_helpUrl = url; }

    /**
     * @brief Retrieves the polymorphic item type classification.
     * @return RibbonItemType enum value.
     */
    virtual RibbonItemType GetItemType() const = 0;

    /**
     * @brief Converts this live ribbon item to a declarative ButtonDef structure.
     * @return Populated ButtonDef structure.
     */
    virtual ButtonDef ToButtonDef() const
    {
        ButtonDef b;
        b.text            = m_text;
        b.tooltip         = m_toolTip;
        b.longDescription = m_longDescription;
        b.iconPath        = m_largeImage.isEmpty() ? m_smallImage : m_largeImage;
        b.largeIconPath   = m_largeImage;
        b.smallIconPath   = m_smallImage;
        b.iconResId       = m_iconResId;
        b.size            = (!m_largeImage.isEmpty() || m_iconResId != 0) ? ButtonSize::Large : ButtonSize::Small;
        b.responsive      = m_responsive;
        b.visible         = m_visible;
        b.enabled         = m_enabled;
        b.isStacked       = m_isStacked;
        b.isSlideOut      = m_isSlideOut;
        b.order           = m_order;
        b.helpUrl         = m_helpUrl;
        return b;
    }

protected:
    /**
     * @brief Protected constructor initialized from a descriptor.
     * @param data Source item descriptor.
     */
    RibbonItem(const RibbonItemData& data)
        : m_name(data.GetName())
        , m_text(data.GetText())
        , m_toolTip(data.GetToolTip())
        , m_longDescription(data.GetLongDescription())
        , m_largeImage(data.GetLargeImage())
        , m_smallImage(data.GetImage())
        , m_iconResId(data.GetIconResId())
        , m_visible(data.IsVisible())
        , m_enabled(data.IsEnabled())
        , m_responsive(data.IsResponsive())
        , m_isStacked(data.IsStacked())
        , m_isSlideOut(data.IsSlideOut())
        , m_order(data.GetOrder())
        , m_helpUrl(data.GetContextualHelpUrl())
    {
    }

    OdString     m_name;
    OdString     m_text;
    OdString     m_toolTip;
    OdString     m_longDescription;
    OdString     m_largeImage;
    OdString     m_smallImage;
    unsigned int m_iconResId;
    bool         m_visible;
    bool         m_enabled;
    bool         m_responsive;
    bool         m_isStacked;
    bool         m_isSlideOut;
    int          m_order;
    OdString     m_helpUrl;
};

/**
 * @class PushButton
 * @brief Represents a standard command button in a ribbon panel.
 */
class PushButton : public RibbonItem
{
public:
    /**
     * @brief Constructs push button from descriptor.
     * @param data Source push button descriptor.
     */
    PushButton(const PushButtonData& data)
        : RibbonItem(data)
        , m_commandName(data.GetCommandName())
    {
    }

    /**
     * @brief Gets the bound ODA command name.
     * @return Command global name.
     */
    OdString GetCommandName() const { return m_commandName; }

    /**
     * @brief Sets the bound ODA command name.
     * @param cmd Command global name.
     */
    void SetCommandName(const OdString& cmd) { m_commandName = cmd; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::PushButton.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::PushButton; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b = RibbonItem::ToButtonDef();
        b.commandName = m_commandName;
        b.kind = ButtonKind::Button;
        return b;
    }

private:
    OdString m_commandName;
};

/**
 * @class RibbonSeparator
 * @brief Represents a separator between ribbon items.
 */
class RibbonSeparator : public RibbonItem
{
public:
    /**
     * @brief Constructs a ribbon separator.
     */
    RibbonSeparator() : RibbonItem(SeparatorData()) {}

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::Separator.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::Separator; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b;
        b.kind = ButtonKind::Separator;
        b.isStacked = m_isStacked;
        b.isSlideOut = m_isSlideOut;
        return b;
    }
};

/**
 * @class RibbonSlideOut
 * @brief Represents a marker for a slideout panel division.
 */
class RibbonSlideOut : public RibbonItem
{
public:
    /**
     * @brief Constructs a slideout division marker.
     */
    RibbonSlideOut() : RibbonItem(SlideOutData()) {}

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::SlideOut.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::SlideOut; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b;
        b.kind = ButtonKind::SlideOut;
        return b;
    }
};

/**
 * @class PulldownButton
 * @brief Represents a dropdown menu button containing child items.
 */
class PulldownButton : public RibbonItem
{
public:
    /**
     * @brief Constructs pulldown button from descriptor.
     * @param data Source pulldown descriptor.
     */
    PulldownButton(const PulldownButtonData& data)
        : RibbonItem(data)
    {
    }

    /**
     * @brief Constructs pulldown button from general item descriptor.
     * @param data Source item descriptor.
     */
    PulldownButton(const RibbonItemData& data)
        : RibbonItem(data)
    {
    }

    /**
     * @brief Adds a push button item to this dropdown menu.
     * @param data Push button descriptor.
     * @return Pointer to created PushButton.
     */
    PushButton* AddPushButton(const PushButtonData& data)
    {
        auto btn = std::make_shared<PushButton>(data);
        m_subItems.push_back(btn);
        return btn.get();
    }

    /**
     * @brief Adds a visual separator to this dropdown menu.
     */
    void AddSeparator()
    {
        m_subItems.push_back(std::make_shared<RibbonSeparator>());
    }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::PulldownButton.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::PulldownButton; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b = RibbonItem::ToButtonDef();
        b.kind = ButtonKind::Dropdown;
        for (const auto& item : m_subItems) {
            if (item)
                b.subItems.push_back(item->ToButtonDef());
        }
        return b;
    }

    /**
     * @brief Gets all child menu items.
     * @return Vector of shared pointers to child RibbonItem instances.
     */
    const std::vector<std::shared_ptr<RibbonItem>>& GetItems() const { return m_subItems; }

protected:
    std::vector<std::shared_ptr<RibbonItem>> m_subItems;
};

/**
 * @class SplitButton
 * @brief Represents a split button with default top action and dropdown sub-items.
 */
class SplitButton : public PulldownButton
{
public:
    /**
     * @brief Constructs split button from descriptor.
     * @param data Source split button descriptor.
     */
    SplitButton(const SplitButtonData& data)
        : PulldownButton(data)
    {
    }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::SplitButton.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::SplitButton; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b = PulldownButton::ToButtonDef();
        b.kind = ButtonKind::SplitButton;
        return b;
    }
};

/**
 * @class ToggleButton
 * @brief Represents a checkable ribbon button.
 */
class ToggleButton : public PushButton
{
public:
    /**
     * @brief Constructs toggle button from descriptor.
     * @param data Source toggle button descriptor.
     */
    ToggleButton(const ToggleButtonData& data)
        : PushButton(data), m_checked(data.IsChecked())
    {
    }

    /**
     * @brief Queries whether the button is currently checked.
     * @return true if checked; otherwise false.
     */
    bool IsChecked() const { return m_checked; }

    /**
     * @brief Sets whether the button is checked.
     * @param checked true for checked.
     */
    void SetChecked(bool checked) { m_checked = checked; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::ToggleButton.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::ToggleButton; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b = PushButton::ToButtonDef();
        b.kind = ButtonKind::Toggle;
        b.checked = m_checked;
        return b;
    }

private:
    bool m_checked;
};

/**
 * @class RadioButtonGroup
 * @brief Represents a group of mutually exclusive radio buttons.
 */
class RadioButtonGroup : public RibbonItem
{
public:
    /**
     * @brief Constructs radio group from descriptor.
     * @param data Source radio group descriptor.
     */
    RadioButtonGroup(const RadioButtonGroupData& data)
        : RibbonItem(data)
    {
    }

    /**
     * @brief Adds a push button to this radio group.
     * @param data Push button descriptor.
     * @return Pointer to created PushButton.
     */
    PushButton* AddPushButton(const PushButtonData& data)
    {
        auto btn = std::make_shared<PushButton>(data);
        m_buttons.push_back(btn);
        return btn.get();
    }

    /**
     * @brief Adds a toggle button to this radio group.
     * @param data Toggle button descriptor.
     * @return Pointer to created ToggleButton.
     */
    ToggleButton* AddToggleButton(const ToggleButtonData& data)
    {
        auto btn = std::make_shared<ToggleButton>(data);
        m_buttons.push_back(btn);
        return btn.get();
    }

    /**
     * @brief Gets all child buttons in this radio group.
     * @return Vector of shared pointers to child RibbonItem instances.
     */
    const std::vector<std::shared_ptr<RibbonItem>>& GetButtons() const { return m_buttons; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::RadioButtonGroup.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::RadioButtonGroup; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b = RibbonItem::ToButtonDef();
        b.kind = ButtonKind::RadioButtonGroup;
        b.groupName = m_name;
        for (const auto& btn : m_buttons) {
            if (btn)
                b.subItems.push_back(btn->ToButtonDef());
        }
        return b;
    }

private:
    std::vector<std::shared_ptr<RibbonItem>> m_buttons;
};

/**
 * @class ComboBox
 * @brief Represents a dropdown combo box on a ribbon panel.
 */
class ComboBox : public RibbonItem
{
public:
    /**
     * @brief Constructs combo box from descriptor.
     * @param data Source combobox descriptor.
     */
    ComboBox(const ComboBoxData& data)
        : RibbonItem(data)
        , m_items(data.GetItems())
        , m_selectedIndex(data.GetSelectedIndex())
    {
    }

    /**
     * @brief Adds an item to dropdown options.
     * @param item Option label.
     */
    void AddItem(const OdString& item) { m_items.push_back(item); }

    /**
     * @brief Gets all dropdown option labels.
     * @return Vector of OdStrings.
     */
    const std::vector<OdString>& GetItems() const { return m_items; }

    /**
     * @brief Gets the selected index.
     * @return 0-based selected index.
     */
    int GetSelectedIndex() const { return m_selectedIndex; }

    /**
     * @brief Sets the selected index.
     * @param index 0-based selected index.
     */
    void SetSelectedIndex(int index) { m_selectedIndex = index; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::ComboBox.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::ComboBox; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b = RibbonItem::ToButtonDef();
        b.kind = ButtonKind::ComboBox;
        b.comboItems = m_items;
        b.comboSelectedIndex = m_selectedIndex;
        return b;
    }

private:
    std::vector<OdString> m_items;
    int                   m_selectedIndex;
};

/**
 * @class TextBox
 * @brief Represents an inline text input control on a ribbon panel.
 */
class TextBox : public RibbonItem
{
public:
    /**
     * @brief Constructs text box from descriptor.
     * @param data Source text box descriptor.
     */
    TextBox(const TextBoxData& data)
        : RibbonItem(data)
        , m_value(data.GetValue())
        , m_promptText(data.GetPromptText())
    {
    }

    /**
     * @brief Gets current text value.
     * @return Text value.
     */
    OdString GetValue() const { return m_value; }

    /**
     * @brief Sets current text value.
     * @param val Text value.
     */
    void SetValue(const OdString& val) { m_value = val; }

    /**
     * @brief Gets placeholder prompt text.
     * @return Placeholder text.
     */
    OdString GetPromptText() const { return m_promptText; }

    /**
     * @brief Sets placeholder prompt text.
     * @param prompt Placeholder text.
     */
    void SetPromptText(const OdString& prompt) { m_promptText = prompt; }

    /**
     * @brief Retrieves the polymorphic item type.
     * @return RibbonItemType::TextBox.
     */
    RibbonItemType GetItemType() const override { return RibbonItemType::TextBox; }

    /**
     * @brief Converts to declarative ButtonDef structure.
     * @return ButtonDef structure.
     */
    ButtonDef ToButtonDef() const override
    {
        ButtonDef b = RibbonItem::ToButtonDef();
        b.kind = ButtonKind::TextBox;
        b.text = m_value;
        b.tooltip = m_promptText;
        return b;
    }

private:
    OdString m_value;
    OdString m_promptText;
};

/**
 * @class RibbonPanel
 * @brief Represents a panel (group) containing ribbon controls within a tab.
 */
class RibbonPanel
{
public:
    /**
     * @brief Constructs ribbon panel with name.
     * @param name Panel caption name.
     */
    explicit RibbonPanel(const OdString& name) : m_name(name) {}

    /**
     * @brief Gets panel caption name.
     * @return Panel name as OdString.
     */
    OdString GetName() const { return m_name; }

    /**
     * @brief Adds a push button to this panel.
     * @param data Push button descriptor.
     * @return Pointer to created PushButton.
     */
    PushButton* AddPushButton(const PushButtonData& data)
    {
        auto btn = std::make_shared<PushButton>(data);
        m_items.push_back(btn);
        return btn.get();
    }

    /**
     * @brief Adds a split button to this panel.
     * @param data Split button descriptor.
     * @return Pointer to created SplitButton.
     */
    SplitButton* AddSplitButton(const SplitButtonData& data)
    {
        auto btn = std::make_shared<SplitButton>(data);
        m_items.push_back(btn);
        return btn.get();
    }

    /**
     * @brief Adds a pulldown button to this panel.
     * @param data Pulldown button descriptor.
     * @return Pointer to created PulldownButton.
     */
    PulldownButton* AddPulldownButton(const PulldownButtonData& data)
    {
        auto btn = std::make_shared<PulldownButton>(data);
        m_items.push_back(btn);
        return btn.get();
    }

    /**
     * @brief Adds a toggle button to this panel.
     * @param data Toggle button descriptor.
     * @return Pointer to created ToggleButton.
     */
    ToggleButton* AddToggleButton(const ToggleButtonData& data)
    {
        auto btn = std::make_shared<ToggleButton>(data);
        m_items.push_back(btn);
        return btn.get();
    }

    /**
     * @brief Adds a radio button group to this panel.
     * @param data Radio button group descriptor.
     * @return Pointer to created RadioButtonGroup.
     */
    RadioButtonGroup* AddRadioButtonGroup(const RadioButtonGroupData& data)
    {
        auto group = std::make_shared<RadioButtonGroup>(data);
        m_items.push_back(group);
        return group.get();
    }

    /**
     * @brief Adds a combo box control to this panel.
     * @param data ComboBox descriptor.
     * @return Pointer to created ComboBox.
     */
    ComboBox* AddComboBox(const ComboBoxData& data)
    {
        auto cb = std::make_shared<ComboBox>(data);
        m_items.push_back(cb);
        return cb.get();
    }

    /**
     * @brief Adds a text box control to this panel.
     * @param data TextBox descriptor.
     * @return Pointer to created TextBox.
     */
    TextBox* AddTextBox(const TextBoxData& data)
    {
        auto tb = std::make_shared<TextBox>(data);
        m_items.push_back(tb);
        return tb.get();
    }

    /**
     * @brief Adds a visual separator to this panel.
     */
    void AddSeparator()
    {
        m_items.push_back(std::make_shared<RibbonSeparator>());
    }

    /**
     * @brief Adds a slideout panel division marker.
     */
    void AddSlideOut()
    {
        m_items.push_back(std::make_shared<RibbonSlideOut>());
    }

    /**
     * @brief Dynamically instantiates and adds an item based on its descriptor type.
     * @param itemData Source item descriptor.
     * @return Pointer to created RibbonItem instance.
     */
    RibbonItem* AddItem(const RibbonItemData& itemData)
    {
        switch (itemData.GetItemType())
        {
        case RibbonItemType::PushButton:
        {
            RibbonItem* itemPtr = AddPushButton(static_cast<const PushButtonData&>(itemData));
            return itemPtr;
        }
        case RibbonItemType::SplitButton:
        {
            RibbonItem* itemPtr = AddSplitButton(static_cast<const SplitButtonData&>(itemData));
            return itemPtr;
        }
        case RibbonItemType::PulldownButton:
        {
            RibbonItem* itemPtr = AddPulldownButton(static_cast<const PulldownButtonData&>(itemData));
            return itemPtr;
        }
        case RibbonItemType::ToggleButton:
        {
            RibbonItem* itemPtr = AddToggleButton(static_cast<const ToggleButtonData&>(itemData));
            return itemPtr;
        }
        case RibbonItemType::RadioButtonGroup:
        {
            RibbonItem* itemPtr = AddRadioButtonGroup(static_cast<const RadioButtonGroupData&>(itemData));
            return itemPtr;
        }
        case RibbonItemType::ComboBox:
        {
            RibbonItem* itemPtr = AddComboBox(static_cast<const ComboBoxData&>(itemData));
            return itemPtr;
        }
        case RibbonItemType::TextBox:
        {
            RibbonItem* itemPtr = AddTextBox(static_cast<const TextBoxData&>(itemData));
            return itemPtr;
        }
        case RibbonItemType::Separator:
        {
            AddSeparator();
            return m_items.back().get();
        }
        case RibbonItemType::SlideOut:
        {
            AddSlideOut();
            return m_items.back().get();
        }
        default:
            return nullptr;
        }
    }

    /**
     * @brief Adds 2 vertically stacked items to the panel (standard Revit layout).
     * @param item1 First item descriptor.
     * @param item2 Second item descriptor.
     * @return Vector of pointers to instantiated RibbonItem elements.
     */
    std::vector<RibbonItem*> AddStackedItems(const RibbonItemData& item1, const RibbonItemData& item2)
    {
        std::vector<RibbonItem*> result;
        auto* p1 = AddItem(item1);
        if (p1) {
            p1->SetStacked(true);
            result.push_back(p1);
        }
        auto* p2 = AddItem(item2);
        if (p2) {
            p2->SetStacked(true);
            result.push_back(p2);
        }
        return result;
    }

    /**
     * @brief Adds 3 vertically stacked items to the panel (standard Revit layout).
     * @param item1 First item descriptor.
     * @param item2 Second item descriptor.
     * @param item3 Third item descriptor.
     * @return Vector of pointers to instantiated RibbonItem elements.
     */
    std::vector<RibbonItem*> AddStackedItems(const RibbonItemData& item1, const RibbonItemData& item2, const RibbonItemData& item3)
    {
        std::vector<RibbonItem*> result = AddStackedItems(item1, item2);
        auto* p3 = AddItem(item3);
        if (p3) {
            p3->SetStacked(true);
            result.push_back(p3);
        }
        return result;
    }

    /**
     * @brief Queries the ordering priority of this panel within the tab.
     * @return Ordering integer (lower values appear first; default 0).
     */
    int GetOrder() const { return m_order; }

    /**
     * @brief Sets the ordering priority of this panel within the tab.
     * @param order Ordering integer (lower values appear first).
     */
    void SetOrder(int order) { m_order = order; }

    /**
     * @brief Gets all items contained within this panel.
     * @return Vector of shared pointers to RibbonItem instances.
     */
    const std::vector<std::shared_ptr<RibbonItem>>& GetItems() const { return m_items; }

    /**
     * @brief Converts panel to declarative PanelDef structure.
     * @return Populated PanelDef structure.
     */
    PanelDef ToPanelDef() const
    {
        PanelDef p;
        p.name = m_name;
        p.order = m_order;
        bool isCurrentSlideOut = false;
        for (const auto& item : m_items) {
            if (item) {
                if (item->GetItemType() == RibbonItemType::SlideOut) {
                    isCurrentSlideOut = true;
                    continue;
                }
                ButtonDef def = item->ToButtonDef();
                if (isCurrentSlideOut)
                    def.isSlideOut = true;
                p.buttons.push_back(std::move(def));
            }
        }
        return p;
    }

private:
    OdString m_name;
    int      m_order = 0;
    std::vector<std::shared_ptr<RibbonItem>> m_items;
};

/**
 * @class RibbonTab
 * @brief Represents a top-level ribbon tab category containing multiple panels.
 */
class RibbonTab
{
public:
    /**
     * @brief Constructs ribbon tab with name, visibility context, and ordering priority.
     * @param name Tab label name.
     * @param vis Contextual visibility rule.
     * @param order Ordering priority (lower values appear first).
     */
    explicit RibbonTab(const OdString& name, TabVisibility vis = TabVisibility::DocumentOnly, int order = kDefaultPluginTabOrder)
        : m_name(name)
        , m_visibility(vis)
        , m_order(order)
        , m_isContextual(false)
    {
    }

    /**
     * @brief Gets tab label name.
     * @return Tab name as OdString.
     */
    OdString GetName() const { return m_name; }

    /**
     * @brief Gets the contextual visibility rule for this tab.
     * @return TabVisibility enum value.
     */
    TabVisibility GetVisibility() const { return m_visibility; }

    /**
     * @brief Sets the contextual visibility rule for this tab.
     * @param vis Visibility rule (DocumentOnly, Always, ModelOnly, FamilyOnly).
     */
    void SetVisibility(TabVisibility vis) { m_visibility = vis; }

    /**
     * @brief Queries the ordering priority of this tab on the ribbon bar.
     * @return Ordering integer (lower values appear first).
     */
    int GetOrder() const { return m_order; }

    /**
     * @brief Sets the ordering priority of this tab on the ribbon bar.
     * @param order Ordering integer (lower values appear first).
     */
    void SetOrder(int order) { m_order = order; }

    /**
     * @brief Queries whether this tab is contextual.
     * @return true if contextual; otherwise false.
     */
    bool IsContextual() const { return m_isContextual; }

    /**
     * @brief Sets whether this tab is contextual.
     * @param ctx true for contextual tab.
     */
    void SetContextual(bool ctx) { m_isContextual = ctx; }

    /**
     * @brief Gets contextual identifier string.
     * @return Context ID.
     */
    OdString GetContextId() const { return m_contextId; }

    /**
     * @brief Sets contextual identifier string.
     * @param id Context ID.
     */
    void SetContextId(const OdString& id) { m_contextId = id; }

    /**
     * @brief Gets the return tab name when contextual mode ends.
     * @return Return tab name.
     */
    OdString GetReturnTab() const { return m_returnTab; }

    /**
     * @brief Sets the return tab name when contextual mode ends.
     * @param ret Return tab name.
     */
    void SetReturnTab(const OdString& ret) { m_returnTab = ret; }

    /**
     * @brief Creates or retrieves a ribbon panel in this tab.
     * @param panelName Name of the panel.
     * @param panelOrder Ordering priority within tab (default 0).
     * @return Pointer to existing or newly created RibbonPanel.
     */
    RibbonPanel* CreateRibbonPanel(const OdString& panelName, int panelOrder = 0)
    {
        for (const auto& panel : m_panels) {
            if (panel && panel->GetName().compare(panelName) == 0) {
                if (panelOrder != 0)
                    panel->SetOrder(panelOrder);
                return panel.get();
            }
        }

        auto panel = std::make_shared<RibbonPanel>(panelName);
        panel->SetOrder(panelOrder);
        m_panels.push_back(panel);
        return panel.get();
    }

    /**
     * @brief Searches for an existing panel by name in this tab.
     * @param panelName Panel name.
     * @return Pointer to found RibbonPanel, or nullptr.
     */
    RibbonPanel* FindPanel(const OdString& panelName) const
    {
        for (const auto& panel : m_panels) {
            if (panel && panel->GetName().compare(panelName) == 0)
                return panel.get();
        }
        return nullptr;
    }

    /**
     * @brief Gets all panels in this tab.
     * @return Vector of shared pointers to RibbonPanel instances.
     */
    const std::vector<std::shared_ptr<RibbonPanel>>& GetPanels() const { return m_panels; }

    /**
     * @brief Converts tab to declarative TabDef structure.
     * @return Populated TabDef structure.
     */
    TabDef ToTabDef() const
    {
        TabDef t;
        t.name = m_name;
        t.visibility = m_visibility;
        t.order = m_order;
        t.isContextual = m_isContextual;
        t.contextId = m_contextId;
        t.returnTab = m_returnTab;
        for (const auto& panel : m_panels) {
            if (panel)
                t.panels.push_back(panel->ToPanelDef());
        }
        return t;
    }

private:
    OdString      m_name;
    TabVisibility m_visibility;
    int           m_order;
    bool          m_isContextual;
    OdString      m_contextId;
    OdString      m_returnTab;
    std::vector<std::shared_ptr<RibbonPanel>> m_panels;
};

/**
 * @class RibbonControl
 * @brief Top-level entry point for dynamic ribbon interaction (Autodesk Revit UI API style).
 */
class RibbonControl
{
public:
    /**
     * @brief Default constructor.
     */
    RibbonControl() = default;

    /**
     * @brief Constructs RibbonControl with a default tab name.
     * @param defaultTabName Name of initial default tab.
     */
    explicit RibbonControl(const OdString& defaultTabName)
    {
        if (!defaultTabName.isEmpty())
            CreateRibbonTab(defaultTabName);
    }

    /**
     * @brief Creates or retrieves a ribbon tab with visibility context and ordering priority.
     * @param tabName Name of tab category.
     * @param vis Contextual visibility rule.
     * @param order Ordering priority (lower values appear first).
     * @return Pointer to created or existing RibbonTab.
     */
    RibbonTab* CreateRibbonTab(const OdString& tabName, TabVisibility vis = TabVisibility::DocumentOnly, int order = kDefaultPluginTabOrder)
    {
        if (order == kDefaultPluginTabOrder)
        {
            const int canonical = GetCanonicalTabOrder(tabName, vis);
            if (canonical != TabOrders::DefaultPlugin)
                order = canonical;
        }

        for (const auto& tab : m_tabs) {
            if (tab && tab->GetName().compare(tabName) == 0 && tab->GetVisibility() == vis) {
                if (order != kDefaultPluginTabOrder)
                    tab->SetOrder(order);
                return tab.get();
            }
        }

        auto tab = std::make_shared<RibbonTab>(tabName, vis, order);
        m_tabs.push_back(tab);
        return tab.get();
    }

    /**
     * @brief Creates or retrieves a contextual ribbon tab.
     * @param tabName Tab label name.
     * @param contextId Context identifier.
     * @param returnTab Return tab name on context finish.
     * @return Pointer to created contextual RibbonTab.
     */
    RibbonTab* CreateContextualTab(const OdString& tabName, const OdString& contextId, const OdString& returnTab = OD_T(""))
    {
        RibbonTab* tab = CreateRibbonTab(tabName);
        if (tab) {
            tab->SetContextual(true);
            tab->SetContextId(contextId);
            tab->SetReturnTab(returnTab);
        }
        return tab;
    }

    /**
     * @brief Finds a ribbon tab by name.
     * @param tabName Tab name.
     * @return Pointer to RibbonTab if found, or nullptr.
     */
    RibbonTab* FindTab(const OdString& tabName) const
    {
        for (const auto& tab : m_tabs) {
            if (tab && tab->GetName().compare(tabName) == 0)
                return tab.get();
        }
        return nullptr;
    }

    /**
     * @brief Creates or retrieves a panel within a specified tab.
     * @param tabName Target tab name.
     * @param panelName Panel name.
     * @param vis Contextual visibility rule for the tab if created.
     * @param tabOrder Ordering priority for the tab if created.
     * @param panelOrder Ordering priority for the panel within the tab.
     * @return Pointer to created or found RibbonPanel.
     */
    RibbonPanel* CreateRibbonPanel(const OdString& tabName, const OdString& panelName, TabVisibility vis = TabVisibility::DocumentOnly, int tabOrder = kDefaultPluginTabOrder, int panelOrder = 0)
    {
        RibbonTab* tab = CreateRibbonTab(tabName, vis, tabOrder);
        if (!tab)
            return nullptr;
        return tab->CreateRibbonPanel(panelName, panelOrder);
    }

    /**
     * @brief Finds an existing panel within a specified tab.
     * @param tabName Target tab name.
     * @param panelName Panel name.
     * @return Pointer to found RibbonPanel, or nullptr.
     */
    RibbonPanel* FindPanel(const OdString& tabName, const OdString& panelName) const
    {
        RibbonTab* tab = FindTab(tabName);
        if (!tab)
            return nullptr;
        return tab->FindPanel(panelName);
    }

    /**
     * @brief Gets all tabs registered in this control.
     * @return Vector of shared pointers to RibbonTab instances.
     */
    const std::vector<std::shared_ptr<RibbonTab>>& GetTabs() const { return m_tabs; }

    /**
     * @brief Converts all registered tabs to declarative TabDef structures.
     * @return Vector of TabDef structures.
     */
    std::vector<TabDef> ToTabDefs() const
    {
        std::vector<TabDef> defs;
        for (const auto& tab : m_tabs) {
            if (tab)
                defs.push_back(tab->ToTabDef());
        }
        return defs;
    }

    // ── Static Registry & Revit-Style Convenience Shortcuts ─────────────────

    /**
     * @brief Looks up the canonical ordering priority for a tab by canonical name and visibility context.
     * @param tabName Name of tab category.
     * @param vis Contextual visibility rule.
     * @return Canonical order priority integer (e.g. 100 for Home, 2500 for Clash Detect, 3000 for plugin tabs).
     */
    static int GetCanonicalTabOrder(const OdString& tabName, TabVisibility vis = TabVisibility::DocumentOnly)
    {
        if (vis == TabVisibility::FamilyOnly)
        {
            if (tabName.compare(Tabs::CreateFamily) == 0) return TabOrders::CreateFamily;
            if (tabName.compare(Tabs::InsertFamily) == 0) return TabOrders::InsertFamily;
            if (tabName.compare(Tabs::AnnotateFamily) == 0) return TabOrders::AnnotateFamily;
            if (tabName.compare(Tabs::ViewFamily) == 0) return TabOrders::ViewFamily;
            if (tabName.compare(Tabs::ModifyFamily) == 0) return TabOrders::ModifyFamily;
        }

        if (tabName.compare(Tabs::Home) == 0) return TabOrders::Home;
        if (tabName.compare(Tabs::Toolbars) == 0) return TabOrders::Toolbars;
        if (tabName.compare(Tabs::Architecture) == 0) return TabOrders::Architecture;
        if (tabName.compare(Tabs::Structure) == 0) return TabOrders::Structure;
        if (tabName.compare(Tabs::Steel) == 0) return TabOrders::Steel;
        if (tabName.compare(Tabs::Precast) == 0) return TabOrders::Precast;
        if (tabName.compare(Tabs::Systems) == 0) return TabOrders::Systems;
        if (tabName.compare(Tabs::InsertModel) == 0) return TabOrders::InsertModel;
        if (tabName.compare(Tabs::AnnotateModel) == 0) return TabOrders::AnnotateModel;
        if (tabName.compare(Tabs::Analyze) == 0) return TabOrders::Analyze;
        if (tabName.compare(Tabs::MassingSite) == 0) return TabOrders::MassingSite;
        if (tabName.compare(Tabs::ViewModel) == 0) return TabOrders::ViewModel;
        if (tabName.compare(Tabs::Collaborate) == 0) return TabOrders::Collaborate;
        if (tabName.compare(Tabs::Manage) == 0) return TabOrders::Manage;
        if (tabName.compare(Tabs::AddIns) == 0) return TabOrders::AddIns;
        if (tabName.compare(Tabs::ModifyModel) == 0) return TabOrders::ModifyModel;
        if (tabName.compare(Tabs::VinaBimPlus) == 0) return TabOrders::VinaBimPlus;
        if (tabName.compare(Tabs::VinaCde) == 0) return TabOrders::VinaCde;
        if (tabName.compare(Tabs::IfcVisualize) == 0) return TabOrders::IfcVisualize;
        if (tabName.compare(Tabs::ClashDetect) == 0) return TabOrders::ClashDetect;

        if (tabName.compare(Tabs::CreateFamily) == 0) return TabOrders::CreateFamily;
        if (tabName.compare(Tabs::InsertFamily) == 0) return TabOrders::InsertFamily;
        if (tabName.compare(Tabs::AnnotateFamily) == 0) return TabOrders::AnnotateFamily;
        if (tabName.compare(Tabs::ViewFamily) == 0) return TabOrders::ViewFamily;
        if (tabName.compare(Tabs::ModifyFamily) == 0) return TabOrders::ModifyFamily;
        return TabOrders::DefaultPlugin;
    }

    /**
     * @brief Sets or overrides the ordering priority of any ribbon tab.
     * @param tabName Target tab name.
     * @param order Ordering priority (lower values appear first; TabOrders::EndOfRibbon places at the end).
     */
    static void SetTabOrder(const OdString& tabName, int order)
    {
        RibbonTab* tab = GetActiveControl().FindTab(tabName);
        if (tab)
            tab->SetOrder(order);
        else
            GetActiveControl().CreateRibbonTab(tabName, TabVisibility::DocumentOnly, order);
    }

    /**
     * @brief Gets the configured or canonical ordering priority of a ribbon tab.
     * @param tabName Target tab name.
     * @return Order priority integer.
     */
    static int GetTabOrder(const OdString& tabName)
    {
        const RibbonTab* tab = GetActiveControl().FindTab(tabName);
        return tab ? tab->GetOrder() : GetCanonicalTabOrder(tabName);
    }

    /**
     * @brief Places a ribbon tab at the far end of the ribbon bar.
     * @param tabName Target tab name.
     */
    static void MoveTabToEnd(const OdString& tabName)
    {
        SetTabOrder(tabName, TabOrders::EndOfRibbon);
    }

    /**
     * @brief Returns the shared active RibbonControl registry for plugin commands.
     * @return Reference to static active RibbonControl instance.
     */
    static RibbonControl& GetActiveControl()
    {
        static RibbonControl s_activeControl;
        return s_activeControl;
    }

    /**
     * @brief Static helper to create or retrieve a ribbon tab with visibility context and order.
     * @param tabName Tab label name.
     * @param vis Contextual visibility rule.
     * @param order Ordering priority (lower values appear first).
     * @return Pointer to created or found RibbonTab.
     */
    static RibbonTab* CreateTab(const OdString& tabName, TabVisibility vis = TabVisibility::DocumentOnly, int order = kDefaultPluginTabOrder)
    { return GetActiveControl().CreateRibbonTab(tabName, vis, order); }

    /**
     * @brief Static helper to create or retrieve a contextual ribbon tab.
     * @param tabName Tab label name.
     * @param contextId Context identifier.
     * @param returnTab Return tab name on exit.
     * @return Pointer to created contextual RibbonTab.
     */
    static RibbonTab* CreateContextTab(const OdString& tabName, const OdString& contextId, const OdString& returnTab = OD_T(""))
    { return GetActiveControl().CreateContextualTab(tabName, contextId, returnTab); }

    /**
     * @brief Static helper to create or retrieve a panel within a specified tab.
     * @param tabName Target tab name.
     * @param panelName Panel name.
     * @param vis Contextual visibility rule for the tab if created.
     * @param tabOrder Ordering priority for the tab if created.
     * @param panelOrder Ordering priority for the panel within the tab.
     * @return Pointer to created or found RibbonPanel.
     */
    static RibbonPanel* CreatePanel(const OdString& tabName, const OdString& panelName, TabVisibility vis = TabVisibility::DocumentOnly, int tabOrder = kDefaultPluginTabOrder, int panelOrder = 0)
    { return GetActiveControl().CreateRibbonPanel(tabName, panelName, vis, tabOrder, panelOrder); }

    /**
     * @brief Resets all registered ribbon definitions (clears tab registry).
     */
    static void Reset()
    {
        GetActiveControl().m_tabs.clear();
    }

private:
    std::vector<std::shared_ptr<RibbonTab>> m_tabs;
};

} // namespace VBimRibbon
