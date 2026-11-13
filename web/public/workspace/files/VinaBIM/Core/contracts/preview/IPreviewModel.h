///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Core contract
///////////////////////////////////////////////////////////////////////////////
//
// IPreviewModel — engine-neutral preview session capability
// (docs/research/preview-architecture/05-target-preview-architecture.md, P1.1).
//
// Implemented by OdaPreviewSession (Infrastructure/Oda/PreviewSession/). Called
// by ViewPreviewController (Host) and EvaluatePreviewUseCase/CommitPreviewUseCase
// (Application). No ODA/MFC type crosses this boundary: geometry is an opaque
// PreviewGeometryToken the issuing session resolves internally, never a raw
// pointer or drawable reference.
//
///////////////////////////////////////////////////////////////////////////////
#pragma once

#include "Core/contracts/preview/PreviewTypes.h"
#include "shared/core/VbResult.h"

#include <cstdint>
#include <vector>

// PreviewPoint3d — engine-neutral 3-D point (mirrors SnapPoint in ISnapService.h).
struct PreviewPoint3d
{
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

// PreviewTransform — row-major affine transform (3 rows of [rotation|scale, translation]).
// Identity by default. Engine-neutral: no OdGeMatrix3d in Core.
struct PreviewTransform
{
    double m[3][4] = {
        {1.0, 0.0, 0.0, 0.0},
        {0.0, 1.0, 0.0, 0.0},
        {0.0, 0.0, 1.0, 0.0},
    };
};

// PreviewOperation — the semantic operation a session is preparing/committing.
// One enum dispatch is enough for the four supported operations; no abstract
// strategy hierarchy (doc05: "no generic factory/abstract strategy hierarchy").
enum class PreviewOperation
{
    Move,
    Rotate,
    Place,
    Copy,
};

// Opaque geometry token. Callers never dereference this; only the
// OdaPreviewSession that issued it resolves it to actual cached geometry.
using PreviewGeometryToken = std::uint64_t;

// PrepareRequest — what to prepare, before any candidate math runs.
//
// Exactly one of sourceHandle (Move/Rotate/Copy: an existing DB-resident
// subject) or symbolHandle (Place: a family type) is non-zero, per operation.
struct PrepareRequest
{
    PreviewOperation operation = PreviewOperation::Move;
    std::uint64_t documentEpoch = 0;
    std::uint64_t sourceHandle = 0;
    std::uint64_t symbolHandle = 0;
};

// PreparedPreview — immutable session snapshot published by prepare().
//
// No geometry pointers. geometryToken is resolved only by the session that
// issued it; the token has no meaning to any other session or Host caller.
struct PreparedPreview
{
    PreviewSessionId sessionId = 0;
    std::uint64_t documentEpoch = 0;
    std::uint64_t sourceRevision = 0;
    PreviewGeometryToken geometryToken = 0;
    PreviewPoint3d boundsMin;
    PreviewPoint3d boundsMax;
    bool boundsValid = false;
    // True when extraction degraded to a bounds-only envelope (cold/unsupported
    // geometry) rather than full contours; Host uses this to show the
    // "simplified preview" status text without treating it as a failure.
    bool isBoundsOnlyQuality = false;
    PreviewOperation operation = PreviewOperation::Move;
    PreviewTransform initialTransform;

    // Set only on a failed prepare() (mirrors CommitReceipt::failureKind):
    // the caller must read this from the value even though the enclosing
    // vb::Result is an Err, e.g. to distinguish Unsafe (native fault during
    // read-only extraction) from an ordinary recoverable failure. Stays
    // None on a successful prepare().
    PreviewFailureKind failureKind = PreviewFailureKind::None;
};

// PreviewInitialState — the fixed inputs to one interaction (set once at the
// start of a drag/placement, not per tick).
struct PreviewInitialState
{
    PreviewPoint3d basePoint;             // Move/Rotate: drag origin. Place: insertion anchor.
    PreviewPoint3d pivot;                 // Rotate only.
    PreviewPoint3d planeNormal{0.0, 0.0, 1.0}; // Locked interaction plane normal.
};

// PreviewInputSample — one cursor/keyboard tick.
struct PreviewInputSample
{
    PreviewPoint3d cursorWorld;
    double typedRotationRadians = 0.0; // Explicit Rotate angle, or Component Space-key quarter turn.
    bool hasTypedRotation = false;
};

// PreviewSnapResultDto — resolved point for this tick, already snap-adjusted
// by the (P2.1) snap adapter. Named with a Dto suffix to avoid colliding with
// ISnapService.h's SnapResult, which is a different, unrelated contract.
struct PreviewSnapResultDto
{
    PreviewPoint3d resolvedPoint;
    bool snapped = false;
};

// PreviewConstraintState — reserved for ortho/other input constraints. Not
// enforced by the P1.1 math yet; present so P2.1 callers compile against a
// stable signature once constraints are wired in.
struct PreviewConstraintState
{
    bool orthoLocked = false;
};

// Candidate — the result of one pure evaluation tick.
struct Candidate
{
    PreviewCandidateSequence sequence = 0;
    PreviewTransform transform;
    PreviewPoint3d resolvedPoint;
    PreviewStatus status = PreviewStatus::Invalid;
    PreviewFailureKind failureKind = PreviewFailureKind::None;

    // Rotate only: the exact signed angle EvaluatePreviewUseCase computed
    // (ray-derived or explicit typed angle), in radians. 0 for every other
    // operation. Carried separately from `transform` so a Rotate commit can
    // apply OdBmFamilyInstance::setRotation(angle, axis, origin) directly
    // instead of re-deriving angle/axis from the composed matrix.
    double rotationAngleRadians = 0.0;
};

// Validation — result of IPreviewModel::validate().
struct Validation
{
    bool valid = false;
    PreviewFailureKind failureKind = PreviewFailureKind::None;
};

// CommitRequest — the exact frozen candidate to apply, plus the identity and
// expected document revision it must still match at commit time.
struct CommitRequest
{
    PreviewSessionId sessionId = 0;
    PreviewCandidateSequence candidateSequence = 0;
    PreviewOperation operation = PreviewOperation::Move;
    std::uint64_t sourceHandle = 0;
    std::uint64_t expectedDocumentRevision = 0;
    PreviewTransform finalTransform;

    // Rotate only: pivot/axis/angle exactly as evaluated (see
    // Candidate::rotationAngleRadians). Unused (default) for every other
    // operation, where finalTransform alone is authoritative.
    PreviewPoint3d rotatePivot;
    PreviewPoint3d rotateAxis;
    double rotateAngleRadians = 0.0;
};

// CommitReceipt — published only after a successful commit; committedHandle
// stays 0 on failure. failureKind/activationChanged must be read from the
// value even when the enclosing vb::Result::ok is false — the adapter fills
// this metadata on both success and failure, per doc05.
struct CommitReceipt
{
    std::uint64_t committedHandle = 0;
    std::uint64_t documentRevision = 0;
    bool changed = false;
    bool activationChanged = false;
    PreviewFailureKind failureKind = PreviewFailureKind::None;
};

// =============================================================================
// Batch variants (P5.3: body drag / grip drag) — multiple selected sources
// sharing one absolute delta, applied atomically. Kept as separate types
// rather than adding vector fields to the single-source structs above: every
// existing single-source caller (Move/Rotate/Copy/Place jigs, all already
// shipped in P5.1/P5.2/P6.1/P6.2) stays completely untouched by this addition.
// =============================================================================

// PrepareBatchRequest — Move only, for P5.3's scope (body/grip drag are both
// pure translation gestures today; Rotate/Copy/Place have no batch caller).
struct PrepareBatchRequest
{
    PreviewOperation operation = PreviewOperation::Move;
    std::uint64_t documentEpoch = 0;
    std::vector<std::uint64_t> sourceHandles;
};

// PreparedBatchPreview — published only when every requested source produced
// a geometry token (doc06/P5.3: "All-or-nothing eligibility for batch; no
// silent subset move"). geometryTokens is the same length and order as the
// request's sourceHandles on success.
struct PreparedBatchPreview
{
    PreviewSessionId sessionId = 0;
    std::uint64_t documentEpoch = 0;
    std::vector<PreviewGeometryToken> geometryTokens;
    // Local-to-world placement for each source's cached geometry, same length
    // and order as geometryTokens. Each source's cached contours are in its own
    // family/definition-local frame (see PreparedPreview's own single-source
    // equivalent), and every source in a batch can sit at a different world
    // position/rotation, so this is per-item rather than a single shared value.
    // Caller composes: ghostTransform_i = sharedDelta * initialTransforms[i].
    std::vector<PreviewTransform> initialTransforms;
    PreviewOperation operation = PreviewOperation::Move;

    // Set only on a failed prepareBatch() (mirrors PreparedPreview::failureKind).
    PreviewFailureKind failureKind = PreviewFailureKind::None;
};

// CommitBatchRequest — one shared absolute delta (finalTransform) applied to
// every listed source in a single atomic transaction.
struct CommitBatchRequest
{
    PreviewSessionId sessionId = 0;
    PreviewCandidateSequence candidateSequence = 0;
    PreviewOperation operation = PreviewOperation::Move;
    std::vector<std::uint64_t> sourceHandles;
    PreviewTransform finalTransform;
};

// IPreviewModel — Infrastructure-implemented preview session capability.
//
// Thread safety: UI-thread only, matching every other ODA-backed capability
// in this codebase.
class IPreviewModel
{
public:
    /** @brief Destroys the engine-neutral preview model through its interface. */
    virtual ~IPreviewModel() = default;

    /**
     * @brief Reads geometry/bounds read-only and publishes an immutable snapshot.
     * @return A PreparedPreview on success.
     * @note Never opens a database transaction and never mutates the document.
     */
    virtual vb::Result<PreparedPreview> prepare(const PrepareRequest& request) = 0;

    /**
     * @brief Read-only semantic pre-check of a candidate.
     * @note Never mutates the database; safe to call every tick.
     */
    virtual vb::Result<Validation> validate(const Candidate& candidate) = 0;

    /**
     * @brief Applies the frozen candidate as one short, final mutation.
     * @return A receipt with committedHandle/changed set only after the
     *  underlying transaction reaches its healthy terminal state; an
     *  implementation may also return an explicit "not implemented" error
     *  for an operation it does not yet support (see OdaPreviewSession).
     * @note Never silently succeeds; callers must not assume completion from
     *  the absence of an exception.
     */
    virtual vb::Result<CommitReceipt> commit(const CommitRequest& request) = 0;

    /**
     * @brief Releases session-owned value/cache state.
     * @note Idempotent. Never calls GS or DB rollback itself — that is the
     *  Host/Infrastructure caller's responsibility before release().
     */
    virtual vb::Result<vb::Void> release(PreviewSessionId sessionId) = 0;

    /**
     * @brief Batch variant of prepare() for multiple selected sources (P5.3).
     * @return A PreparedBatchPreview only when every source resolved and
     *  extracted successfully; otherwise an explicit error and no partial
     *  session is retained (all-or-nothing).
     * @note Never opens a database transaction and never mutates the document.
     */
    virtual vb::Result<PreparedBatchPreview> prepareBatch(const PrepareBatchRequest& request) = 0;

    /**
     * @brief Batch variant of commit() — applies one shared delta to every
     *  listed source in a single atomic transaction (P5.3).
     * @return A receipt with changed=true only after every source was
     *  transformed and the transaction reaches its healthy terminal state;
     *  any single source failing rolls back the whole batch, never a subset.
     */
    virtual vb::Result<CommitReceipt> commitBatch(const CommitBatchRequest& request) = 0;
};
