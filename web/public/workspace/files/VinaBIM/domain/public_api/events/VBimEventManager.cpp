#include "pch.h"
#include "domain/public_api/events/VBimEventManager.h"
#include "domain/public_api/events/internal/VBimEventDispatch.h"  // declaration of vbimEventFire

#include <atomic>
#include <functional>
#include <unordered_map>
#include <vector>

// ABI note: std::function is used here for Phase 1 in-process plugins only.
// All code sharing this event manager is compiled with the same MSVC toolset.
// For binary-stable third-party SDK (separate DLL), replace with a pure virtual
// IVBimEventListener interface. See VBimEventManager_DESIGN.md §11.

namespace {

struct HandlerEntry
{
    VBimEventType                              type;
    std::function<void(const VBimEventArgs&)>  handler;
};

std::unordered_map<VBimEventHandlerId, HandlerEntry> s_handlers;
std::atomic<VBimEventHandlerId> s_nextId{1};

} // namespace

// ── VBimEventArgs accessors ─────────────────────────────────────────────────

OdBmDatabase* VBimDocumentEventArgs::GetDatabase() const
{
    return m_pDatabase;
}

OdString VBimDocumentEventArgs::GetDocumentPath() const
{
    return m_documentPath;
}

OdBmObjectIdArray VBimSelectionChangedEventArgs::GetSelectedObjectIds() const
{
    return m_selectedIds;
}

// ── VBimViewActivatingEventArgs ─────────────────────────────────────────────

const VBimView& VBimViewActivatingEventArgs::PreviousActiveView() const { return m_previous; }
const VBimView& VBimViewActivatingEventArgs::NewActiveView() const      { return m_next; }
bool            VBimViewActivatingEventArgs::Cancel() const             { return m_cancel; }
void            VBimViewActivatingEventArgs::SetCancel(bool cancel)     { m_cancel = cancel; }

// ── VBimViewActivatedEventArgs ───────────────────────────────────────────────

OdBmDatabase* VBimViewActivatedEventArgs::GetDatabase() const
{
    return m_pDatabase;
}

const VBimView& VBimViewActivatedEventArgs::PreviousActiveView() const { return m_previous; }
const VBimView& VBimViewActivatedEventArgs::CurrentActiveView() const  { return m_current; }

// ── VBimDocumentClosingEventArgs ─────────────────────────────────────────────

OdBmDatabase* VBimDocumentClosingEventArgs::GetDatabase() const { return m_pDatabase; }
OdString      VBimDocumentClosingEventArgs::GetFilePath() const { return m_filePath; }
bool          VBimDocumentClosingEventArgs::Cancel() const      { return m_cancel; }
void          VBimDocumentClosingEventArgs::SetCancel(bool cancel) const { m_cancel = cancel; }
bool          VBimDocumentClosingEventArgs::IsCancellable() const  { return m_cancellable; }

// ── VBimDocumentChangedEventArgs ─────────────────────────────────────────────

OdBmDatabase*            VBimDocumentChangedEventArgs::GetDatabase() const { return m_pDatabase; }
const OdBmObjectIdArray& VBimDocumentChangedEventArgs::AddedIds() const    { return m_added; }
const OdBmObjectIdArray& VBimDocumentChangedEventArgs::ModifiedIds() const { return m_modified; }
const OdBmObjectIdArray& VBimDocumentChangedEventArgs::ErasedIds() const   { return m_erased; }

// ── VBimDialogBoxShowingEventArgs ────────────────────────────────────────────

OdString VBimDialogBoxShowingEventArgs::GetCaption() const { return m_caption; }
OdString VBimDialogBoxShowingEventArgs::GetText() const { return m_message; }
bool     VBimDialogBoxShowingEventArgs::IsOverridden() const { return m_overridden; }

void VBimDialogBoxShowingEventArgs::OverrideResult(int result) const
{
    if (m_overridden)
        return;
    m_result     = result;
    m_overridden = true;
}

// ── VBimDocumentClosedEventArgs ──────────────────────────────────────────────

OdString VBimDocumentClosedEventArgs::GetFilePath() const    { return m_filePath; }
OdString VBimDocumentClosedEventArgs::GetDocumentId() const  { return m_documentId; }

// ── VBimEventManager ────────────────────────────────────────────────────────

VBimEventHandlerId VBimEventManager::Subscribe(
    VBimEventType                             type,
    std::function<void(const VBimEventArgs&)> handler)
{
    if (!handler)
        return 0;
    const VBimEventHandlerId id = s_nextId.fetch_add(1, std::memory_order_relaxed);
    HandlerEntry entry;
    entry.type    = type;
    entry.handler = std::move(handler);
    s_handlers[id] = std::move(entry);
    return id;
}

void VBimEventManager::Unsubscribe(VBimEventHandlerId id)
{
    if (id == 0)
        return;
    s_handlers.erase(id);
}

void VBimEventManager::SetInternalOwner(void* pOwner)
{
    m_pOwner = pOwner;
}

// ── Internal free function — called by VBimEventBridge ─────────────────────

void vbimEventFire(VBimEventType type, const VBimEventArgs& args)
{
    if (s_handlers.empty())
        return;

    // Snapshot matching handlers before iterating so that a handler calling
    // Unsubscribe() during dispatch does not invalidate our iterators.
    typedef std::pair<VBimEventHandlerId, std::function<void(const VBimEventArgs&)>> SnapEntry;
    std::vector<SnapEntry> snapshot;
    snapshot.reserve(s_handlers.size());
    for (auto& kv : s_handlers)
    {
        if (kv.second.type == type)
            snapshot.push_back(SnapEntry(kv.first, kv.second.handler));
    }

    for (auto& snap : snapshot)
    {
        // Re-check: handler may have been Unsubscribed by a previous handler
        // in this same dispatch pass.
        if (!s_handlers.count(snap.first))
            continue;
        // A plugin exception must not unwind into MFC / ODA callers. The
        // failing handler is dropped so it cannot fail on every later event.
        try
        {
            snap.second(args);
        }
        catch (...)
        {
            CString msg;
            msg.Format(L"[SDK] Event handler %llu threw for event type %d; handler removed.",
                snap.first, static_cast<int>(type));
            LOG(msg);
            s_handlers.erase(snap.first);
        }
    }
}
