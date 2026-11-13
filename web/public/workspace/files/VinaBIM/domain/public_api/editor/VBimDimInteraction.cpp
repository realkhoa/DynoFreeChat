#include "pch.h"
#include "VBimDimInteraction.h"
#include "Host/sdk/Selection/VBimDimHostBridge.h"
#include "Host/sdk/Selection/DimProviderRegistration.h"
#include "Host/application/VinaBIM.h"
#include "Host/Document/VinaBIMDoc.h"
#include "Host/view/VinaBIMView.h"
#include "domain/public_api/app/VBimUIApplication.h"
#include "domain/public_api/app/VBimUIDocument.h"
#include "domain/public_api/selection/VBimSelection.h"
#include "Database/Entities/BmDBDrawing.h"
#include "Essential/Entities/BmDimension.h"
#include "Infrastructure/Oda/dependencies/LinearDimensionDependencyIndex.h"
#include "Gi/GiDrawable.h"
#include "domain/selection/VBimPickTracker.h"
#include "Gs/GsModel.h"
#include <map>
#include <set>
#include <cmath>

namespace
{
    DimProviderRegistration<IVBimDimInteraction> slot;
    auto*& provider = slot.provider;
    auto& registration = slot.token;
    VBimDimToken nextToken = 0;
    bool invalidating = false;
    CVinaBIMDoc* document = nullptr;
    CVinaBIMView* viewer = nullptr;
    OdGsView* gs = nullptr;
    VBimDimContext context;
    VBimDimTarget pending;
    VBimDimToken dialogContext = 0;
    ULONGLONG lastDialogClose = 0;
    struct Preview { OdGiDrawablePtr drawable; OdGsView* view; OdGsModel* model; };
    std::map<VBimDimToken, Preview> previews;
    VBimDimToken queryToken=0, queryContext=0;
    OdSmartPtr<VBimPickTracker> queryTracker;
    void closeQuery() noexcept
    {
        queryToken=0; queryContext=0;
        auto tracker=queryTracker; queryTracker=nullptr;
        try { if(!tracker.isNull()) tracker->cleanup(); } catch(...) {}
    }

    bool uiThread() { return AfxGetApp() && ::GetCurrentThreadId() == AfxGetApp()->m_nThreadID; }
    using Dispatch = DimProviderRegistration<IVBimDimInteraction>::Invocation;
    template<class F, class T> T call(F function, T failure)
    {
        if (!uiThread() || !provider) return failure;
        Dispatch scope(slot);
        try { return function(*provider); }
        catch (const OdError& error) { LOG(CString(L"[DIM API] ") + error.description().c_str()); }
        catch (...) { LOG(L"[DIM API] Provider dispatch failed; operation cancelled."); }
        return failure;
    }
    void detachAll() noexcept
    {
        for (auto& item : previews)
        {
            try { item.second.view->erase(item.second.drawable); } catch (...) {}
        }
        previews.clear();
    }
    void invalidate() noexcept
    {
        if (invalidating) return;
        invalidating = true;
        const auto old = context.token;
        // Unpublish first: a reentrant call cannot recreate/use this context
        // while its old GS objects and provider state are being detached.
        context = VBimDimContext();
        pending = VBimDimTarget();
        closeQuery();
        detachAll();
        if (old && provider)
        {
            Dispatch scope(slot);
            provider->Invalidate(old);
        }
        document = nullptr; viewer = nullptr; gs = nullptr;
        invalidating = false;
    }
    bool current()
    {
        return context.token && ::IsWindow(context.window) &&
            theApp.GetActiveDocument() == document && theApp.GetActiveView() == viewer &&
            document->database() == context.database && viewer->getActiveView() == gs &&
            viewer->getActiveDBDrawingId() == context.drawingId;
    }
}

VBimDimToken vbimRegisterDimInteraction(unsigned version, IVBimDimInteraction* value)
{
    if (!uiThread() || version != VBIM_DIM_INTERACTION_VERSION || !value || provider) return 0;
    return slot.attach(value);
}
OdResult vbimUnregisterDimInteraction(VBimDimToken token)
{
    if (!uiThread()) return eNotApplicable;
    if (!token || token != registration) return eOk;
    if (!slot.canDetach(token) || dialogContext) return eNotApplicable;
    invalidate(); slot.detach(token);
    return eOk;
}
bool vbimGetDimContext(VBimDimContext& result)
try
{
    if (!uiThread() || !provider || invalidating) return false;
    if (!current())
    {
        invalidate();
        auto* doc = theApp.GetActiveDocument();
        auto* view = theApp.GetActiveView();
        if (!doc || !view || !view->getActiveView() || !::IsWindow(view->GetSafeHwnd())) return false;
        const auto drawingId = view->getActiveDBDrawingId();
        if (drawingId.isNull()) return false;
        OdBmDBDrawingPtr drawing = drawingId.openObject();
        if (drawing.isNull()) return false;
        document = doc; viewer = view; gs = view->getActiveView();
        context.token = ++nextToken;
        context.database = doc->database(); context.window = view->GetSafeHwnd();
        context.drawingId = drawingId; context.viewId = drawing->getBaseDBViewId();
    }
    context.worldToDevice = gs->worldToDeviceMatrix();
    OdGePoint2d ll, ur; gs->getViewport(ll, ur);
    OdGsDCRect rectangle; gs->getViewport(rectangle);
    const double width = std::abs(double(rectangle.m_max.x - rectangle.m_min.x)) * (ur.x - ll.x);
    context.worldPerPixel = width > 1e-9 ? std::abs(gs->fieldWidth() / width) : 1.0;
    result = context;
    return true;
}
catch (const OdError& error)
{ LOG(CString(L"[DIM API] Invalid context: ")+error.description().c_str()); invalidate(); return false; }
catch (...) { LOG(L"[DIM API] Invalid context."); invalidate(); return false; }

bool vbimResolveDimContext(VBimDimToken token, VBimDimContext& result)
try
{
    if (!uiThread() || !token || token != context.token) return false;
    if (!current()) { invalidate(); return false; }
    return vbimGetDimContext(result) && result.token == token;
}
catch (const OdError& error)
{ LOG(CString(L"[DIM API] Invalid context: ")+error.description().c_str()); invalidate(); return false; }
catch (...) { LOG(L"[DIM API] Invalid context."); invalidate(); return false; }

bool vbimDimSupports(const OdBmObjectId& id)
{ return call([&](IVBimDimInteraction& p) { return p.Supports(id); }, false); }
bool vbimDimGrips(const OdBmObjectId& id, bool single, OdArray<VBimDimGrip>& grips)
{
    grips.clear();
    // Reserve the annotation kind even when its provider/context is unavailable:
    // falling back to generic bbox grips would allow an unintended element move.
    try { if (id.isNull() || OdBmDimension::cast(id.openObject()).isNull()) return false; }
    catch (...) { return true; }
    VBimDimContext ctx;
    if (!vbimGetDimContext(ctx) || id.database()!=ctx.database) return true;
    const bool resolved = call([&](IVBimDimInteraction& p) {
        if (p.Supports(id)) p.Grips(ctx,id,single,grips);
        return true;
    }, false);
    if (!resolved) grips.clear();
    return true;
}
bool vbimDimTextBox(const OdBmObjectId& id, OdUInt32 segment, VBimDimTextBox& box)
{
    VBimDimContext ctx;
    return vbimGetDimContext(ctx) && id.database() == ctx.database &&
        call([&](IVBimDimInteraction& p) { return p.TextBox(ctx,id,segment,box); }, false);
}
void vbimDimDrawGrip(const OdBmObjectId& id, OdUInt32 segment, const OdBmObjectId& view,
    const OdGePoint3d& eye, double size, OdGiViewportDraw* draw)
{
    call([&](IVBimDimInteraction& p) { p.DrawGrip(id,segment,view,eye,size,draw); return true; }, false);
}
bool vbimDimHitTextBox(const OdBmObjectId& id, OdUInt32 segment, int x, int y)
{
    VBimDimContext ctx;
    if (!vbimGetDimContext(ctx) || id.isNull() || id.database()!=ctx.database) return false;
    return call([&](IVBimDimInteraction& p) {
        auto* text=dynamic_cast<IVBimDimTextHitInteraction*>(&p);
        return text && text->TextHitInteractionVersion()==VBIM_DIM_TEXT_HIT_INTERACTION_VERSION &&
            p.Supports(id) && text->HitTextBox(ctx,id,segment,x,y);
    },false);
}
bool vbimDimBeginDrag(const OdBmObjectId& id, OdUInt32 segment, const OdGePoint3d& point)
{
    VBimDimContext ctx;
    return vbimGetDimContext(ctx) && id.database() == ctx.database &&
        call([&](IVBimDimInteraction& p) { return p.BeginDrag(ctx,id,segment,point); }, false);
}
namespace
{
    bool selectedLine(int x, int y, bool begin)
    {
        VBimDimContext ctx;
        if (!vbimGetDimContext(ctx)) return false;
        auto* doc=VBimUIApplication::Instance().ActiveUIDocument();
        if (!doc || doc->GetDatabase()!=ctx.database) return false;
        const auto ids=doc->Selection()->GetElementIds();
        if (ids.size()!=1 || ids[0].isNull() || ids[0].database()!=ctx.database) return false;
        return call([&](IVBimDimInteraction& p) {
            auto* line=dynamic_cast<IVBimDimLineInteraction*>(&p);
            if (!line || line->LineInteractionVersion()!=VBIM_DIM_LINE_INTERACTION_VERSION || !p.Supports(ids[0])) return false;
            OdGePoint3d hit;
            if (!line->HitLine(ctx,ids[0],x,y,hit)) return false;
            return !begin || line->BeginLineDrag(ctx,ids[0],hit);
        },false);
    }
}
bool vbimDimHitSelectedLine(int x, int y) { return selectedLine(x,y,false); }
bool vbimDimBeginLineDrag(int x, int y) { return selectedLine(x,y,true); }
bool vbimDimWitnessMenu(int x,int y)
{
    VBimDimContext ctx; if(!vbimGetDimContext(ctx)) return false;
    return call([&](IVBimDimInteraction& p) {
        auto* witness=dynamic_cast<IVBimDimWitnessInteraction*>(&p);
        return witness && witness->WitnessInteractionVersion()==VBIM_DIM_WITNESS_INTERACTION_VERSION && witness->ShowWitnessMenu(ctx,x,y);
    },false);
}
bool vbimDimWitnessTab(bool backwards)
{
    VBimDimContext ctx; if(!vbimGetDimContext(ctx)) return false;
    return call([&](IVBimDimInteraction& p) {
        auto* witness=dynamic_cast<IVBimDimWitnessInteraction*>(&p);
        return witness && witness->WitnessInteractionVersion()==VBIM_DIM_WITNESS_INTERACTION_VERSION && witness->CycleWitnessDrag(ctx,backwards);
    },false);
}
VBimDimToken vbimBeginDimReferenceQuery(VBimDimToken token,VBimObjectType mode,IVBimSelectionFilter* filter)
{
    VBimDimContext ctx;
    if(!filter || !vbimResolveDimContext(token,ctx) || queryToken) return 0;
    try
    {
        queryTracker=VBimPickTracker::create(viewer,ctx.database,mode,VBimObjectSnapTypes::All,filter);
        queryTracker->addDrawables(gs);
        queryContext=token; queryToken=++nextToken; return queryToken;
    }
    catch(...) { closeQuery(); LOG(L"[DIM API] Cannot start reference query."); return 0; }
}
bool vbimQueryDimReference(VBimDimToken token,const OdGePoint3d& point,VBimReference& result,bool refresh)
{
    result=VBimReference(); VBimDimContext ctx;
    if(!uiThread() || !token || token!=queryToken || !vbimResolveDimContext(queryContext,ctx)) return false;
    try
    {
        Dispatch scope(slot);
        auto tracker=queryTracker;
        if(refresh) tracker->refresh(); else tracker->setValue(point);
        if(token!=queryToken || !current()) return false;
        result=tracker->result(); return true;
    }
    catch(...) { closeQuery(); LOG(L"[DIM API] Reference query failed."); return false; }
}
bool vbimCycleDimReference(VBimDimToken token,bool backwards,VBimReference& result)
{
    result=VBimReference(); VBimDimContext ctx;
    if(!uiThread() || !token || token!=queryToken || !vbimResolveDimContext(queryContext,ctx)) return false;
    try
    {
        Dispatch scope(slot);
        auto tracker=queryTracker; tracker->cycleCandidate(!backwards); tracker->refresh();
        if(token!=queryToken || !current()) return false;
        result=tracker->result(); return result.isValid;
    }
    catch(...) { closeQuery(); return false; }
}
void vbimEndDimReferenceQuery(VBimDimToken token) noexcept
{ if(uiThread() && token && token==queryToken) closeQuery(); }
bool vbimDimUpdateDrag(const OdGePoint3d& point)
{
    VBimDimContext ctx;
    return vbimGetDimContext(ctx) && call([&](IVBimDimInteraction& p) { return p.UpdateDrag(ctx,point); }, false);
}
bool vbimDimEndDrag(bool commit)
{
    VBimDimContext ctx;
    if (!vbimGetDimContext(ctx)) return false;
    const bool handled = call([&](IVBimDimInteraction& p) { return p.EndDrag(ctx,commit); }, false);
    if (handled && viewer && current())
    {
        auto* doc=VBimUIApplication::Instance().ActiveUIDocument();
        if (doc && doc->GetDatabase()==ctx.database)
        {
            auto* selection=doc->Selection();
            selection->SetElementIds(selection->GetElementIds());
        }
    }
    return handled;
}
bool vbimDimIsDragging()
{
    return uiThread() && current() && provider && provider->IsDragging(context.token);
}
void vbimDimCancelDrag() noexcept
{
    if (!uiThread()) return;
    try { if (current()) { if (provider && provider->IsDragging(context.token)) vbimDimEndDrag(false); } else if (context.token) invalidate(); } catch (...) {}
}
VBimDimToken vbimAttachDimPreview(VBimDimToken token, OdGiDrawable* drawable)
{
    VBimDimContext ctx;
    if (!drawable || !vbimResolveDimContext(token,ctx)) return 0;
    const auto id = ++nextToken;
    Preview preview{drawable, gs, viewer->getGsModel()};
    previews.emplace(id,preview);
    try { gs->add(drawable,preview.model); }
    catch (...) { previews.erase(id); throw; }
    return id;
}
void vbimUpdateDimPreview(VBimDimToken id)
{
    if (!uiThread()) return;
    if (!current()) { invalidate(); return; }
    auto found = previews.find(id); if (found == previews.end()) return;
    auto& preview = found->second;
    if (preview.model) preview.model->onModified(preview.drawable,static_cast<OdGiDrawable*>(nullptr));
    preview.view->invalidate();
    viewer->InvalidateRect(nullptr,FALSE);
}
void vbimDetachDimPreview(VBimDimToken id) noexcept
{
    if (!uiThread()) return;
    auto found = previews.find(id); if (found == previews.end()) return;
    try { found->second.view->erase(found->second.drawable); } catch (...) {}
    previews.erase(found);
}
bool vbimRequestDimTextDialog(const OdBmObjectId& id, OdUInt32 segment)
{
    VBimDimContext ctx;
    if (dialogContext || pending.context || ::GetTickCount64()-lastDialogClose < 600 ||
        !vbimGetDimContext(ctx) || id.isNull() || id.database()!=ctx.database || !vbimDimSupports(id)) return false;
    pending = VBimDimTarget{ctx.token,id,segment};
    if (VBimUIApplication::Instance().RequestPostCommand(L"DIMTEXTDIALOG") != eOk)
    { pending = VBimDimTarget(); return false; }
    return true;
}
bool vbimTakeDimTextTarget(VBimDimTarget& target)
{
    if (!uiThread() || dialogContext) return false;
    const auto value = pending; pending = VBimDimTarget();
    VBimDimContext ctx;
    if (!vbimResolveDimContext(value.context,ctx) || value.dimension.database()!=ctx.database) return false;
    target = value; dialogContext = value.context; return true;
}
void vbimFinishDimTextDialog(VBimDimToken token) noexcept
{
    if (uiThread() && token && dialogContext == token)
    { dialogContext = 0; lastDialogClose = ::GetTickCount64(); }
}
namespace
{
    bool validEraseOwners(OdBmDatabase* db, const OdBmObjectIdArray& ids)
    {
        if (ids.isEmpty()) return false;
        for (const auto& id : ids)
        {
            OdString reason;
            if (id.isNull() || id.database() != db || !vbimCanEraseElement(id, reason)) return false;
        }
        return true;
    }

    // No confirmation/expansion policy here. The ODA adapter verifies native
    // native DIM dependencies; unrelated owners remain erasable when the
    // module is missing. Unknown native data fails closed.
    bool eraseWithoutProvider(OdBmDatabase* db, const OdBmObjectIdArray& ids)
    {
        try
        {
            OdBmObjectIdArray dependencies;
            return LinearDimensionDependencyIndex::Query(db, ids, dependencies)
                && dependencies.isEmpty();
        }
        catch (...) { LOG(L"[DIM API] Error validating erase without a DIM provider."); return false; }
    }
}

bool vbimPrepareDimErase(OdBmDatabase* db, OdBmObjectIdArray& ids)
{
    if (!uiThread() || !db || !validEraseOwners(db, ids)) return false;
    if (!provider)
    {
        if (eraseWithoutProvider(db, ids)) return true;
        LOG(L"[DIM API] Error: erase cancelled because the DIM dependency provider is unavailable.");
        AfxMessageBox(STRING_TABLE(IDS_DIM_PROVIDER_UNAVAILABLE_MSG), MB_OK | MB_ICONWARNING);
        return false;
    }
    return call([&](IVBimDimInteraction& p) { return p.PrepareErase(db,ids); }, false) &&
        validEraseOwners(db, ids);
}
bool vbimValidateDimErase(OdBmDatabase* db, const OdBmObjectIdArray& ids)
{
    // Check all owners again after any modal confirmation and before the
    // executor starts its transaction, including callers without preflight.
    if (!uiThread() || !db || !validEraseOwners(db, ids)) return false;
    if (!provider) return eraseWithoutProvider(db, ids);
    return call([&](IVBimDimInteraction& p) { return p.ValidateErase(db,ids); }, false);
}
void VBimDimHostBridge::Validate() noexcept
{
    if (!uiThread()) return;
    try { if (context.token && !current()) invalidate(); } catch (...) { invalidate(); }
}
void VBimDimHostBridge::ViewUnavailable(CVinaBIMView* view) noexcept
{ if (uiThread() && viewer == view) invalidate(); }

bool VBimDimHostBridge::Matches(OdGsView* view, OdBmDatabase* db) noexcept
{
    return uiThread() && current() && gs==view && context.database==db;
}

bool vbimDimContextMatches(VBimDimToken token, OdGsView* view, OdBmDatabase* db) noexcept
{
    return token && token == context.token && VBimDimHostBridge::Matches(view, db);
}

bool vbimQueryDimensionDependencies(OdBmDatabase* db,
    const OdBmObjectIdArray& elements, OdBmObjectIdArray& dimensions)
{
    dimensions.clear();
    if (!uiThread() || !db) return false;
    const bool complete = LinearDimensionDependencyIndex::Query(db, elements, dimensions);
    if (!complete) LOG(L"[DIM API] Native dependency query failed or encountered unsupported reference data; deletion must be cancelled.");
    return complete;
}
