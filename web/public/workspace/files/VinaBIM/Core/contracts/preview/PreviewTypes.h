///////////////////////////////////////////////////////////////////////////////
// VinaBIM — Core contract
///////////////////////////////////////////////////////////////////////////////
//
// PreviewTypes — engine-neutral, opt-in typed outcome for a preview/jig
// interaction step (docs/research/preview-architecture/13-final-implementation-plan.md, P0.1).
//
// This is a transitional seam, not a second command framework: an unmigrated
// jig never calls anything here and keeps its existing bool update()/DragStatus
// contract unchanged. A jig only participates once it overrides
// VbimEdJig::previewStatus() to return something other than PreviewStatus::Legacy.
//
// All types are plain C++ (no ODA, no MFC) so Core/Application/Infrastructure/
// Host can share one stable, header-only contract.
//
///////////////////////////////////////////////////////////////////////////////
#pragma once
#include <atomic>
#include <cstdint>

// PreviewStatus — typed outcome of one preview/jig interaction step.
//
// Unsafe is sticky: once a jig reports Unsafe, it must never later report
// Ready/Invalid/Cancelled/Failed. Callers must not infer any PreviewStatus
// from a legacy bool update() return value.
enum class PreviewStatus
{
    Legacy,    // Jig has not opted in; caller must use the legacy bool/DragStatus contract.
    Ready,     // Candidate valid; committable.
    Invalid,   // Candidate not committable yet; interaction continues.
    Cancelled, // User-initiated cancel (ESC or equivalent); no DB mutation occurred.
    Failed,    // Recoverable failure; interaction/command must end.
    Unsafe,    // Native/corrupted state; sticky, never downgraded to any other value.
};

// Returns true for a status that must stop further sampler/update ticks
// (Cancelled, Failed, Unsafe). Ready and Invalid both continue interaction.
inline bool IsPreviewStatusTerminal(PreviewStatus status)
{
    return status == PreviewStatus::Cancelled ||
           status == PreviewStatus::Failed ||
           status == PreviewStatus::Unsafe;
}

// PreviewFailureKind — neutral failure category for a Failed/Unsafe
// PreviewStatus. Never inferred from a caught exception's message string.
enum class PreviewFailureKind
{
    None,
    RecoverableInput,    // Bad/incomplete user input or constraint rejection.
    RecoverableSdkError, // Checked OdResult/OdError failure, state known healthy.
    NativeFault,         // SEH access violation / structured native fault.
};

// Monotonic, process-wide identifiers. 0 means "unassigned"; callers must not
// treat 0 as a valid session or candidate.
using PreviewSessionId = std::uint64_t;
using PreviewCandidateSequence = std::uint64_t;

/** @brief Returns the next process-wide unique preview session ID, starting at 1. */
inline PreviewSessionId NextPreviewSessionId()
{
    static std::atomic<PreviewSessionId> counter{0};
    return ++counter;
}

/** @brief Returns the next monotonic candidate sequence, starting at 1.
 * @note Shared across all sessions in-process; callers only need
 *  per-session monotonicity, which a single global counter satisfies.
 */
inline PreviewCandidateSequence NextPreviewCandidateSequence()
{
    static std::atomic<PreviewCandidateSequence> counter{0};
    return ++counter;
}

// PreviewFaultSink — Host-installable callback notified before a migrated
// jig/tracker aborts due to a native fault. A null sink (the default) means
// no relay, matching current behavior exactly.
//
// Must be UI-thread-only, must not call back into any preview/jig API, and
// must not allocate or log beyond what the caller already has in hand.
using PreviewFaultSink = void (*)(PreviewFailureKind kind, void* context);

namespace detail_PreviewFaultSinkStorage
{
    inline PreviewFaultSink& sink()
    {
        static PreviewFaultSink value = nullptr;
        return value;
    }
    inline void*& context()
    {
        static void* value = nullptr;
        return value;
    }
}

/** @brief Installs (or clears with nullptr) the process-wide preview fault sink. */
inline void InstallPreviewFaultSink(PreviewFaultSink sink, void* context)
{
    detail_PreviewFaultSinkStorage::sink() = sink;
    detail_PreviewFaultSinkStorage::context() = context;
}

/** @brief Invokes the installed preview fault sink, if any; no-op otherwise. */
inline void NotifyPreviewFault(PreviewFailureKind kind)
{
    if (PreviewFaultSink sink = detail_PreviewFaultSinkStorage::sink())
        sink(kind, detail_PreviewFaultSinkStorage::context());
}

#ifdef _DEBUG
// Debug-only counters at semantic write/tx/extract/clone/regen seams, used by
// later regression tests to assert zero-write/zero-transaction invariants
// during interactive preview. Compiled out entirely in Release; this is
// instrumentation for tests, not bug-trace logging (see
// .claude/rules/73-debug-only-bug-logging.md).
struct PreviewDebugCounters
{
    std::uint64_t dbWrites = 0;
    std::uint64_t transactions = 0;
    std::uint64_t extractions = 0;
    std::uint64_t clones = 0;
    std::uint64_t regens = 0;
};

/** @brief Returns the process-wide Debug-only preview counters. */
inline PreviewDebugCounters& GetPreviewDebugCounters()
{
    static PreviewDebugCounters counters;
    return counters;
}

/** @brief Resets all Debug-only preview counters to zero. */
inline void ResetPreviewDebugCounters()
{
    GetPreviewDebugCounters() = PreviewDebugCounters();
}
#endif
