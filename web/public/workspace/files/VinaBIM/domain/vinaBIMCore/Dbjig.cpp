#include "pch.h"

#include "DbJig.h"

#include "DbJigImpl.h"

namespace
{
	thread_local int g_moveDragCursorOverrideDepth = 0;
	thread_local int g_vbimSnapScopeDepth         = 0;
}



VbimEdJig::VbimEdJig(OdBmUserIO* pUserIO)

{

	if (!pUserIO)

		throw OdError(eInvalidInput);

	mpImpJig = std::make_unique<VcEdImpJig>(this, pUserIO);

}



VbimEdJig::~VbimEdJig() = default;



VbimEdJig::DragStatus VbimEdJig::drag()

{

	if (!mpImpJig)

		return DragStatus::kCancel;

	return mpImpJig->drag();

}



VbimEdJig::DragStatus VbimEdJig::sampler()

{

	return VbimEdJig::DragStatus::kCancel;

}



bool VbimEdJig::update()

{

	return false;

}



OdBmObjectId VbimEdJig::append()

{

	if (!mpImpJig)

		return OdBmObjectId::kNull;

	return mpImpJig->append();

}



VbimEdJig::DragStatus VbimEdJig::acquirePoint(OdGePoint3d& pt)

{

	if (!mpImpJig)

		return DragStatus::kCancel;

	return mpImpJig->acquirePoint(pt);

}



VbimEdJig::DragStatus VbimEdJig::acquirePoint(OdGePoint3d& pt, const OdGePoint3d& basePnt)

{

	if (!mpImpJig)

		return DragStatus::kCancel;

	return mpImpJig->acquirePoint(pt, basePnt);

}



VbimEdJig::CursorType VbimEdJig::specialCursorType()

{

	if (!mpImpJig)

		return CursorType::kNoSpecialCursor;

	return mpImpJig->specialCursorType();

}



void VbimEdJig::setSpecialCursorType(CursorType curType)

{

	if (!mpImpJig)

		return;

	mpImpJig->setSpecialCursorType(curType);

}



VbimEdJig::UserInputControls VbimEdJig::userInputControls()

{

	if (!mpImpJig)

		return UserInputControls(0);

	return mpImpJig->userInputControls();

}



void VbimEdJig::setUserInputControls(VbimEdJig::UserInputControls input)

{

	if (!mpImpJig)

		return;

	mpImpJig->setUserInputControls(input);

}

void VbimEdJig::setDispPrompt(const OdString& prompt)
{
	if (!mpImpJig)
		return;
	mpImpJig->setDispPrompt(prompt);
}

OdString VbimEdJig::otherInputString() const
{
	if (!mpImpJig)
		return OdString();
	return mpImpJig->otherInput();
}

void VbimEdJig::setMoveDragCursorEnabled(bool enabled)

{

	m_moveDragCursorEnabled = enabled;

}

bool VbimEdJig::isMoveDragCursorEnabled() const

{

	return m_moveDragCursorEnabled;

}

void vbimSetMoveDragCursorOverrideActive(bool enabled)

{

	if (enabled)

	{

		++g_moveDragCursorOverrideDepth;

		return;

	}

	if (g_moveDragCursorOverrideDepth > 0)

		--g_moveDragCursorOverrideDepth;

}

bool vbimIsMoveDragCursorOverrideActive()

{

	return g_moveDragCursorOverrideDepth > 0;

}

void vbimSetVbimSnapScopeActive(bool enabled)
{
	if (enabled)
		++g_vbimSnapScopeDepth;
	else if (g_vbimSnapScopeDepth > 0)
		--g_vbimSnapScopeDepth;
}

bool vbimIsVbimSnapScopeActiveActive()
{
	return g_vbimSnapScopeDepth > 0;
}

namespace
{
	// Excluded element for the innermost active snap scope. VbimSnapScopeGuard
	// saves and restores the enclosing value, so this never needs its own stack.
	OdBmObjectId g_vbimSnapScopeSubjectId;
}

void vbimSetVbimSnapScopeSubjectId(const OdBmObjectId& subjectId)
{
	g_vbimSnapScopeSubjectId = subjectId;
}

OdBmObjectId vbimVbimSnapScopeSubjectId()
{
	// Outside an active scope there is no drag and therefore nothing to exclude.
	return g_vbimSnapScopeDepth > 0 ? g_vbimSnapScopeSubjectId : OdBmObjectId();
}

namespace
{
	OdGePoint3d g_vbimSnapScopePreviewMin;
	OdGePoint3d g_vbimSnapScopePreviewMax;
	bool g_vbimSnapScopePreviewValid = false;
}

void vbimSetVbimSnapScopePreviewBounds(
	const OdGePoint3d& minimum,
	const OdGePoint3d& maximum,
	bool valid)
{
	g_vbimSnapScopePreviewValid = valid &&
		minimum.x <= maximum.x && minimum.y <= maximum.y && minimum.z <= maximum.z;
	if (!g_vbimSnapScopePreviewValid)
		return;
	g_vbimSnapScopePreviewMin = minimum;
	g_vbimSnapScopePreviewMax = maximum;
}

bool vbimVbimSnapScopePreviewBounds(OdGePoint3d& minimum, OdGePoint3d& maximum)
{
	if (g_vbimSnapScopeDepth <= 0 || !g_vbimSnapScopePreviewValid)
		return false;
	minimum = g_vbimSnapScopePreviewMin;
	maximum = g_vbimSnapScopePreviewMax;
	return true;
}

namespace
{
	bool g_vbimSnapScopeTemporaryDimensionsSuppressed = false;
	bool g_vbimSnapScopePointSnapped = false;
}

void vbimSetVbimSnapScopeTemporaryDimensionsSuppressed(bool suppressed)
{
	g_vbimSnapScopeTemporaryDimensionsSuppressed = suppressed;
}

bool vbimVbimSnapScopeTemporaryDimensionsSuppressed()
{
	return g_vbimSnapScopeDepth > 0 && g_vbimSnapScopeTemporaryDimensionsSuppressed;
}

void vbimSetVbimSnapScopePointSnapped(bool snapped)
{
	g_vbimSnapScopePointSnapped = snapped;
}

bool vbimVbimSnapScopePointSnapped()
{
	return g_vbimSnapScopeDepth > 0 && g_vbimSnapScopePointSnapped;
}

