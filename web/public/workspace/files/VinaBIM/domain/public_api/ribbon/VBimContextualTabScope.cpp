/**
 * @file VBimContextualTabScope.cpp
 * @brief Implementation of VBimContextualTabScope RAII guard.
 */

#include "pch.h"
#include "VBimContextualTabScope.h"
#include "../app/VBimUIApplication.h"

namespace vb::ui::ribbon
{
    VBimContextualTabScope::VBimContextualTabScope(const OdString& contextId, bool autoShow)
        : m_contextId(contextId)
    {
        if (autoShow && !m_contextId.isEmpty())
        {
            Show(m_contextId);
        }
    }

    VBimContextualTabScope::VBimContextualTabScope(const VBimRibbon::TabDef& tabDef, RibbonControlCallback callback)
    {
        Show(tabDef, std::move(callback));
    }

    VBimContextualTabScope::VBimContextualTabScope(const OdString& tabName,
                                                   const std::vector<VBimRibbon::PanelDef>& panels,
                                                   const OdString& returnTab,
                                                   RibbonControlCallback callback)
    {
        Show(tabName, panels, returnTab, std::move(callback));
    }

    VBimContextualTabScope::~VBimContextualTabScope()
    {
        Hide();
    }

    VBimContextualTabScope::VBimContextualTabScope(VBimContextualTabScope&& other) noexcept
        : m_contextId(std::move(other.m_contextId))
        , m_token(other.m_token)
    {
        other.m_token = 0;
    }

    VBimContextualTabScope& VBimContextualTabScope::operator=(VBimContextualTabScope&& other) noexcept
    {
        if (this != &other)
        {
            Hide();
            m_contextId = std::move(other.m_contextId);
            m_token = other.m_token;
            other.m_token = 0;
        }
        return *this;
    }

    OdResult VBimContextualTabScope::Show(const VBimRibbon::TabDef& tabDef, RibbonControlCallback callback)
    {
        Hide();
        if (tabDef.name.isEmpty())
            return eInvalidInput;
        return VBimUIApplication::Instance().PushContextualTab(tabDef, std::move(callback), m_token);
    }

    OdResult VBimContextualTabScope::Show(const OdString& tabName,
                                          const std::vector<VBimRibbon::PanelDef>& panels,
                                          const OdString& returnTab,
                                          RibbonControlCallback callback)
    {
        if (tabName.isEmpty())
            return eInvalidInput;

        VBimRibbon::TabDef tabDef;
        tabDef.name = tabName;
        tabDef.panels = panels;
        tabDef.returnTab = returnTab;
        tabDef.isContextual = true;
        return Show(tabDef, std::move(callback));
    }

    OdResult VBimContextualTabScope::Show(const OdString& contextId)
    {
        Hide();
        if (contextId.isEmpty())
            return eInvalidInput;

        m_contextId = contextId;
        return VBimUIApplication::Instance().PushContextualTab(m_contextId, m_token);
    }

    OdResult VBimContextualTabScope::Show()
    {
        if (m_contextId.isEmpty())
            return eInvalidInput;
        const OdString contextId = m_contextId;
        return Show(contextId);
    }

    void VBimContextualTabScope::Hide()
    {
        if (m_token != 0)
        {
            VBimUIApplication::Instance().PopContextualTab(m_token);
            m_token = 0;
        }
    }

    bool VBimContextualTabScope::IsActive() const noexcept
    {
        return VBimUIApplication::Instance().IsContextualTabOwned(m_token);
    }
}
