#include "pch.h"
#include "domain/public_api/app/VBimUIDocument.h"
#include "domain/public_api/undo/VBimUndoApi.h"
#include "domain/public_api/selection/VBimSelection.h"
#include "domain/public_api/selection/VBimSelectionService.h"
#include "domain/public_api/events/internal/VBimViewBuilder.h"
#include "Host/sdk/Selection/VBimSelectionHost.h"
#include "Host/sdk/View/VBimViewHost.h"
#include "Host/Document/VinaBIMDoc.h"   // CVinaBIMDoc::database(), getActiveViewer()
#include "Host/view/VinaBIMView.h"       // CVinaBIMView::getActiveDbView()
#include "Host/application/VinaBIM.h"   // theApp, settings()
#include "Database/Entities/BmDBDrawing.h"
#include "Database/Entities/BmDbView.h"

// vbimGetComponentActionTrigger, vbimInvalidateActiveView — from vbedvds.h
// (transitively included via VBimUIDocument.h -> ../../vinaBIMCore/vbedvds.h)

OdBmDatabase* VBimUIDocument::GetDatabase() const
{
    if (!m_pDoc)
        return nullptr;
    return m_pDoc->database();
}

VBimProjectProperties VBimUIDocument::ProjectProperties()
{
    return VBimProjectProperties(GetDatabase(), this);
}

VBimElementProperties VBimUIDocument::GetElementProperties(const OdBmObjectId& elementId)
{
    return VBimElementProperties(GetDatabase(), elementId, this);
}

VBimElementProperties VBimUIDocument::GetActiveSelectionProperties()
{
    VBimSelection* pSel = Selection();
    return pSel ? pSel->GetActiveProperties() : VBimElementProperties();
}

bool VBimUIDocument::IsFamilyDocument() const
{
    // Global flag; not per-document in MDI sessions. See header limitation note.
    return vbimGetComponentActionTrigger();
}

void VBimUIDocument::RefreshActiveView()
{
    if (!m_pDoc)
        return;
    OdBmDatabase* pDb = m_pDoc->database();
    if (!pDb)
        return;
    // Lightweight invalidation: marks the GsView dirty without full regen.
    vbimInvalidateActiveView(pDb);
}

ODCOLORREF VBimUIDocument::GetActiveBackgroundColor() const
{
    return theApp.settings().getActiveBackground();
}

void VBimUIDocument::RefreshProjectBrowser()
{
    if (!m_pDoc)
        return;
    m_pDoc->RefreshProjectBrowser();
}

void VBimUIDocument::RefreshProjectBrowser(bool bForceReload)
{
    if (!m_pDoc)
        return;
    m_pDoc->RefreshProjectBrowser(bForceReload);
}

namespace
{
// Layout drawing that shows viewOrDrawingId: the id itself when it is a drawing,
// else the view's drawing (searched among the layouts when unassigned). kNull
// when the id is neither, or when the id or its drawing belongs to a database
// other than pDb (ids come from plugins and may be from another open document).
// May throw OdError (safeOpenObject).
OdBmObjectId ResolveViewDrawingId(OdBmDatabase* pDb, const OdBmObjectId& viewOrDrawingId)
{
    if (viewOrDrawingId.database() != pDb)
        return OdBmObjectId::kNull;
    OdBmObjectPtr pObj = viewOrDrawingId.safeOpenObject();
    if (pObj.isNull())
        return OdBmObjectId::kNull;

    if (pObj->isKindOf(OdBmDBDrawing::desc()))
        return viewOrDrawingId;
    if (!pObj->isKindOf(OdBmDBView::desc()))
        return OdBmObjectId::kNull;

    OdBmObjectId drawingId;
    OdBmDBViewPtr pView = OdBmDBView::cast(pObj);
    if (!pView.isNull())
        drawingId = pView->getDbDrawingId();

    // Fallback: search layouts if getDbDrawingId() is unassigned
    if (drawingId.isNull())
    {
        OdDbBaseDatabasePEPtr pDbPE(pDb);
        if (!pDbPE.isNull())
        {
            for (OdBmDBDrawingPtr pDBDrawing : pDbPE->layouts(pDb))
            {
                if (!pDBDrawing.isNull() && pDBDrawing->getBaseDBViewId() == viewOrDrawingId)
                {
                    drawingId = pDBDrawing->id();
                    break;
                }
            }
        }
    }
    if (!drawingId.isNull() && drawingId.database() != pDb)
        return OdBmObjectId::kNull;
    return drawingId;
}
} // namespace

bool VBimUIDocument::OpeningSchedule(const OdBmObjectId& scheduleId)
{
    AFX_MANAGE_STATE(AfxGetAppModuleState());

    if (!m_pDoc || scheduleId.isNull())
        return false;

    OdBmDatabase* pDb = m_pDoc->database();
    if (!pDb)
        return false;

    try
    {
        const OdBmObjectId drawingId = ResolveViewDrawingId(pDb, scheduleId);
        if (drawingId.isNull())
            return false;

        // Verify base view type: only Schedule, ColumnSchedule, or PanelSchedule are allowed
        OdBmDBDrawingPtr pDrawing = drawingId.safeOpenObject();
        if (pDrawing.isNull())
            return false;

        OdBmDBViewPtr pBaseView = pDrawing->getBaseDBViewId().safeOpenObject();
        if (pBaseView.isNull())
            return false;

        const OdBm::ViewType::Enum viewType = pBaseView->getViewType();
        if (viewType != OdBm::ViewType::Schedule &&
            viewType != OdBm::ViewType::ColumnSchedule &&
            viewType != OdBm::ViewType::PanelSchedule)
        {
            return false;
        }

        m_pDoc->OnViewer(drawingId);
        m_pDoc->RefreshProjectBrowser();
        return true;
    }
    catch (const OdError&)
    {
        return false;
    }
    catch (...)
    {
        return false;
    }
}

bool VBimUIDocument::OpenView(const OdBmObjectId& viewId)
{
    AFX_MANAGE_STATE(AfxGetAppModuleState());

    if (!m_pDoc || viewId.isNull())
        return false;

    OdBmDatabase* pDb = m_pDoc->database();
    if (!pDb)
        return false;

    try
    {
        const OdBmObjectId drawingId = ResolveViewDrawingId(pDb, viewId);
        if (drawingId.isNull())
            return false;

        OdBmDBDrawingPtr pDrawing = OdBmDBDrawing::cast(drawingId.openObject());
        if (pDrawing.isNull())
            return false;

        // A template has no window of its own.
        OdBmDBViewPtr pBaseView = OdBmDBView::cast(pDrawing->getBaseDBViewId().openObject());
        if (pBaseView.isNull() || pBaseView->getIsTemplate())
            return false;

        m_pDoc->OnViewer(drawingId);
        m_pDoc->RefreshProjectBrowser();
        return true;
    }
    catch (const OdError&)
    {
        return false;
    }
    catch (...)
    {
        return false;
    }
}

bool VBimUIDocument::OpenSchedule(const OdBmObjectId& scheduleId)
{
    return OpeningSchedule(scheduleId);
}

VBimSelection* VBimUIDocument::Selection()
{
    return SelectionService();
}

VBimSelectionService* VBimUIDocument::SelectionService()
{
    if (!m_pDoc)
        return nullptr;
    // Proxy pattern: single static instance reused per call.
    // Uses friend access (VBimSelection declares friend class VBimUIDocument)
    // to set m_pDoc directly.
    static VBimSelectionService s_proxy;
    s_proxy.SetInternalDoc(m_pDoc);
    return &s_proxy;
}

void VBimUIDocument::ShowElements(const OdBmObjectIdArray& ids)
{
    const OdResult res = TryShowElements(ids);
    if (res != eOk)
    {
        CString msg;
        msg.Format(L"[SDK] ShowElements failed with OdResult %d.", static_cast<int>(res));
        LOG(msg);
    }
}

OdResult VBimUIDocument::TryShowElements(const OdBmObjectIdArray& ids)
{
    if (ids.isEmpty())
        return eInvalidInput;
    const OdResult res = VBimSelectionHost::SetSelection(m_pDoc, ids);
    if (res != eOk)
        return res;
    return VBimSelectionHost::ZoomToElements(m_pDoc, ids);
}

OdResult VBimUIDocument::GetOpenUIViews(OdArray<VBimView>& views) const
{
    return VBimViewHost::GetOpenViews(m_pDoc, views);
}

OdResult VBimUIDocument::RequestViewChange(const OdBmObjectId& viewId)
{
    return VBimViewHost::RequestViewChange(m_pDoc, viewId);
}

OdResult VBimUIDocument::ZoomToFit()
{
    return VBimViewHost::ZoomToFit(m_pDoc);
}

VBimView VBimUIDocument::ActiveView() const
{
    if (!m_pDoc)
        return MakeEmptyVBimView();
    CVinaBIMView* pView = m_pDoc->getActiveViewer();
    if (!pView)
        return MakeEmptyVBimView();
    return MakeVBimView(m_pDoc->database(), pView->getActiveDbView());
}

OdUInt64 VBimUIDocument::ActiveViewId() const
{
    return ActiveView().stableViewHandle;
}

void VBimUIDocument::SetInternalDoc(CVinaBIMDoc* pDoc)
{
    m_pDoc = pDoc;
}

namespace {
CVinaBIMDoc* ResolveTargetDoc(CVinaBIMDoc* defaultDoc, const OdDbBaseDatabase* pBaseDb)
{
    if (pBaseDb)
    {
        if (pBaseDb->isKindOf(OdBmDatabase::desc()))
        {
            const OdBmDatabase* pDb = static_cast<const OdBmDatabase*>(pBaseDb);
            return CVinaBIMDoc::GetDocFromDatabase(pDb);
        }
        return nullptr;
    }
    return defaultDoc;
}
} // namespace

void VBimUIDocument::RecordUndoActionForDatabase(const OdBmDatabase* pDb, std::shared_ptr<IUndoableAction> action)
{
    if (!action || !pDb)
        return;

    if (CVinaBIMDoc* pOwningDoc = CVinaBIMDoc::GetDocFromDatabase(pDb))
    {
        pOwningDoc->RecordUndoAction(action);
    }
}

void VBimUIDocument::RecordUndoAction(std::shared_ptr<IUndoableAction> action)
{
    if (!action)
        return;

    CVinaBIMDoc* pTargetDoc = m_pDoc;
    if (const void* pCtx = action->GetDatabaseContext())
    {
        pTargetDoc = ResolveTargetDoc(m_pDoc, static_cast<const OdDbBaseDatabase*>(pCtx));
    }

    if (pTargetDoc)
        pTargetDoc->RecordUndoAction(action);
}

void VBimUIDocument::RecordCreated(const OdBmObjectIdArray& ids, const OdString& name)
{
    if (ids.isEmpty())
        return;
    const OdDbBaseDatabase* pDb = ids.first().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    std::vector<OdBmObjectId> vec;
    vec.reserve(ids.size());
    for (OdUInt32 i = 0; i < ids.size(); ++i)
        vec.push_back(ids[i]);
    pDoc->RecordUndoAction(std::make_shared<OdaCreateDeltaAction>(pDoc->database(), vec, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordCreated(const OdBmObjectId& id, const OdString& name)
{
    if (id.isNull())
        return;
    const OdDbBaseDatabase* pDb = id.database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaCreateDeltaAction>(pDoc->database(), id, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordCreated(const std::vector<OdBmObjectId>& ids, const OdString& name)
{
    if (ids.empty())
        return;
    const OdDbBaseDatabase* pDb = ids.front().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaCreateDeltaAction>(pDoc->database(), ids, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordMoved(const OdBmObjectIdArray& ids, const OdGeVector3d& delta, const OdString& name)
{
    if (ids.isEmpty() || delta.lengthSqrd() <= 1e-12)
        return;
    const OdDbBaseDatabase* pDb = ids.first().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaTransformDeltaAction>(pDoc->database(), ids, delta, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordMoved(const OdBmObjectId& id, const OdGeVector3d& delta, const OdString& name)
{
    if (id.isNull() || delta.lengthSqrd() <= 1e-12)
        return;
    const OdDbBaseDatabase* pDb = id.database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    std::vector<OdBmObjectId> vec;
    vec.push_back(id);
    pDoc->RecordUndoAction(std::make_shared<OdaTransformDeltaAction>(pDoc->database(), vec, delta, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordMoved(const std::vector<OdBmObjectId>& ids, const OdGeVector3d& delta, const OdString& name)
{
    if (ids.empty() || delta.lengthSqrd() <= 1e-12)
        return;
    const OdDbBaseDatabase* pDb = ids.front().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaTransformDeltaAction>(pDoc->database(), ids, delta, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordRotated(const OdBmObjectId& id, const OdGePoint3d& center, const OdGeVector3d& axis, double angle, const OdString& name)
{
    if (id.isNull() || fabs(angle) <= 1e-12)
        return;
    const OdDbBaseDatabase* pDb = id.database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaRotateDeltaAction>(pDoc->database(), id, center, axis, angle, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordErased(const OdBmObjectIdArray& ids, const OdString& name)
{
    if (ids.isEmpty())
        return;
    const OdDbBaseDatabase* pDb = ids.first().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaEraseDeltaAction>(pDoc->database(), ids, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordErased(const OdBmObjectId& id, const OdString& name)
{
    if (id.isNull())
        return;
    const OdDbBaseDatabase* pDb = id.database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    OdBmObjectIdArray arr;
    arr.push_back(id);
    pDoc->RecordUndoAction(std::make_shared<OdaEraseDeltaAction>(pDoc->database(), arr, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordErased(const std::vector<OdBmObjectId>& ids, const OdString& name)
{
    if (ids.empty())
        return;
    const OdDbBaseDatabase* pDb = ids.front().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    OdBmObjectIdArray arr;
    arr.reserve(static_cast<OdUInt32>(ids.size()));
    for (const auto& id : ids)
        arr.push_back(id);
    pDoc->RecordUndoAction(std::make_shared<OdaEraseDeltaAction>(pDoc->database(), arr, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordMatrixTransformed(const OdBmObjectIdArray& ids, const OdGeMatrix3d& matrix, const OdString& name)
{
    if (ids.isEmpty() || matrix.isEqualTo(OdGeMatrix3d::kIdentity))
        return;
    const OdDbBaseDatabase* pDb = ids.first().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaMatrixDeltaAction>(pDoc->database(), ids, matrix, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordMatrixTransformed(const OdBmObjectId& id, const OdGeMatrix3d& matrix, const OdString& name)
{
    if (id.isNull() || matrix.isEqualTo(OdGeMatrix3d::kIdentity))
        return;
    const OdDbBaseDatabase* pDb = id.database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaMatrixDeltaAction>(pDoc->database(), id, matrix, std::wstring(name.c_str())));
}

void VBimUIDocument::RecordMatrixTransformed(const std::vector<OdBmObjectId>& ids, const OdGeMatrix3d& matrix, const OdString& name)
{
    if (ids.empty() || matrix.isEqualTo(OdGeMatrix3d::kIdentity))
        return;
    const OdDbBaseDatabase* pDb = ids.front().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return;
    pDoc->RecordUndoAction(std::make_shared<OdaMatrixDeltaAction>(pDoc->database(), ids, matrix, std::wstring(name.c_str())));
}

/**
 * @brief Creates a snapshot delta action for a single element to record property changes.
 * @param id Object ID of the element being modified.
 * @param name User-facing display name of the operation.
 * @return Shared pointer to snapshot delta action, or nullptr on failure.
 */
std::shared_ptr<OdaSnapshotDeltaAction> VBimUIDocument::RecordSnapshot(const OdBmObjectId& id, const OdString& name)
{
    if (id.isNull())
        return nullptr;
    const OdDbBaseDatabase* pDb = id.database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return nullptr;
    auto action = std::make_shared<OdaSnapshotDeltaAction>(pDoc->database(), id, std::wstring(name.c_str()));
    return action->HasPreState() ? action : nullptr;
}

void VBimUIDocument::CommitSnapshot(const OdBmDatabase* database,
    const std::shared_ptr<OdaSnapshotDeltaAction>& snapshot)
{
    if (!snapshot || !snapshot->HasPreState() || snapshot->GetDatabaseContext()!=database ||
        !CVinaBIMDoc::GetDocFromDatabase(database)) throw OdError(eInvalidInput);
    snapshot->CommitPostState();
    if (!snapshot->HasPostState()) throw OdError(eInvalidInput);
    RecordUndoActionForDatabase(database, snapshot);
}

/**
 * @brief Creates a snapshot delta action for multiple elements to record property changes.
 * @param ids Array of element object IDs being modified.
 * @param name User-facing display name of the operation.
 * @return Shared pointer to snapshot delta action, or nullptr on failure.
 */
std::shared_ptr<OdaSnapshotDeltaAction> VBimUIDocument::RecordSnapshot(const OdBmObjectIdArray& ids, const OdString& name)
{
    if (ids.isEmpty())
        return nullptr;
    const OdDbBaseDatabase* pDb = ids.first().database();
    if (!pDb && m_pDoc)
        pDb = m_pDoc->database();
    CVinaBIMDoc* pDoc = ResolveTargetDoc(m_pDoc, pDb);
    if (!pDoc || !pDoc->database())
        return nullptr;
    auto action = std::make_shared<OdaSnapshotDeltaAction>(pDoc->database(), ids, std::wstring(name.c_str()));
    return action->HasPreState() ? action : nullptr;
}

/**
 * @brief Begins a composite undo transaction on the underlying document.
 * @param name Descriptive action name for the composite group.
 */
void VBimUIDocument::BeginCompositeUndo(const OdString& name)
{
    if (m_pDoc)
        m_pDoc->BeginCompositeUndo(name.c_str());
}

/**
 * @brief Ends the active composite undo transaction on the underlying document.
 */
void VBimUIDocument::EndCompositeUndo()
{
    if (m_pDoc)
        m_pDoc->EndCompositeUndo();
}

/**
 * @brief Cancels the active composite undo transaction on the underlying document.
 */
void VBimUIDocument::CancelCompositeUndo()
{
    if (m_pDoc)
        m_pDoc->CancelCompositeUndo();
}

/**
 * @brief Constructs a scoped composite undo guard bound to the target document.
 * @param pUiDoc Target UI document whose transaction history is being scoped.
 * @param name Descriptive action name for the composite group.
 */
VBimCompositeUndoScope::VBimCompositeUndoScope(VBimUIDocument* pUiDoc, const OdString& name)
    : m_pDoc(pUiDoc ? pUiDoc->m_pDoc : nullptr)
    , m_closed(false)
    , m_uncaughtExceptions(std::uncaught_exceptions())
{
    if (!m_pDoc)
    {
        m_pDoc = theApp.GetActiveDocument();
    }
    if (m_pDoc)
    {
        m_pDoc->BeginCompositeUndo(name.c_str());
    }
}

/**
 * @brief Constructs a scoped composite undo guard bound directly to an explicit database.
 * @param pDb Target ODA database whose owning document tracks the composite.
 * @param name Descriptive action name for the composite group.
 */
VBimCompositeUndoScope::VBimCompositeUndoScope(const OdBmDatabase* pDb, const OdString& name)
    : m_pDoc(CVinaBIMDoc::GetDocFromDatabase(pDb))
    , m_closed(false)
    , m_uncaughtExceptions(std::uncaught_exceptions())
{
    if (!m_pDoc)
    {
        m_pDoc = theApp.GetActiveDocument();
    }
    if (m_pDoc)
    {
        m_pDoc->BeginCompositeUndo(name.c_str());
    }
}

/**
 * @brief Destructs the composite scope, rolling back on exception or committing normally.
 */
VBimCompositeUndoScope::~VBimCompositeUndoScope()
{
    if (!m_closed && m_pDoc)
    {
        if (std::uncaught_exceptions() > m_uncaughtExceptions)
        {
            m_pDoc->CancelCompositeUndo();
        }
        else
        {
            m_pDoc->EndCompositeUndo();
        }
    }
}

/**
 * @brief Explicitly commits and closes the composite undo scope.
 */
void VBimCompositeUndoScope::Commit()
{
    if (!m_closed && m_pDoc)
    {
        m_pDoc->EndCompositeUndo();
        m_closed = true;
    }
}

/**
 * @brief Explicitly cancels and rolls back the composite undo scope.
 */
void VBimCompositeUndoScope::Cancel()
{
    if (!m_closed && m_pDoc)
    {
        m_pDoc->CancelCompositeUndo();
        m_closed = true;
    }
}



bool VBimUIDocument::RestoreSnapshot(const OdBmDatabase* database,
    const std::shared_ptr<OdaSnapshotDeltaAction>& snapshot)
{
    if (!database || !snapshot || !snapshot->HasPreState() || snapshot->GetDatabaseContext() != database) return false;
    if (!CVinaBIMDoc::GetDocFromDatabase(database)) return false;
    try { snapshot->Undo(); return true; }
    catch (const OdError& error) { LOG(CString(L"[DIM Undo] Restore failed: ") + error.description().c_str()); }
    catch (...) { LOG(L"[DIM Undo] Restore failed."); }
    return false;
}
