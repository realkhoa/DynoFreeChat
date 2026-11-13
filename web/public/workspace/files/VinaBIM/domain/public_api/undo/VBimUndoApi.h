/**
 * @file VBimUndoApi.h
 * @brief Public SDK contracts and delta actions for Undo/Redo operations.
 *
 * Exposes core reversible action contracts and standard ODA delta action
 * implementations so plugin modules and project commands can record changes
 * for the host document's Undo (Ctrl+Z) and Redo (Ctrl+Y) stacks.
 */

#pragma once

#if defined(__has_include)
  #if __has_include("Core/contracts/undo/IUndoableAction.h")
    #include "Core/contracts/undo/IUndoableAction.h"
    #include "Core/contracts/undo/IUndoRedoManager.h"
    #include "Infrastructure/Oda/undo/OdaCreateDeltaAction.h"
    #include "Infrastructure/Oda/undo/OdaTransformDeltaAction.h"
    #include "Infrastructure/Oda/undo/OdaRotateDeltaAction.h"
    #include "Infrastructure/Oda/undo/OdaEraseDeltaAction.h"
    #include "Infrastructure/Oda/undo/OdaVisibilityDeltaAction.h"
    #include "Infrastructure/Oda/undo/OdaSnapshotDeltaAction.h"
    #include "Infrastructure/Oda/undo/OdaMatrixDeltaAction.h"
    #include "Infrastructure/Oda/undo/OdaCompositeDeltaAction.h"
  #endif
#endif
#include "OdString.h"

class VBimUIDocument;
class CVinaBIMDoc;
class OdBmDatabase;

/**
 * @brief RAII scope guard for composite Undo/Redo transactions.
 * 
 * Automatically ends and commits the composite transaction scope upon destruction.
 * Call Cancel() to abort and discard uncommitted operations.
 */
class VINABIMCORE_DLLEXPORT VBimCompositeUndoScope
{
public:
	/**
	 * @brief Constructs a composite undo scope and begins a transaction.
	 * @param pUiDoc Target UI document.
	 * @param name Descriptive action name for Undo UI display.
	 */
	explicit VBimCompositeUndoScope(VBimUIDocument* pUiDoc, const OdString& name = L"Composite Action");

	/**
	 * @brief Constructs a composite undo scope bound directly to an ODA database.
	 * @param pDb Target ODA database whose owning document should track the composite.
	 * @param name Descriptive action name for Undo UI display.
	 */
	explicit VBimCompositeUndoScope(const OdBmDatabase* pDb, const OdString& name = L"Composite Action");

	/**
	 * @brief Destructor. Automatically ends and commits if not already closed.
	 */
	~VBimCompositeUndoScope();

	/**
	 * @brief Explicitly commits and ends the composite transaction.
	 */
	void Commit();

	/**
	 * @brief Aborts and cancels the composite transaction without committing to Undo.
	 */
	void Cancel();

	VBimCompositeUndoScope(const VBimCompositeUndoScope&) = delete;
	VBimCompositeUndoScope& operator=(const VBimCompositeUndoScope&) = delete;

private:
	CVinaBIMDoc* m_pDoc;
	bool         m_closed;
	int          m_uncaughtExceptions;
};
