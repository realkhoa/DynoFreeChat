#pragma once

#include "vbdef.h"

#ifndef _TOOLKIT_IN_DLL_
#define _TOOLKIT_IN_DLL_
#endif

#include <Base/BmObjectId.h>
#include "Database/BmElement.h"
// VbimSnapScopeGuard constructs OdGePoint3d values inline, so the forward
// declaration below is not enough for this header.
#include "Ge/GePoint3d.h"
#include "Core/contracts/preview/PreviewTypes.h"

#include <memory>



class OdBmUserIO;

class OdBmElement;

class OdGePoint3d;

class OdGiVisualStyle;

class VcEdImpJig;

class VcEdImpDragStyle;

class VcEdDragStyle;

class VcEdJigInputHelper;



class VINABIMCORE_DLLEXPORT VbimEdJig

{

public:

	enum UserInputControls {

		kGovernedByOrthoMode = 0x000001,

		kNullResponseAccepted = 0x000002,			// implemented

		kDontEchoCancelForCtrlC = 0x000004,

		kDontUpdateLastPoint = 0x000008,			// implemented

		kNoDwgLimitsChecking = 0x000010,

		kNoZeroResponseAccepted = 0x000020,

		kNoNegativeResponseAccepted = 0x000040,

		kAccept3dCoordinates = 0x000080,

		kAcceptMouseUpAsPoint = 0x000100,

		kAnyBlankTerminatesInput = 0x000200,

		kInitialBlankTerminatesInput = 0x000400,

		kAcceptOtherInputString = 0x000800,			// implemented

		kGovernedByUCSDetect = 0x001000,

		kNoZDirectionOrtho = 0x002000,

		kImpliedFaceForUCSChange = 0x004000,

		kUseBasePointElevation = 0x008000,



		///<summary> Disables direct distance input. When this flag is ON a

		///distance input such as integer or real will not be accepted unless

		///kAcceptOtherInputString is ON, in that case returned DragStatus is

		///kOther. </summary>

		kDisableDirectDistanceInput = 0x010000,

	};



	enum DragStatus {

		kModeless = -17,

		kNoChange = -6,

		kCancel = -4,

		kOther = -3,

		kNull = -1,

		kNormal = 0,

		kKW1,

		kKW2,

		kKW3,

		kKW4,

		kKW5,

		kKW6,

		kKW7,

		kKW8,

		kKW9,

		kKW10,

		kKW11,

		kKW12,

		kKW13,

		kKW14,

		kKW15

	};



	enum CursorType {

		kNoSpecialCursor = -1,           // No Special Cursor Specified

		kCrosshair = 0,                  // Full Screen Cross Hair. 

		kRectCursor,                     // Rectangular cursor. 

		kRubberBand,                     // Rubber band line. 

		kNotRotated,                     // NotRotated Type. 

		kTargetBox,                      // Target Box Type. 

		kRotatedCrosshair,               // Rotated Crosshair w/ rubber band. 

		kCrosshairNoRotate,              // Crosshairs forced non-rotated. 

		kInvisible,                      // Invisible cursor. 

		kEntitySelect,                   // Entity selection target cursor. 

		kParallelogram,                  // Parallelogram cursor. 

		kEntitySelectNoPersp,            // Pickbox, suppressed in persp. 

		kPkfirstOrGrips,                 // Auto-select cursor. 

		kCrosshairDashed                 // 15 dashed style crosshair cursor



	};

	explicit VbimEdJig(OdBmUserIO* pUserIO);

	virtual ~VbimEdJig();



	DragStatus drag();

	virtual DragStatus sampler();

	virtual bool update();

	OdBmObjectId append();

	DragStatus acquirePoint(OdGePoint3d&);

	DragStatus acquirePoint(OdGePoint3d&, const OdGePoint3d& basePnt);



	VbimEdJig::CursorType specialCursorType();

	void                setSpecialCursorType(CursorType);



	VbimEdJig::UserInputControls userInputControls();

	void                       setUserInputControls(VbimEdJig::UserInputControls);

	/**
	 * @brief Sets the prompt shown by the next drag()/acquirePoint() point request.
	 * @param prompt User-visible prompt; load it from the string table.
	 */
	void setDispPrompt(const OdString& prompt);

	/**
	 * @brief Returns the text the user typed when drag() last returned kOther.
	 * @return The raw typed string (e.g. a distance); empty before any kOther.
	 * @note Only produced when kAcceptOtherInputString is set. UI-thread only.
	 */
	OdString otherInputString() const;

	/** When enabled, drag() temporarily sets Win32 cursor to IDC_SIZEALL. */
	void setMoveDragCursorEnabled(bool enabled);
	bool isMoveDragCursorEnabled() const;



	/** @brief Returns the legacy DB prototype, or null for a ghost-only jig.
	 * @note UI-thread only; no mutation. Must not return a bare OdBmElement.
	 */
	virtual OdBmElementPtr entity() const { return OdBmElementPtr(); }

	/** @brief Returns an optional DB-free preview, preferred over entity().
	 * @return Owning drawable reference, or null to use the legacy entity path.
	 * @note UI-thread only; unregister before a containing static drawable is destroyed.
	 */
	virtual OdGiDrawablePtr ghostDrawable() const { return OdGiDrawablePtr(); }

	/** @brief Optional typed status for a jig migrated onto the preview architecture.
	 * @return PreviewStatus::Legacy by default: the caller keeps using the
	 *  legacy bool update()/DragStatus sampler() contract unchanged. A jig
	 *  that returns anything else opts in to the typed contract for the rest
	 *  of its lifetime.
	 * @note UI-thread only. Once this reports PreviewStatus::Unsafe it must
	 *  never later report Ready/Invalid/Cancelled/Failed — Unsafe is sticky.
	 */
	virtual PreviewStatus previewStatus() const { return PreviewStatus::Legacy; }



private:

	std::unique_ptr<VcEdImpJig> mpImpJig;
	bool m_moveDragCursorEnabled = false;

};

VINABIMCORE_DLLEXPORT void vbimSetMoveDragCursorOverrideActive(bool enabled);
VINABIMCORE_DLLEXPORT bool vbimIsMoveDragCursorOverrideActive();

// ---------------------------------------------------------------------------
// Vbim snap scope — active while a jig's drag() call is running.
//
// Install VbimSnapScopeGuard on the stack immediately before drag().
// VinaBIMView checks vbimIsVbimSnapScopeActiveActive() to decide whether to apply
// OsnapService evaluation in kGetPoint mode.
// ---------------------------------------------------------------------------
VINABIMCORE_DLLEXPORT void vbimSetVbimSnapScopeActive(bool enabled);
VINABIMCORE_DLLEXPORT bool vbimIsVbimSnapScopeActiveActive();

// Identifies the element currently being dragged, so reference collection can skip
// it instead of measuring a dragged object against itself.
//
// Null means there is no database-resident subject, which is the case for the
// Component ghost preview. Callers must treat null as "exclude nothing", never as
// an error.
VINABIMCORE_DLLEXPORT void vbimSetVbimSnapScopeSubjectId(const OdBmObjectId& subjectId);

// Returns the element excluded from reference collection in the active snap scope,
// or a null ID when nothing is excluded.
VINABIMCORE_DLLEXPORT OdBmObjectId vbimVbimSnapScopeSubjectId();

// Publishes the world-space bounds of the preview being dragged, so dimension
// labels can avoid covering it. Supply the bounds already transformed by the
// current placement transform.
//
// This is presentation input only: it never affects measured distances. Call with
// valid = false whenever no preview occupies the viewport.
VINABIMCORE_DLLEXPORT void vbimSetVbimSnapScopePreviewBounds(
    const OdGePoint3d& minimum, const OdGePoint3d& maximum, bool valid);

// Returns the active scope's preview bounds, or false when none were published.
//
// Outputs are untouched when this returns false.
VINABIMCORE_DLLEXPORT bool vbimVbimSnapScopePreviewBounds(
    OdGePoint3d& minimum, OdGePoint3d& maximum);

// Hides Temporary Dimensions (to references) for the active snap scope. The Move
// command sets this because it shows its own listening dimension instead.
// Cleared by ~VbimSnapScopeGuard; the getter answers false outside a scope.
VINABIMCORE_DLLEXPORT void vbimSetVbimSnapScopeTemporaryDimensionsSuppressed(bool suppressed);
VINABIMCORE_DLLEXPORT bool vbimVbimSnapScopeTemporaryDimensionsSuppressed();

// Records whether the latest drag tick's point came from an object snap, so a jig
// can let an object snap win over its own soft axis tracking. Written every tick by
// the view's snap step; cleared by ~VbimSnapScopeGuard; false outside a scope.
VINABIMCORE_DLLEXPORT void vbimSetVbimSnapScopePointSnapped(bool snapped);
VINABIMCORE_DLLEXPORT bool vbimVbimSnapScopePointSnapped();

// RAII guard — sets scope active on construction, clears on destruction.
//
// The subject overload additionally excludes one element for the lifetime of the
// scope and restores the enclosing scope's subject on destruction, so a nested
// drag cannot leak its subject into the outer one.
struct VbimSnapScopeGuard
{
    VbimSnapScopeGuard()  { vbimSetVbimSnapScopeActive(true);  }
    explicit VbimSnapScopeGuard(const OdBmObjectId& subjectId)
        : m_previousSubjectId(vbimVbimSnapScopeSubjectId())
        , m_restoreSubjectId(true)
    {
        vbimSetVbimSnapScopeActive(true);
        vbimSetVbimSnapScopeSubjectId(subjectId);
    }
    ~VbimSnapScopeGuard()
    {
        // Preview bounds belong to one drag only; never let them outlive it.
        vbimSetVbimSnapScopePreviewBounds(OdGePoint3d(), OdGePoint3d(), false);
        vbimSetVbimSnapScopeTemporaryDimensionsSuppressed(false);
        vbimSetVbimSnapScopePointSnapped(false);
        if (m_restoreSubjectId)
            vbimSetVbimSnapScopeSubjectId(m_previousSubjectId);
        vbimSetVbimSnapScopeActive(false);
    }
    VbimSnapScopeGuard(const VbimSnapScopeGuard&)            = delete;
    VbimSnapScopeGuard& operator=(const VbimSnapScopeGuard&) = delete;

private:
    OdBmObjectId m_previousSubjectId;
    bool         m_restoreSubjectId = false;
};
// Lowercase alias — kept for use sites that use the lowerCamelCase convention.
using vbimSnapScopeGuard = VbimSnapScopeGuard;

