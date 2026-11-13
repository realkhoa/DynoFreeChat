#include "pch.h"

#include "Infrastructure/Oda/utils/CustomKWIndex.h"

#include "AbstractViewPE.h"

#include "DbJig.h"

#include "DbJigImpl.h"



VcEdImpJig::VcEdImpJig(VbimEdJig* jig, OdBmUserIO* pUserIO)
	: m_pUserIO(pUserIO),
	m_acquireMode(kAcquireNone),
	m_prompt(L""),
	m_kws(L""),
	m_otherInput(L""),
	m_inputCtrls(0),
	m_dragging(false),
	m_bReturnPt(false)
{
	if (!jig)
		throw OdError(eInvalidInput);
	m_entityTracker.setVbEdJig(jig);
}



OdBmUserIO* VcEdImpJig::userIO() const

{

	if (!m_pUserIO)

		throw OdError(eInvalidInput);

	return m_pUserIO;

}



static VbimEdJig::DragStatus ConvertStatus(const int status)

{

	VbimEdJig::DragStatus ret{};

	switch (status)

	{

	case RTNORM:

		ret = VbimEdJig::DragStatus::kNormal;

		break;

	case RTNONE:

		ret = VbimEdJig::DragStatus::kNull;

		break;

	case RTCAN:

		ret = VbimEdJig::DragStatus::kCancel;

		break;

	case RTKWORD:

		ret = VbimEdJig::DragStatus::kKW1;

		break;

	default:

		break;

	}

	return ret;

}



static int ConvertOptions(const int& inputCtrls)

{

	int optMode{};

	if (GETBIT(inputCtrls, VbimEdJig::kGovernedByOrthoMode))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kNullResponseAccepted))

	{

		optMode |= OdEd::kInpThrowEmpty;

	}

	if (GETBIT(inputCtrls, VbimEdJig::kDontEchoCancelForCtrlC))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kDontUpdateLastPoint))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kNoDwgLimitsChecking))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kNoZeroResponseAccepted))

	{

		optMode |= OdEd::kInpNonZero;

	}

	if (GETBIT(inputCtrls, VbimEdJig::kNoNegativeResponseAccepted))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kAccept3dCoordinates))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kAcceptMouseUpAsPoint))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kAnyBlankTerminatesInput))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kInitialBlankTerminatesInput))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kAcceptOtherInputString))

	{

		optMode |= OdEd::kInpThrowOther;

	}

	if (GETBIT(inputCtrls, VbimEdJig::kGovernedByUCSDetect))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kNoZDirectionOrtho))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kImpliedFaceForUCSChange))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kUseBasePointElevation))

	{

	}

	if (GETBIT(inputCtrls, VbimEdJig::kDisableDirectDistanceInput))

	{

	}

	return optMode;

}



VbimEdJig::DragStatus VcEdImpJig::drag()

{

	this->m_dragging = true;

	m_bReturnPt = false;

	m_hasBasePoint = false;

	m_status = VbimEdJig::DragStatus::kNormal;

	VbimEdJig* pJig = m_entityTracker.getVcEdJig();
	HCURSOR previousCursor = nullptr;
	const bool useMoveDragCursor = (pJig != nullptr) && pJig->isMoveDragCursorEnabled();
	if (useMoveDragCursor)
	{
		vbimSetMoveDragCursorOverrideActive(true);
		previousCursor = ::GetCursor();
		::SetCursor(::LoadCursor(nullptr, IDC_SIZEALL));
	}

	if (!pJig)

	{

		m_dragging = false;

		m_status = VbimEdJig::DragStatus::kCancel;
		m_entityTracker.clearDrawables();
		if (useMoveDragCursor)
		{
			vbimSetMoveDragCursorOverrideActive(false);
			::SetCursor(previousCursor ? previousCursor : ::LoadCursor(nullptr, IDC_ARROW));
		}

		return m_status;

	}

	pJig->sampler();



	switch (m_acquireMode)

	{

	case VcEdImpJig::kAcquireNone:

		m_dragging = false;

		pJig->update();

		break;

	case VcEdImpJig::kAcquireBasePoint:

	case VcEdImpJig::kAcquirePoint:

	case VcEdImpJig::kAcquireBaseDist:

	case VcEdImpJig::kAcquireDist:

	case VcEdImpJig::kAcquireBaseAngle:

	case VcEdImpJig::kAcquireAngle:

	{

		m_status = this->getPointSampler(m_point);

	}

	break;

	default:

		break;

	}



	if (m_status == VbimEdJig::DragStatus::kNormal)

		m_bReturnPt = true;



	//m_entityTracker.getVcEdJig()->sampler();

	//m_entityTracker.getVcEdJig()->update();

	m_dragging = false;
	m_entityTracker.clearDrawables();
	if (useMoveDragCursor)
	{
		vbimSetMoveDragCursorOverrideActive(false);
		::SetCursor(previousCursor ? previousCursor : ::LoadCursor(nullptr, IDC_ARROW));
	}

	return m_status;

}



OdBmObjectId VcEdImpJig::append()

{

	m_id = OdBmObjectId::kNull;

	VbimEdJig* pJig = m_entityTracker.getVcEdJig();

	if (!pJig)

		return m_id;

	OdBmElementPtr pEnt = pJig->entity();

	if (pEnt.isNull())

		return m_id;

	OdBmDatabasePtr pDbPtr = vbimCurDatabase();
	OdBmDatabase* pDbNonOwning = pDbPtr.get();
	if (!pDbNonOwning)
		return m_id;

	OdResult res = eOk;

#ifdef _DEBUG
	++GetPreviewDebugCounters().transactions;
#endif

	ODBM_TRANSACTION_START(tr, pDbNonOwning)

		res = pDbNonOwning->addElement(pEnt, m_id);

		if (res == eOk)

			tr.commit();

		else

			tr.rollback();

	ODBM_TRANSACTION_END()

#ifdef _DEBUG
	if (res == eOk)
		++GetPreviewDebugCounters().dbWrites;
#endif

	if (res != eOk)

		throw OdError(res);

	return m_id;

}







const OdString VcEdImpJig::dispPrompt()

{

	return m_prompt;

}





VbimEdJig::DragStatus VcEdImpJig::getPointSampler(OdGePoint3d& pt)

{

	VbimEdJig::DragStatus status{};

	const OdGePoint3d& lastPt = userIO()->getLASTPOINT();

	try

	{

		int optMode = OdEd::kGptDefault;

		if (m_hasBasePoint)

		{

			userIO()->setLASTPOINT(m_basePoint);

			optMode |= OdEd::kGptRubberBand;

		}

		else if (m_acquireMode == kAcquireDist || m_acquireMode == kAcquireAngle)

		{

			optMode |= OdEd::kGptRubberBand;

		}



		optMode |= ConvertOptions(m_inputCtrls);

		pt = userIO()->getPoint(this->dispPrompt(), optMode, nullptr, m_kws, &m_entityTracker);

		status = VbimEdJig::DragStatus::kNormal;

	}

	catch (const OdEdKeyword& kw)

	{



		status = VbimEdJig::DragStatus(kw.keywordIndex() + 1);

	}

	catch (const OdEdEmptyInput&)

	{

		status = VbimEdJig::DragStatus::kNull;

	}

	catch (const OdEdOtherInput& other)

	{

		m_otherInput = other.string();

		status = VbimEdJig::DragStatus::kOther;

	}

	catch (const OdEdCancel&)

	{

		status = VbimEdJig::DragStatus::kCancel;

	}

	catch (const OdEdException&)

	{

		status = VbimEdJig::DragStatus::kCancel;

	}



	if (status == VbimEdJig::DragStatus::kNormal ||

		status == VbimEdJig::DragStatus::kNull)

	{

		if (GETBIT(m_inputCtrls, VbimEdJig::kDontUpdateLastPoint))

		{

			userIO()->setLASTPOINT(lastPt);

		}

		else

		{

			userIO()->setLASTPOINT(pt);

		}

	}

	else if (m_hasBasePoint && !lastPt.isEqualTo(m_basePoint))

	{

		userIO()->setLASTPOINT(lastPt);

	}

	return status;

}



VbimEdJig::DragStatus VcEdImpJig::getPointNormal(OdGePoint3d& pt)

{

	int optMode = OdEd::kGptDefault;

	if (m_hasBasePoint)

	{

		userIO()->setLASTPOINT(m_basePoint);

		optMode |= OdEd::kGptRubberBand;

	}

	optMode |= ConvertOptions(m_inputCtrls);

	//vbimdInitGet(optMode, m_kws);

	const OdGePoint3d* pBaseForHost = m_hasBasePoint ? &m_basePoint : nullptr;

	int rc = vbimGetPoint(pBaseForHost, m_prompt, pt);

	VbimEdJig::DragStatus stat = ConvertStatus(rc);

	

	return stat;

}



VbimEdJig::DragStatus VcEdImpJig::acquirePoint(OdGePoint3d& pt)

{

	auto stat = VbimEdJig::DragStatus::kNormal;

	if (m_dragging)

	{

		if (m_status == VbimEdJig::kOther)

		{

			OdChar* pEnd;

			double distance = odStrToD(m_otherInput.c_str(), &pEnd);

			if (pEnd > m_otherInput.c_str())

			{

				pt = getPtFromDistStr(distance);

				return m_status;

			}

			else

			{

				return VbimEdJig::kModeless;

			}

		}



		m_acquireMode = AcquireMode::kAcquirePoint;

		pt = getPt();



		if (stat != m_status)

			stat = m_status;

	}

	else

	{

		stat = getPointNormal(pt);

	}

	return stat;

}



VbimEdJig::DragStatus VcEdImpJig::acquirePoint(OdGePoint3d& pt, const OdGePoint3d& basePnt)

{

	auto stat = VbimEdJig::DragStatus::kNormal;

	if (!m_hasBasePoint)

	{

		m_basePoint = basePnt;

		m_hasBasePoint = true;

	}

	if (m_dragging)

	{

		if (m_status == VbimEdJig::kOther)

		{

			OdChar* pEnd;

			double distance = odStrToD(m_otherInput.c_str(), &pEnd);

			if (pEnd > m_otherInput.c_str())

			{

				pt = getPtFromDistStr(distance);

				return m_status;

			}

			else

			{

				return VbimEdJig::kModeless;

			}

		}



		m_acquireMode = AcquireMode::kAcquireBasePoint;

		pt = getPt();



		if (stat != m_status)

			stat = m_status;

	}

	else

	{

		stat = getPointNormal(pt);

	}

	return stat;

}



OdGePoint3d VcEdImpJig::getPt()

{

	if (!m_bReturnPt)

		return m_entityTracker.currentPoint();

	return m_point;

}



OdGePoint3d VcEdImpJig::getPtFromDistStr(const double& distance)

{

	OdGePoint3d curPoint = m_entityTracker.currentPoint();

	auto lastPt = userIO()->getLASTPOINT();

	OdGeVector3d curVec(curPoint - lastPt);

	if (curVec.isZeroLength())

		return lastPt;

	auto pt = (lastPt + curVec.normalize() * distance);

	if (!GETBIT(m_inputCtrls, VbimEdJig::kDontUpdateLastPoint))

		userIO()->setLASTPOINT(pt);

	return pt;

}



VbimEdJig::CursorType VcEdImpJig::specialCursorType()

{

	return VbimEdJig::CursorType();

}



void VcEdImpJig::setSpecialCursorType(VbimEdJig::CursorType)

{

}



VbimEdJig::UserInputControls VcEdImpJig::userInputControls() const

{

	return VbimEdJig::UserInputControls(m_inputCtrls);

}



void VcEdImpJig::setUserInputControls(VbimEdJig::UserInputControls iCtrls)

{

	m_inputCtrls = iCtrls;

}



// C2712: __try cannot share a function with objects that require C++ unwinding
// (OdBmElementPtr from entity() has a non-trivial dtor). Keep this helper's
// frame free of any such objects — raw pointers only.
static bool vbimNotifyModelDirectSeh(OdGsModel* pModel, OdGiDrawable* pEntity)
{
	__try
	{
		pModel->onModified(pEntity, (OdGiDrawable*)nullptr);
		return true;
	}
	__except (GetExceptionCode() == EXCEPTION_ACCESS_VIOLATION || GetExceptionCode() == EXCEPTION_IN_PAGE_ERROR ? EXCEPTION_EXECUTE_HANDLER : EXCEPTION_CONTINUE_SEARCH)
	{
		return false;
	}
}

void EntityTracker::setValue(const OdGePoint3d& value)

{

	m_curPt = vbimGetPointUcsToPlane(value);

	if (!m_pVbEdJig)

		return;

	VbimEdJig::DragStatus res = m_pVbEdJig->sampler();

	// Legacy jigs (previewStatus() == Legacy) keep the exact prior sequence:
	// update() always runs, then abort on non-normal sampler status. A
	// migrated jig may already be terminal (e.g. a prior tick reported
	// Unsafe) — skip update() in that case instead of ticking a dead jig.
	const PreviewStatus statusBeforeUpdate = m_pVbEdJig->previewStatus();
	const bool migrated = statusBeforeUpdate != PreviewStatus::Legacy;
	const bool skipUpdate = migrated && IsPreviewStatusTerminal(statusBeforeUpdate);

	if (!skipUpdate)
		m_pVbEdJig->update();

	if (migrated)
	{
		if (res != VbimEdJig::kNormal || IsPreviewStatusTerminal(m_pVbEdJig->previewStatus()))
			vbimNotifyJigSamplerAbort();
	}
	else if (res != VbimEdJig::kNormal)
	{
		vbimNotifyJigSamplerAbort();
	}



	if (!m_pModelDirect.isNull() && !m_registeredDrawable.isNull())
	{
		if (!vbimNotifyModelDirectSeh(m_pModelDirect.get(), m_registeredDrawable.get()))
		{
			m_pModelDirect = OdGsModelPtr();
			NotifyPreviewFault(PreviewFailureKind::NativeFault);
			vbimNotifyJigSamplerAbort();
		}
	}
}


