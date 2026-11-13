/**
 * @file VBimCommand.cpp
 * @brief Implementation of unified VBimCommand base class lifecycle and ODA glue.
 */

#include "pch.h"
#include "domain/public_api/command/VBimCommand.h"
#include "domain/public_api/optionbar/VBimOptionBarScope.h"
#include "domain/public_api/ribbon/VBimContextualTabScope.h"
#include "domain/public_api/app/VBimUIApplication.h"
#include "domain/public_api/app/VBimUIDocument.h"
#include "domain/public_api/command/internal/VBimDeferredUndo.h"
#include "Infrastructure/Oda/undo/OdaSnapshotDeltaAction.h"
#include "ExBimCommandContext.h"
#include "Database/BmDatabase.h"
#include "Database/BmTransaction.h"
#include "Database/BmCommandContext.h"
#include "Database/BmUserIO.h"
#include "Ed/EdUserIO.h"  // OdEdCancel
#include "Database/Entities/BmDBView.h"
#include "Database/Entities/BmDBDrawing.h"
#include "Essential/Entities/BmLevel.h"

namespace
{
    /**
     * @struct OdExplicitTransaction
     * @brief RAII transaction guard wrapping OdBmTransaction for Automatic mode.
     */
    struct OdExplicitTransaction
    {
        OdBmTransaction m_tr;
        bool m_committed = false;

        explicit OdExplicitTransaction(OdBmDatabase* pDb, const OdString& = OdString::kEmpty)
            : m_tr(pDb, true)
        {
            m_tr.start();
        }

        ~OdExplicitTransaction()
        {
            if (!m_committed)
            {
                try
                {
                    m_tr.rollback();
                }
                catch (...)
                {
                }
            }
        }

        void commit()
        {
            m_tr.commit();
            m_committed = true;
        }

        void rollback()
        {
            m_tr.rollback();
            m_committed = true;
        }
    };

    struct DeferredUndo
    {
        VBimUIDocument* pUiDoc = nullptr;
        std::shared_ptr<OdaSnapshotDeltaAction> pSnapshot;
    };

    // One level per running Automatic command transaction, innermost last.
    struct DeferredUndoFrame
    {
        OdBmDatabase* pDb = nullptr;           // Database of the command transaction.
        std::vector<DeferredUndo> entries;
    };
    std::vector<DeferredUndoFrame> s_deferredUndo;

    void RecordUndoNow(const DeferredUndo& entry)
    {
        try
        {
            entry.pSnapshot->CommitPostState();
            entry.pUiDoc->RecordUndoAction(entry.pSnapshot);
        }
        catch (const OdError& e)
        {
            (void)e;
            ODA_TRACE1("VBimCommand: recording a deferred Undo step failed: %ls\n", e.description().c_str());
        }
        catch (const std::exception& e)
        {
            (void)e;
            ODA_TRACE1("VBimCommand: recording a deferred Undo step failed: %hs\n", e.what());
        }
    }

    /**
     * @brief Collects the Undo snapshots taken during one Automatic command transaction.
     *
     * Flush() after commit records them (or hands them to an enclosing Automatic
     * transaction, which may still roll back); without Flush() they are dropped.
     */
    class DeferredUndoLevel
    {
    public:
        explicit DeferredUndoLevel(OdBmDatabase* pDb) { s_deferredUndo.push_back(DeferredUndoFrame{ pDb, {} }); }
        ~DeferredUndoLevel() { s_deferredUndo.pop_back(); }
        DeferredUndoLevel(const DeferredUndoLevel&) = delete;
        DeferredUndoLevel& operator=(const DeferredUndoLevel&) = delete;

        void Flush()
        {
            DeferredUndoFrame& frame = s_deferredUndo.back();
            std::vector<DeferredUndo> entries;
            entries.swap(frame.entries);
            // An enclosing Automatic transaction on the same database may still roll back.
            DeferredUndoFrame* pOuter = s_deferredUndo.size() > 1 ? &s_deferredUndo[s_deferredUndo.size() - 2] : nullptr;
            if (pOuter != nullptr && pOuter->pDb == frame.pDb)
            {
                pOuter->entries.insert(pOuter->entries.end(), entries.begin(), entries.end());
                return;
            }
            for (const DeferredUndo& entry : entries)
                RecordUndoNow(entry);
        }
    };

    /**
     * @class VBimExecutionContextImpl
     * @brief Concrete implementation of VBimExecutionContext facade.
     */
    class VBimExecutionContextImpl : public VBimExecutionContext
    {
    private:
        OdBmDatabasePtr m_pDb;
        VBimUIDocument* m_pUiDoc;
        OdBmObjectId    m_activeViewId;
        OdBmObjectId    m_activeLevelId;
        OdBmUserIO*     m_pIO;

    public:
        VBimExecutionContextImpl(
            OdBmDatabase* pDb,
            VBimUIDocument* pUiDoc,
            const OdBmObjectId& activeViewId,
            const OdBmObjectId& activeLevelId,
            OdBmUserIO* pIO)
            : m_pDb(pDb)
            , m_pUiDoc(pUiDoc)
            , m_activeViewId(activeViewId)
            , m_activeLevelId(activeLevelId)
            , m_pIO(pIO)
        {
        }

        OdBmDatabase* GetDatabase() const noexcept override { return const_cast<OdBmDatabase*>(m_pDb.get()); }
        VBimUIDocument* GetUIDocument() const noexcept override { return m_pUiDoc; }
        OdBmObjectId GetActiveViewId() const noexcept override { return m_activeViewId; }
        OdBmObjectId GetActiveLevelId() const noexcept override { return m_activeLevelId; }
        OdBmUserIO* GetUserIO() const noexcept override { return m_pIO; }

        void SetStatusText(const OdString& text) override
        {
            if (m_pIO)
                m_pIO->putString(text);
        }
    };

    /** Loads a STRINGTABLE entry of the Host module. */
    OdString LoadCommandString(UINT id)
    {
        CString text;
        text.LoadString(id);
        return OdString(static_cast<LPCTSTR>(text));
    }
}

CommandResult VBimCommand::Execute(VBimExecutionContext& ctx)
{
    (void)ctx;
    return CommandResult::Succeeded;
}

bool VBimCommand::AllowInProject() const { return true; }
bool VBimCommand::AllowInFamily() const { return true; }
std::vector<vb::ui::optionbar::OptionItem> VBimCommand::GetOptions() { return {}; }
void VBimCommand::OnOptionChanged(int id, const vb::ui::optionbar::OptionItem& item) { (void)id; (void)item; }
VBimRibbon::TabDef VBimCommand::GetContextualTab() const { return {}; }
void VBimCommand::OnContextualControlChanged(const OdString& controlId, const OdString& value) { (void)controlId; (void)value; }
OdString VBimCommand::GetContextualTabId() const { return OdString::kEmpty; }
int VBimCommand::GetTargetCategory() const { return 0; }
void VBimCommand::OnTypeChanged(const OdBmObjectId& newTypeId) { (void)newTypeId; }
TransactionMode VBimCommand::GetTransactionMode() const { return TransactionMode::Automatic; }
OdString VBimCommand::GetTransactionName() const { return globalName(); }
OdString VBimCommand::GetDisplayName() const { return globalName(); }

void VBimCommand::execute(OdEdCommandContext* pCmdCtx)
{
    if (pCmdCtx == nullptr)
        return;

    OdBmCommandContextPtr pDbCmdCtx(pCmdCtx);
    if (pDbCmdCtx.isNull())
        return;

    OdBmDatabase* pDb = pDbCmdCtx->database();
    OdBmUserIO* pIO = nullptr;
    try
    {
        pIO = pDbCmdCtx->dbUserIO();
    }
    catch (...)
    {
        // Fallback if dbUserIO is not available
    }

    if (pDb == nullptr)
    {
        if (pIO)
            pIO->putString(LoadCommandString(IDS_SDKAPI_CMD_NO_DATABASE));
        return;
    }

    const bool isProject = pDb->isModel();
    if (isProject && !AllowInProject())
    {
        if (pIO)
            pIO->putString(LoadCommandString(IDS_SDKAPI_CMD_FAMILY_ONLY));
        return;
    }
    if (!isProject && !AllowInFamily())
    {
        if (pIO)
            pIO->putString(LoadCommandString(IDS_SDKAPI_CMD_PROJECT_ONLY));
        return;
    }

    VBimUIDocument* pUiDoc = VBimUIApplication::Instance().ActiveUIDocument();

    // Resolve the active view and its level. getActiveDBDrawingId() is the
    // OdBmDBDrawing shown in the view window; the model view is its base DB view
    // (same resolution as ExBimCommandContext::select / OdaModelSession).
    OdBmObjectId activeViewId = OdBmObjectId::kNull;
    OdBmObjectId activeLevelId = OdBmObjectId::kNull;
    try
    {
        const OdBmObjectId drawingId = pDb->getActiveDBDrawingId();
        const OdBmDBDrawingPtr pDrawing = drawingId.isNull()
            ? OdBmDBDrawingPtr() : OdBmDBDrawing::cast(drawingId.openObject());
        if (!pDrawing.isNull())
        {
            activeViewId = pDrawing->getBaseDBViewId();
            const OdBmDBViewPtr pView = activeViewId.isNull()
                ? OdBmDBViewPtr() : OdBmDBView::cast(activeViewId.openObject());
            if (pView.isNull())
            {
                activeViewId = OdBmObjectId::kNull;
            }
            else
            {
                // OdBmDBView::getGenElemId() is the view level (plan views); 3D views
                // and sections have none, so keep it only when it opens as a level.
                const OdBmObjectId levelId = pView->getGenElemId();
                if (!levelId.isNull() && !OdBmLevel::cast(levelId.openObject()).isNull())
                    activeLevelId = levelId;
            }
        }
    }
    catch (const OdError& e)
    {
        (void)e;
        ODA_TRACE1("VBimCommand::execute active view lookup OdError: %ls\n", e.description().c_str());
        activeViewId = OdBmObjectId::kNull;
        activeLevelId = OdBmObjectId::kNull;
    }

    VBimExecutionContextImpl context(pDb, pUiDoc, activeViewId, activeLevelId, pIO);

    // 1. Configure and show Option Bar using RAII scope guard (always displays active command)
    const OdString cmdName = GetDisplayName();
    const std::vector<vb::ui::optionbar::OptionItem> options = GetOptions();
    vb::ui::optionbar::VBimOptionBarScope optionBarScope(cmdName, options,
        [this](int id, const vb::ui::optionbar::OptionItem& item)
        {
            this->OnOptionChanged(id, item);
        });

    // 1.1 Configure and show Contextual Ribbon Tab using RAII scope guard if specified
    vb::ui::ribbon::VBimContextualTabScope contextualTabScope;
    const VBimRibbon::TabDef dynTab = GetContextualTab();
    if (!dynTab.name.isEmpty())
    {
        contextualTabScope.Show(dynTab, [this](const OdString& id, const OdString& val)
        {
            this->OnContextualControlChanged(id, val);
        });
    }
    else if (!GetContextualTabId().isEmpty())
    {
        contextualTabScope.Show(GetContextualTabId());
    }

    // 2. Execute with Transaction scoping.
    //
    // A cancelled or failed command is reported to ODA by an exception leaving
    // execute(): OdEdCancel makes the command stack fire commandCancelled, any other
    // error commandFailed. That is how VBimChangeTracker drops the ids staged by a
    // rolled-back transaction (commandEnded would publish them). The Host command
    // boundary (CVinaBIMDoc::ExecuteCommand) catches OdEdCancel / OdError and shows
    // the error description, so nothing is printed here for a rethrown error.
    const TransactionMode txMode = GetTransactionMode();
    CommandResult result = CommandResult::Succeeded;
    try
    {
        if (txMode == TransactionMode::Automatic)
        {
            // Note: Automatic mode is strictly non-interactive. Commands requiring interactive
            // picking/prompts via GetUserIO() or modal dialogs MUST use TransactionMode::Manual
            // so prompts execute outside an open transaction.
            // Declared before tx so it outlives it: snapshots are recorded only after commit.
            DeferredUndoLevel deferredUndo(pDb);
            OdExplicitTransaction tx(pDb, GetTransactionName());
            result = Execute(context);
            if (result == CommandResult::Succeeded)
            {
                tx.commit();
                deferredUndo.Flush();
            }
            else
            {
                tx.rollback();
            }
        }
        else
        {
            // Manual or ReadOnly mode: Command manages transactions internally
            result = Execute(context);
        }
    }
    catch (const OdEdCancel&)
    {
        // ESC. Automatic: the transaction was rolled back by its guard; end as cancelled
        // so its ids are dropped. Manual/ReadOnly: transactions the command already
        // committed stay in the model; end normally so DocumentChanged reports them.
        if (txMode == TransactionMode::Automatic)
            throw;
        return;
    }
    catch (const OdError&)
    {
        throw;
    }
    catch (const std::exception& ex)
    {
        OdString msg;
        msg.format(LoadCommandString(IDS_SDKAPI_CMD_EXCEPTION_FMT).c_str(), OdString(ex.what()).c_str());
        throw OdError(msg);
    }
    catch (...)
    {
        throw OdError(LoadCommandString(IDS_SDKAPI_CMD_UNKNOWN_EXCEPTION));
    }

    if (result == CommandResult::Cancelled)
    {
        if (txMode == TransactionMode::Automatic)
            throw OdEdCancel();
        return; // Manual/ReadOnly: see the OdEdCancel handler above.
    }
    if (result == CommandResult::Failed)
    {
        OdString msg;
        msg.format(LoadCommandString(IDS_SDKAPI_CMD_RESULT_FAILED_FMT).c_str(), cmdName.c_str());
        throw OdError(msg);
    }
}

namespace vb::commands::detail
{
    void RecordOrDeferUndoSnapshot(VBimUIDocument* pUiDoc, std::shared_ptr<OdaSnapshotDeltaAction> pSnapshot)
    {
        if (pUiDoc == nullptr || !pSnapshot)
            return;
        DeferredUndo entry{ pUiDoc, std::move(pSnapshot) };
        // Only an edit on the command's own database nests in its transaction.
        if (!s_deferredUndo.empty() && s_deferredUndo.back().pDb == pUiDoc->GetDatabase())
            s_deferredUndo.back().entries.push_back(std::move(entry));
        else
            RecordUndoNow(entry);
    }
}
