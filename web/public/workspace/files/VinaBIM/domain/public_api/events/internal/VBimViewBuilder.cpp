#include "pch.h"
#include "VBimViewBuilder.h"
#include "Host/view/ViewPipeline/ViewPipelineContext.h"

VBimView MakeVBimView(OdBmDatabase* db, const OdBmDBViewPtr& pDbView)
{
    VBimView v;
    v.database = db;
    if (!db || pDbView.isNull())
        return v;

    v.viewId           = pDbView->id();
    v.drawingId        = pDbView->getDbDrawingId();
    v.stableViewHandle = static_cast<OdUInt64>(v.viewId.getHandle());
    v.viewName         = pDbView->getViewName();

    const ViewPipelineContext ctx = buildViewPipelineContext(pDbView);
    switch (ctx.group)
    {
    case VbViewGroup::ThreeD:    v.viewType = VBimViewType::ThreeD;   break;
    case VbViewGroup::Sheet:     v.viewType = VBimViewType::Sheet;    break;
    case VbViewGroup::Plan:
    case VbViewGroup::CeilingPlan:
    case VbViewGroup::Elevation:
    case VbViewGroup::Section:
    case VbViewGroup::AreaPlan:  v.viewType = VBimViewType::Drafting; break;
    default:                     v.viewType = VBimViewType::Other;    break;
    }
    return v;
}

VBimView MakeEmptyVBimView() { return {}; }
