/**
 * @file VBimOptionBarScope.cpp
 * @brief Implementation of VBimOptionBarScope RAII guard.
 */

#include "pch.h"
#include "VBimOptionBarScope.h"
#include "../app/VBimUIApplication.h"

namespace vb::ui::optionbar
{
    VBimOptionBarScope::VBimOptionBarScope(
        const OdString& commandName,
        const std::vector<OptionItem>& items,
        OptionBarCallback callback)
    {
        Show(commandName, items, std::move(callback));
    }

    VBimOptionBarScope::VBimOptionBarScope(
        const std::vector<OptionItem>& items,
        OptionBarCallback callback)
    {
        Show(items, std::move(callback));
    }

    VBimOptionBarScope::~VBimOptionBarScope()
    {
        Close();
    }

    VBimOptionBarScope::VBimOptionBarScope(VBimOptionBarScope&& other) noexcept
        : m_token(other.m_token)
    {
        other.m_token = 0;
    }

    VBimOptionBarScope& VBimOptionBarScope::operator=(VBimOptionBarScope&& other) noexcept
    {
        if (this != &other)
        {
            Close();
            m_token = other.m_token;
            other.m_token = 0;
        }
        return *this;
    }

    OdResult VBimOptionBarScope::Show(
        const OdString& commandName,
        const std::vector<OptionItem>& items,
        OptionBarCallback callback)
    {
        Close();
        return VBimUIApplication::Instance().PushOptionBar(commandName, items, std::move(callback), m_token);
    }

    OdResult VBimOptionBarScope::Show(
        const std::vector<OptionItem>& items,
        OptionBarCallback callback)
    {
        // An empty command name keeps the name currently shown.
        return Show(OdString::kEmpty, items, std::move(callback));
    }

    void VBimOptionBarScope::Close()
    {
        if (m_token != 0)
        {
            VBimUIApplication::Instance().PopOptionBar(m_token);
            m_token = 0;
        }
    }

    bool VBimOptionBarScope::IsActive() const noexcept
    {
        return VBimUIApplication::Instance().IsOptionBarOwner(m_token);
    }

    OdResult VBimOptionBarScope::SetValue(int id, const OptionItem& item)
    {
        if (!IsActive())
            return eNotApplicable;
        return VBimUIApplication::Instance().SetOptionBarValue(id, item);
    }

    OdResult VBimOptionBarScope::SetValue(int id, const std::wstring& textVal)
    {
        OptionItem item;
        item.id = id;
        item.type = OptionType::Text;
        item.textVal = textVal;
        return SetValue(id, item);
    }

    OdResult VBimOptionBarScope::SetValue(int id, double numVal)
    {
        OptionItem item;
        item.id = id;
        item.type = OptionType::Number;
        item.numVal = numVal;
        return SetValue(id, item);
    }

    OdResult VBimOptionBarScope::SetValue(int id, bool checked)
    {
        OptionItem item;
        item.id = id;
        item.type = OptionType::Check;
        item.checked = checked;
        return SetValue(id, item);
    }

    OdResult VBimOptionBarScope::SetEnabled(int id, bool enabled)
    {
        if (!IsActive())
            return eNotApplicable;
        return VBimUIApplication::Instance().SetOptionBarEnabled(id, enabled);
    }

    OdResult VBimOptionBarScope::SetActiveCommand(const OdString& commandName)
    {
        if (!IsActive())
            return eNotApplicable;
        return VBimUIApplication::Instance().SetOptionBarActiveCommand(commandName);
    }
}
