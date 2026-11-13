///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Selection Engine
// VBimPickerService.cpp — Implementation of interactive picker service.
///////////////////////////////////////////////////////////////////////////////
#include "pch.h"
#include "VBimPickerService.h"
#include "VBimPickTracker.h"
#include "Host/application/VinaBIM.h"
#include "Host/Document/VinaBIMDoc.h"
#include "Host/view/VinaBIMView.h"
#include "Database/BmDatabase.h"
#include "Ed/EdUserIO.h"
#include "BmSSet.h"
#include "AbstractViewPE.h"
#include "Infrastructure/Oda/ex_services/ExTrackers.h"
#include "domain/public_api/selection/VBimReferenceExtractor.h"

VBimPickerService& VBimPickerService::instance()
{
    static VBimPickerService s_instance;
    return s_instance;
}

bool VBimPickerService::pick(
    CVinaBIMDoc* pDoc,
    VBimObjectType mode,
    const OdString& prompt,
    VBimReference& result,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter)
{
    result = VBimReference();
    result.objectType = mode;
    result.snapMode = snapMode;
    result.isValid = false;

    if (!pDoc)
        pDoc = theApp.GetActiveDocument();

    if (!pDoc)
        return false;

    CVinaBIMView* pView = pDoc->getActiveViewer();
    if (!pView)
        pView = pDoc->getViewer();

    if (!pView)
        return false;

    OdBmDatabase* pDb = pDoc->database();
    if (!pDb)
        return false;

    OdSmartPtr<VBimPickTracker> pTracker = VBimPickTracker::create(pView, pDb, mode, snapMode, pFilter);

    try
    {
        // Suppress temporary dimensions by using standard point options.
        // 3D wireframe bounding box preview and geometric snap are handled by VBimPickTracker.
        pView->getPoint(prompt, OdEd::kGptNoUCS | OdEd::kGptNoLimCheck, pTracker.get());

        result = pTracker->result();
        pTracker->cleanup();
        return result.isValid;
    }
    catch (const OdEdCancel&)
    {
        pTracker->cleanup();
        return false;
    }
    catch (const OdError&)
    {
        pTracker->cleanup();
        return false;
    }
    catch (const std::exception&)
    {
        pTracker->cleanup();
        return false;
    }
}

bool VBimPickerService::pick(
    CVinaBIMDoc* pDoc,
    VBimObjectType mode,
    const OdString& prompt,
    OdBmObjectId& resultId,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter)
{
    resultId = OdBmObjectId::kNull;
    VBimReference res;
    if (pick(pDoc, mode, prompt, res, snapMode, pFilter) && res.isValid)
    {
        resultId = res.elementId;
        return true;
    }
    return false;
}

bool VBimPickerService::pickMultiple(
    CVinaBIMDoc* pDoc,
    VBimObjectType mode,
    const OdString& prompt,
    std::vector<VBimReference>& results,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter,
    const std::vector<VBimReference>* pPreselected)
{
    results.clear();
    if (pPreselected && !pPreselected->empty())
    {
        results = *pPreselected;
    }

    if (!pDoc)
        pDoc = theApp.GetActiveDocument();
    if (!pDoc)
        return false;

    CVinaBIMView* pView = pDoc->getActiveViewer();
    if (!pView)
        pView = pDoc->getViewer();
    if (!pView)
        return false;

    OdBmDatabase* pDb = pDoc->database();
    if (!pDb)
        return false;

    OdSmartPtr<VBimPickTracker> pTracker = VBimPickTracker::create(pView, pDb, mode, snapMode, pFilter);

    try
    {
        while (true)
        {
            try
            {
                pView->getPoint(prompt, OdEd::kGptNoUCS | OdEd::kGptNoLimCheck, pTracker.get());

                VBimReference pickedRef = pTracker->result();
                pTracker->clearHover();

                if (pickedRef.isValid && !pickedRef.elementId.isNull())
                {
                    bool isDuplicate = false;
                    for (const auto& existing : results)
                    {
                        if (existing.elementId == pickedRef.elementId &&
                            existing.linkedElementId == pickedRef.linkedElementId &&
                            existing.subentIndex == pickedRef.subentIndex &&
                            existing.subentType == pickedRef.subentType)
                        {
                            isDuplicate = true;
                            break;
                        }
                    }

                    if (!isDuplicate)
                    {
                        results.push_back(pickedRef);
                    }
                }
            }
            catch (const OdEdOtherInput&)
            {
                // User pressed Enter or Space to finish selection
                pTracker->cleanup();
                return !results.empty();
            }
        }
    }
    catch (const OdEdCancel&)
    {
        // User pressed Escape to cancel
        pTracker->cleanup();
        results.clear();
        return false;
    }
    catch (const OdError&)
    {
        pTracker->cleanup();
        return false;
    }
    catch (const std::exception&)
    {
        pTracker->cleanup();
        return false;
    }
}

bool VBimPickerService::pickMultiple(
    CVinaBIMDoc* pDoc,
    VBimObjectType mode,
    const OdString& prompt,
    OdBmObjectIdArray& resultIds,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter)
{
    resultIds.clear();
    std::vector<VBimReference> refs;
    if (!pickMultiple(pDoc, mode, prompt, refs, snapMode, pFilter, nullptr))
        return false;

    for (const auto& r : refs)
    {
        if (!r.elementId.isNull() && !resultIds.contains(r.elementId))
            resultIds.push_back(r.elementId);
    }
    return !resultIds.isEmpty();
}

bool VBimPickerService::pickPoint(
    CVinaBIMDoc* pDoc,
    const OdString& prompt,
    OdGePoint3d& resultPoint,
    VBimObjectSnapTypes snapSettings)
{
    resultPoint = OdGePoint3d::kOrigin;

    if (!pDoc)
        pDoc = theApp.GetActiveDocument();
    if (!pDoc)
        return false;

    CVinaBIMView* pView = pDoc->getActiveViewer();
    if (!pView)
        pView = pDoc->getViewer();
    if (!pView)
        return false;

    OdBmDatabase* pDb = pDoc->database();
    if (!pDb)
        return false;

    if (snapSettings == VBimObjectSnapTypes::None || snapSettings == VBimObjectSnapTypes::Off)
    {
        try
        {
            resultPoint = pView->getPoint(prompt, OdEd::kGptNoUCS | OdEd::kGptNoLimCheck, nullptr);
            return true;
        }
        catch (const OdEdCancel&)
        {
            return false;
        }
        catch (const OdError&)
        {
            return false;
        }
        catch (const std::exception&)
        {
            return false;
        }
    }

    OdSmartPtr<VBimPickTracker> pTracker = VBimPickTracker::create(
        pView, pDb, VBimObjectType::PointOnElement, snapSettings, nullptr);

    try
    {
        const OdGePoint3d clickPt = pView->getPoint(prompt, OdEd::kGptNoUCS | OdEd::kGptNoLimCheck, pTracker.get());

        const VBimReference& res = pTracker->result();
        if (res.isValid && res.snapType != VBimObjectSnapTypes::None)
        {
            resultPoint = res.globalPoint;
        }
        else
        {
            resultPoint = clickPt;
        }

        pTracker->cleanup();
        return true;
    }
    catch (const OdEdCancel&)
    {
        pTracker->cleanup();
        return false;
    }
    catch (const OdError&)
    {
        pTracker->cleanup();
        return false;
    }
    catch (const std::exception&)
    {
        pTracker->cleanup();
        return false;
    }
}

bool VBimPickerService::pickBox(
    CVinaBIMDoc* pDoc,
    VBimPickBoxStyle style,
    const OdString& prompt,
    VBimPickedBox& resultBox)
{
    resultBox = VBimPickedBox();

    if (!pDoc)
        pDoc = theApp.GetActiveDocument();
    if (!pDoc)
        return false;

    CVinaBIMView* pView = pDoc->getActiveViewer();
    if (!pView)
        pView = pDoc->getViewer();
    if (!pView)
        return false;

    try
    {
        const OdString prompt1 = prompt.isEmpty() ? OdString(L"Specify first corner:") : prompt;
        const OdGePoint3d pt1 = pView->getPoint(prompt1, OdEd::kGptNoUCS | OdEd::kGptNoOSnap, nullptr);

        const OdString prompt2 = L"Specify opposite corner:";
        OdEdPointTrackerPtr pRectTracker = RectFrame::create(pt1, nullptr);
        const OdGePoint3d pt2 = pView->getPoint(prompt2, OdEd::kGptNoUCS | OdEd::kGptNoOSnap | OdEd::kGptRectFrame, pRectTracker.get());

        resultBox.min = OdGePoint3d(
            std::min(pt1.x, pt2.x),
            std::min(pt1.y, pt2.y),
            std::min(pt1.z, pt2.z));
        resultBox.max = OdGePoint3d(
            std::max(pt1.x, pt2.x),
            std::max(pt1.y, pt2.y),
            std::max(pt1.z, pt2.z));
        resultBox.isValid = true;
        return true;
    }
    catch (const OdEdCancel&)
    {
        resultBox.isValid = false;
        return false;
    }
    catch (const OdError&)
    {
        resultBox.isValid = false;
        return false;
    }
    catch (const std::exception&)
    {
        resultBox.isValid = false;
        return false;
    }
}

bool VBimPickerService::pickElementsByRectangle(
    CVinaBIMDoc* pDoc,
    const OdString& prompt,
    OdBmObjectIdArray& resultIds,
    IVBimSelectionFilter* pFilter,
    VBimPickBoxStyle style)
{
    resultIds.clear();

    if (!pDoc)
        pDoc = theApp.GetActiveDocument();
    if (!pDoc)
        return false;

    CVinaBIMView* pView = pDoc->getActiveViewer();
    if (!pView)
        pView = pDoc->getViewer();
    if (!pView)
        return false;

    OdBmDatabase* pDb = pDoc->database();
    if (!pDb)
        return false;

    OdBmObjectId drawingId = pView->getActiveDBDrawingId();
    if (drawingId.isNull())
        drawingId = pDb->getActiveDBDrawingId();
    if (drawingId.isNull())
        return false;

    try
    {
        const OdString prompt1 = prompt.isEmpty() ? OdString(L"Specify first corner:") : prompt;
        const OdGePoint3d pt1 = pView->getPoint(prompt1, OdEd::kGptNoUCS | OdEd::kGptNoOSnap, nullptr);

        const OdString prompt2 = L"Specify opposite corner:";
        OdEdPointTrackerPtr pRectTracker = RectFrame::create(pt1, nullptr);
        const OdGePoint3d pt2 = pView->getPoint(prompt2, OdEd::kGptNoUCS | OdEd::kGptNoOSnap | OdEd::kGptRectFrame, pRectTracker.get());

        OdDbVisualSelection::Mode selMode = OdDbVisualSelection::kWindow;
        if (style == VBimPickBoxStyle::Crossing)
        {
            selMode = OdDbVisualSelection::kCrossing;
        }
        else if (style == VBimPickBoxStyle::Enclosing)
        {
            selMode = OdDbVisualSelection::kWindow;
        }
        else // Directional
        {
            bool isLeftToRight = (pt2.x >= pt1.x);
            OdGsView* pGsView = pView->getActiveView();
            if (pGsView)
            {
                OdAbstractViewPEPtr pAV(pGsView);
                if (!pAV.isNull())
                {
                    const OdGeMatrix3d w2e = pAV->worldToEye(pGsView);
                    const OdGePoint3d eyePt1 = w2e * pt1;
                    const OdGePoint3d eyePt2 = w2e * pt2;
                    isLeftToRight = (eyePt2.x >= eyePt1.x);
                }
            }
            selMode = isLeftToRight ? OdDbVisualSelection::kWindow : OdDbVisualSelection::kCrossing;
        }

        OdGePoint3d pts[2] = { pt1, pt2 };
        OdSelectionSetPtr pSSet = OdBm::Utils::select(
            drawingId, 2, pts, selMode, OdDbVisualSelection::kDisableSubents);

        if (!pSSet.isNull())
        {
            for (OdSelectionSetIteratorPtr pIter = pSSet->newIterator(); !pIter->done(); pIter->next())
            {
                const OdBmObjectId entId = pIter->id();
                if (!entId.isNull() && !resultIds.contains(entId))
                {
                    if (!pFilter || pFilter->AllowElement(entId))
                    {
                        resultIds.push_back(entId);
                    }
                }
            }
        }

        return !resultIds.isEmpty();
    }
    catch (const OdEdCancel&)
    {
        return false;
    }
    catch (const OdError&)
    {
        return false;
    }
    catch (const std::exception&)
    {
        return false;
    }
}

bool VBimPickerService::pickElementsByRectangle(
    CVinaBIMDoc* pDoc,
    const OdString& prompt,
    std::vector<VBimReference>& results,
    IVBimSelectionFilter* pFilter,
    VBimPickBoxStyle style)
{
    results.clear();
    OdBmObjectIdArray ids;
    if (!pickElementsByRectangle(pDoc, prompt, ids, pFilter, style))
        return false;

    for (OdUInt32 i = 0; i < ids.size(); ++i)
    {
        VBimReference ref;
        ref.elementId = ids[i];
        ref.objectType = VBimObjectType::Element;
        ref.subentType = OdDb::kNullSubentType;
        ref.isValid = true;
        ref.geomRef = VBimReferenceExtractor::createGeomRef(ids[i]);
        results.push_back(ref);
    }
    return !results.empty();
}

bool VBimPickerService::Pick(
    CVinaBIMDoc* pDoc,
    VBimObjectType mode,
    const OdString& prompt,
    VBimReference& result,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter)
{
    return instance().pick(pDoc, mode, prompt, result, snapMode, pFilter);
}

bool VBimPickerService::Pick(
    CVinaBIMDoc* pDoc,
    VBimObjectType mode,
    const OdString& prompt,
    OdBmObjectId& resultId,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter)
{
    return instance().pick(pDoc, mode, prompt, resultId, snapMode, pFilter);
}

bool VBimPickerService::PickMultiple(
    CVinaBIMDoc* pDoc,
    VBimObjectType mode,
    const OdString& prompt,
    std::vector<VBimReference>& results,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter,
    const std::vector<VBimReference>* pPreselected)
{
    return instance().pickMultiple(pDoc, mode, prompt, results, snapMode, pFilter, pPreselected);
}

bool VBimPickerService::PickMultiple(
    CVinaBIMDoc* pDoc,
    VBimObjectType mode,
    const OdString& prompt,
    OdBmObjectIdArray& resultIds,
    VBimObjectSnapTypes snapMode,
    IVBimSelectionFilter* pFilter)
{
    return instance().pickMultiple(pDoc, mode, prompt, resultIds, snapMode, pFilter);
}

bool VBimPickerService::PickPoint(
    CVinaBIMDoc* pDoc,
    const OdString& prompt,
    OdGePoint3d& resultPoint,
    VBimObjectSnapTypes snapSettings)
{
    return instance().pickPoint(pDoc, prompt, resultPoint, snapSettings);
}

bool VBimPickerService::PickBox(
    CVinaBIMDoc* pDoc,
    VBimPickBoxStyle style,
    const OdString& prompt,
    VBimPickedBox& resultBox)
{
    return instance().pickBox(pDoc, style, prompt, resultBox);
}

bool VBimPickerService::PickElementsByRectangle(
    CVinaBIMDoc* pDoc,
    const OdString& prompt,
    OdBmObjectIdArray& resultIds,
    IVBimSelectionFilter* pFilter,
    VBimPickBoxStyle style)
{
    return instance().pickElementsByRectangle(pDoc, prompt, resultIds, pFilter, style);
}

bool VBimPickerService::PickElementsByRectangle(
    CVinaBIMDoc* pDoc,
    const OdString& prompt,
    std::vector<VBimReference>& results,
    IVBimSelectionFilter* pFilter,
    VBimPickBoxStyle style)
{
    return instance().pickElementsByRectangle(pDoc, prompt, results, pFilter, style);
}
