#pragma once

#include <memory>

class VBimUIDocument;
class OdaSnapshotDeltaAction;

/**
 * @file VBimDeferredUndo.h
 * @brief Host-internal hook that ties SDK undo snapshots to the VBimCommand Automatic transaction.
 *
 * Not part of the plugin API.
 */
namespace vb::commands::detail
{
    /**
     * @brief Records a snapshot as an Undo step, now or once the Automatic command transaction commits.
     * @param pUiDoc Document whose undo stack receives the step; must stay open until the command ends.
     * @param pSnapshot Snapshot whose pre-state was captured before the edit.
     * @note Outside a VBimCommand in TransactionMode::Automatic this calls CommitPostState() and
     *  RecordUndoAction() immediately. Inside one, the post-state is captured and the step is
     *  recorded after the command transaction commits; if the command is cancelled, fails or
     *  throws, the transaction is rolled back and the snapshot is dropped, so no Undo step is
     *  left for a change that did not happen.
     */
    void RecordOrDeferUndoSnapshot(VBimUIDocument* pUiDoc, std::shared_ptr<OdaSnapshotDeltaAction> pSnapshot);
}
