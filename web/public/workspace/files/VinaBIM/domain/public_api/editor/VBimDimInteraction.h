#pragma once

#include "../VinaBIMApiExport.h"
#include "Base/BmObjectIdArray.h"
#include "Ge/GeMatrix3d.h"
#include "Ge/GePoint3d.h"
#include "OdArray.h"
#include "OdResult.h"
#include "OdString.h"
#include <windef.h>
#include <cstdint>

class OdBmDatabase;
class OdGsView;
class OdGiDrawable;
class OdGiViewportDraw;
class IVBimSelectionFilter;
struct VBimReference;
enum class VBimObjectType : std::uint8_t;

// In-process SDK contract: matching MSVC/CRT and ODA version/flavor required.
// All entry points are UI-thread only. Contexts and HWNDs are borrowed snapshots;
// refresh the context before use. No Host/MFC implementation objects cross here.
using VBimDimToken = unsigned long long;
constexpr unsigned VBIM_DIM_INTERACTION_VERSION = 1;
struct VBimDimContext
{
    VBimDimToken token = 0;
    OdBmDatabase* database = nullptr;
    OdBmObjectId drawingId, viewId;
    OdGeMatrix3d worldToDevice;
    double worldPerPixel = 1.0;
    HWND window = nullptr;
};
struct VBimDimGrip { OdGePoint3d point; OdUInt32 segment = 0; };
struct VBimDimTextBox { OdGePoint3d corners[4], dotPoint; OdUInt32 segmentIndex = 0; };
struct VBimDimTarget { VBimDimToken context = 0; OdBmObjectId dimension; OdUInt32 segment = 0; };

// Provider owned/created/destroyed in the command module. Unregister its exact
// token before destroying it. Registration is for the application lifetime;
// hot unloading is not supported. Callbacks are synchronous and may not destroy
// the provider or unregister from inside a dispatch.
/**
 * @brief Primary interface implemented by dimension providers to support grips, drag, and erase operations.
 */
class IVBimDimInteraction
{
public:
    virtual ~IVBimDimInteraction() = default;

    /**
     * @brief Determines whether the provider supports the given dimension element.
     * @param elementId ID of dimension element.
     * @return true if supported; false otherwise.
     */
    virtual bool Supports(const OdBmObjectId& elementId) = 0;

    /**
     * @brief Queries interaction grip points for the dimension element.
     * @param context Active dimension interaction context.
     * @param elementId ID of dimension element.
     * @param single True if this is the only selected element.
     * @param[out] grips Array receiving computed grip points.
     */
    virtual void Grips(const VBimDimContext& context, const OdBmObjectId& elementId, bool single,
        OdArray<VBimDimGrip>& grips) = 0;

    /**
     * @brief Computes text box boundary corners and anchor point for a dimension segment.
     * @param context Active dimension interaction context.
     * @param elementId ID of dimension element.
     * @param segment Segment index.
     * @param[out] box Computed text box coordinates and anchor.
     * @return true if segment text box was successfully computed.
     */
    virtual bool TextBox(const VBimDimContext& context, const OdBmObjectId& elementId, OdUInt32 segment, VBimDimTextBox& box) = 0;

    /**
     * @brief Draws custom grip geometry into the viewport.
     * @param elementId ID of dimension element.
     * @param gripIndex Index of the grip.
     * @param view View element ID.
     * @param eyePoint Grip point in eye coordinate space.
     * @param size Grip pixel size.
     * @param pWd Viewport draw context.
     */
    virtual void DrawGrip(const OdBmObjectId& elementId, OdUInt32 gripIndex, const OdBmObjectId& view,
        const OdGePoint3d& eyePoint, double size, OdGiViewportDraw* pWd) = 0;

    /**
     * @brief Starts an interactive drag operation on a grip point.
     * @param context Active dimension interaction context.
     * @param elementId ID of dimension element.
     * @param gripIndex Index of the grip being dragged.
     * @param startPoint Initial world coordinate where drag started.
     * @return true if drag started successfully.
     */
    virtual bool BeginDrag(const VBimDimContext& context, const OdBmObjectId& elementId, OdUInt32 gripIndex,
        const OdGePoint3d& startPoint) = 0;

    /**
     * @brief Updates position during an ongoing grip drag.
     * @param context Active dimension interaction context.
     * @param currentPoint Current cursor position in world coordinates.
     * @return true if update succeeded.
     */
    virtual bool UpdateDrag(const VBimDimContext& context, const OdGePoint3d& currentPoint) = 0;

    /**
     * @brief Finishes or cancels the current grip drag operation.
     * @param context Active dimension interaction context.
     * @param commit True to commit changes; false to abort/rollback.
     * @return true if operation completed successfully.
     */
    virtual bool EndDrag(const VBimDimContext& context, bool commit) = 0;

    /**
     * @brief Checks if a drag operation is currently active.
     * @param token Dimension interaction token.
     * @return true if dragging.
     */
    virtual bool IsDragging(VBimDimToken token) const noexcept = 0;

    /**
     * @brief Invalidates any active drag/preview caches for this token.
     * @param token Dimension interaction token.
     */
    virtual void Invalidate(VBimDimToken token) noexcept = 0;

    /**
     * @brief Prepares elements for erasure, collecting dependent dimension objects.
     * @param pDb Target database.
     * @param[in,out] elements Array of elements to erase.
     * @return true if preparation succeeded.
     */
    virtual bool PrepareErase(OdBmDatabase* pDb, OdBmObjectIdArray& elements) = 0;

    /**
     * @brief Validates if elements can safely be erased without breaking references.
     * @param pDb Target database.
     * @param elements Array of elements to validate.
     * @return true if safe to erase.
     */
    virtual bool ValidateErase(OdBmDatabase* pDb, const OdBmObjectIdArray& elements) = 0;
};

// Optional companion: keeps the original provider vtable/registration intact.
// Geometry and hit policy remain in the module; Host routes screen coordinates,
// selection, cursor and capture. All callbacks share the provider lifetime.
constexpr unsigned VBIM_DIM_LINE_INTERACTION_VERSION = 1;

/**
 * @brief Companion interface for interactive dimension line dragging and hit testing.
 */
class IVBimDimLineInteraction
{
public:
    virtual ~IVBimDimLineInteraction() = default;

    /**
     * @brief Queries interface version.
     * @return Interface version number.
     */
    virtual unsigned LineInteractionVersion() const noexcept = 0;

    /**
     * @brief Tests if screen coordinate hits dimension line.
     * @param context Active dimension interaction context.
     * @param elementId ID of dimension element.
     * @param x Client X coordinate.
     * @param y Client Y coordinate.
     * @param[out] hit World coordinate of line hit.
     * @return true if line was hit.
     */
    virtual bool HitLine(const VBimDimContext& context, const OdBmObjectId& elementId, int x, int y, OdGePoint3d& hit) = 0;

    /**
     * @brief Starts an interactive dimension line drag.
     * @param context Active dimension interaction context.
     * @param elementId ID of dimension element.
     * @param hit Starting point of drag.
     * @return true if started successfully.
     */
    virtual bool BeginLineDrag(const VBimDimContext& context, const OdBmObjectId& elementId, const OdGePoint3d& hit) = 0;
};

constexpr unsigned VBIM_DIM_WITNESS_INTERACTION_VERSION = 1;

/**
 * @brief Companion interface for witness line interactive operations.
 */
class IVBimDimWitnessInteraction
{
public:
    virtual ~IVBimDimWitnessInteraction() = default;

    /**
     * @brief Queries witness interaction interface version.
     * @return Interface version number.
     */
    virtual unsigned WitnessInteractionVersion() const noexcept = 0;

    /**
     * @brief Displays witness line contextual menu.
     * @param context Active dimension interaction context.
     * @param clientX Client X coordinate.
     * @param clientY Client Y coordinate.
     * @return true if menu was handled.
     */
    virtual bool ShowWitnessMenu(const VBimDimContext& context, int clientX, int clientY) = 0;

    /**
     * @brief Cycles witness line drag reference targets (TAB key cycling).
     * @param context Active dimension interaction context.
     * @param backwards True to cycle backwards (Shift+TAB).
     * @return true if cycled successfully.
     */
    virtual bool CycleWitnessDrag(const VBimDimContext& context, bool backwards) = 0;
};

constexpr unsigned VBIM_DIM_TEXT_HIT_INTERACTION_VERSION = 1;

/**
 * @brief Companion interface for dimension text hit-testing and editing.
 */
class IVBimDimTextHitInteraction
{
public:
    virtual ~IVBimDimTextHitInteraction() = default;

    /**
     * @brief Queries text hit interaction interface version.
     * @return Interface version number.
     */
    virtual unsigned TextHitInteractionVersion() const noexcept = 0;

    /**
     * @brief Tests if screen coordinate hits text box of a dimension segment.
     * @param context Active dimension interaction context.
     * @param elementId ID of dimension element.
     * @param segment Segment index.
     * @param clientX Client X coordinate.
     * @param clientY Client Y coordinate.
     * @return true if text box was hit.
     */
    virtual bool HitTextBox(const VBimDimContext& context, const OdBmObjectId& elementId, OdUInt32 segment,
        int clientX, int clientY) = 0;
};

/**
 * @brief Registers a dimension interaction provider with the host.
 * @param version Interface version.
 * @param provider Pointer to provider implementation.
 * @return VBimDimToken Non-zero registration token.
 */
VINABIM_API VBimDimToken vbimRegisterDimInteraction(unsigned version, IVBimDimInteraction* provider);

/**
 * @brief Unregisters a dimension interaction provider.
 * @param registration Registration token returned by vbimRegisterDimInteraction.
 * @return OdResult eOk on success.
 */
VINABIM_API OdResult vbimUnregisterDimInteraction(VBimDimToken registration);

/**
 * @brief Retrieves current active dimension interaction context.
 * @param[out] context Dimension context container.
 * @return true if valid context retrieved.
 */
VINABIM_API bool vbimGetDimContext(VBimDimContext& context);

/**
 * @brief Resolves dimension interaction context from token.
 * @param token Registration token.
 * @param[out] context Dimension context container.
 * @return true if resolved successfully.
 */
VINABIM_API bool vbimResolveDimContext(VBimDimToken token, VBimDimContext& context);

/**
 * @brief Checks if dimension interaction is supported for element.
 * @param elementId ID of element.
 * @return true if supported.
 */
VINABIM_API bool vbimDimSupports(const OdBmObjectId& elementId);

/**
 * @brief Queries grips for dimension element.
 * @param elementId ID of dimension element.
 * @param single True if single selected.
 * @param[out] grips Output grip array.
 * @return true if handled.
 */
VINABIM_API bool vbimDimGrips(const OdBmObjectId& elementId, bool single, OdArray<VBimDimGrip>& grips);

/**
 * @brief Queries text bounding box for dimension segment.
 * @param elementId ID of dimension element.
 * @param segment Segment index.
 * @param[out] box Output text box container.
 * @return true if succeeded.
 */
VINABIM_API bool vbimDimTextBox(const OdBmObjectId& elementId, OdUInt32 segment, VBimDimTextBox& box);

/**
 * @brief Tests if screen coordinate hits segment text box.
 * @param elementId ID of dimension element.
 * @param segment Segment index.
 * @param clientX Screen X coordinate.
 * @param clientY Screen Y coordinate.
 * @return true if hit.
 */
VINABIM_API bool vbimDimHitTextBox(const OdBmObjectId& elementId, OdUInt32 segment, int clientX, int clientY);

/**
 * @brief Draws dimension grip in viewport.
 * @param elementId ID of dimension element.
 * @param gripIndex Index of grip.
 * @param view View element ID.
 * @param eyePoint Eye coordinate of grip.
 * @param size Pixel size.
 * @param pWd Viewport draw context.
 */
VINABIM_API void vbimDimDrawGrip(const OdBmObjectId& elementId, OdUInt32 gripIndex, const OdBmObjectId& view,
    const OdGePoint3d& eyePoint, double size, OdGiViewportDraw* pWd);

/**
 * @brief Begins interactive drag operation on dimension grip.
 * @param elementId ID of dimension element.
 * @param gripIndex Index of grip.
 * @param startPoint Initial position.
 * @return true if drag started.
 */
VINABIM_API bool vbimDimBeginDrag(const OdBmObjectId& elementId, OdUInt32 gripIndex, const OdGePoint3d& startPoint);

/**
 * @brief Tests if screen coordinate hits selected dimension line.
 * @param x Client X.
 * @param y Client Y.
 * @return true if line hit.
 */
VINABIM_API bool vbimDimHitSelectedLine(int x, int y);

/**
 * @brief Begins interactive line drag.
 * @param x Client X.
 * @param y Client Y.
 * @return true if started.
 */
VINABIM_API bool vbimDimBeginLineDrag(int x, int y);

/**
 * @brief Displays witness line context menu.
 * @param clientX Client X.
 * @param clientY Client Y.
 * @return true if handled.
 */
VINABIM_API bool vbimDimWitnessMenu(int clientX, int clientY);

/**
 * @brief Cycles witness line drag candidate via TAB.
 * @param backwards True for Shift+TAB.
 * @return true if cycled.
 */
VINABIM_API bool vbimDimWitnessTab(bool backwards);

/**
 * @brief Begins non-modal reference query session.
 * @param context Dimension context token.
 * @param type Object type filter.
 * @param filter Selection filter callback.
 * @return VBimDimToken Query token.
 */
VINABIM_API VBimDimToken vbimBeginDimReferenceQuery(VBimDimToken context, VBimObjectType type, IVBimSelectionFilter* filter);

/**
 * @brief Queries reference candidate under cursor.
 * @param query Query token.
 * @param cursor World cursor point.
 * @param[out] reference Output reference container.
 * @param refresh True to force re-evaluation.
 * @return true if query executed successfully.
 */
VINABIM_API bool vbimQueryDimReference(VBimDimToken query, const OdGePoint3d& cursor, VBimReference& reference, bool refresh = false);

/**
 * @brief Cycles reference candidates under cursor via TAB.
 * @param query Query token.
 * @param backwards True for Shift+TAB.
 * @param[out] reference Output reference container.
 * @return true if cycled.
 */
VINABIM_API bool vbimCycleDimReference(VBimDimToken query, bool backwards, VBimReference& reference);

/**
 * @brief Ends reference query session.
 * @param query Query token.
 */
VINABIM_API void vbimEndDimReferenceQuery(VBimDimToken query) noexcept;

/**
 * @brief Updates position during drag.
 * @param currentPoint World cursor position.
 * @return true if update succeeded.
 */
VINABIM_API bool vbimDimUpdateDrag(const OdGePoint3d& currentPoint);

/**
 * @brief Ends drag operation with commit or cancel.
 * @param commit True to commit changes.
 * @return true if ended cleanly.
 */
VINABIM_API bool vbimDimEndDrag(bool commit);

/**
 * @brief Checks if dimension drag is currently active.
 * @return true if dragging.
 */
VINABIM_API bool vbimDimIsDragging();

/**
 * @brief Cancels ongoing drag operation immediately.
 */
VINABIM_API void vbimDimCancelDrag() noexcept;

/**
 * @brief Attaches a transient preview drawable to the host view.
 * @param context Dimension context token.
 * @param pDrawable Transient drawable pointer.
 * @return VBimDimToken Preview token.
 */
VINABIM_API VBimDimToken vbimAttachDimPreview(VBimDimToken context, OdGiDrawable* pDrawable);

/**
 * @brief Requests viewport repaint for attached preview.
 * @param preview Preview token.
 */
VINABIM_API void vbimUpdateDimPreview(VBimDimToken preview);

/**
 * @brief Detaches transient preview drawable.
 * @param preview Preview token.
 */
VINABIM_API void vbimDetachDimPreview(VBimDimToken preview) noexcept;

/**
 * @brief Requests opening the dimension text editor dialog.
 * @param elementId ID of dimension element.
 * @param segment Segment index.
 * @return true if requested successfully.
 */
VINABIM_API bool vbimRequestDimTextDialog(const OdBmObjectId& elementId, OdUInt32 segment);

/**
 * @brief Takes queued dimension text dialog target.
 * @param[out] target Output target structure.
 * @return true if target available.
 */
VINABIM_API bool vbimTakeDimTextTarget(VBimDimTarget& target);

/**
 * @brief Finishes dimension text dialog session.
 * @param context Context token.
 */
VINABIM_API void vbimFinishDimTextDialog(VBimDimToken context) noexcept;

/**
 * @brief Prepares dimension elements for erasure.
 * @param pDb Database pointer.
 * @param[in,out] elements Elements to erase.
 * @return true if preparation succeeded.
 */
VINABIM_API bool vbimPrepareDimErase(OdBmDatabase* pDb, OdBmObjectIdArray& elements);

/**
 * @brief Validates if dimension elements can safely be erased.
 * @param pDb Database pointer.
 * @param elements Elements to validate.
 * @return true if valid to erase.
 */
VINABIM_API bool vbimValidateDimErase(OdBmDatabase* pDb, const OdBmObjectIdArray& elements);

/**
 * @brief Generic host permission check for element erasure.
 * @param elementId ID of element.
 * @param[out] reason Reason string if erasure is disallowed.
 * @return true if allowed to erase.
 */
VINABIM_API bool vbimCanEraseElement(const OdBmObjectId& elementId, OdString& reason);

// Compare a context snapshot with the active GS view and database; UI thread only.
VINABIM_API bool vbimDimContextMatches(VBimDimToken token, OdGsView* view, OdBmDatabase* db) noexcept;

/**
 * @brief Queries native DIM dependencies outside the supplied deletion set.
 * @details UI thread only. Reads current references without changing the DB or
 * showing UI. Supports segmented/angular/alignment, radial/arc-alignment,
 * arc-length and spot-elevation references. Unknown/unreadable kinds fail closed.
 * No cached ODA objects or pointers are retained. Matching Host export required.
 * @param pDb Database owning every input ID.
 * @param elements Proposed deletion set (owners and any already selected DIMs).
 * @param[out] dimensions Dependent DIM IDs not present in elements; empty on failure.
 * @return true on a complete query; false means deletion must be cancelled.
 */
VINABIM_API bool vbimQueryDimensionDependencies(OdBmDatabase* pDb,
    const OdBmObjectIdArray& elements, OdBmObjectIdArray& dimensions);
