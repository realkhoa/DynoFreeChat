#pragma once

#include <memory>
#include "IUndoableAction.h"

/**
 * @brief Abstract interface managing the Undo/Redo delta action stacks.
 * 
 * Scoped per document to isolate transaction histories. Tracks bounded
 * action records, provides capability queries for UI enablement, and
 * coordinates the parametric regeneration cycle on Undo/Redo invocations.
 */
class IUndoRedoManager
{
public:
	/**
	 * @brief Virtual destructor.
	 */
	virtual ~IUndoRedoManager() = default;

	/**
	 * @brief Checks whether an Undo operation is currently available.
	 * @return true if the Undo stack is not empty, false otherwise.
	 */
	virtual bool CanUndo() const = 0;

	/**
	 * @brief Checks whether a Redo operation is currently available.
	 * @return true if the Redo stack is not empty, false otherwise.
	 */
	virtual bool CanRedo() const = 0;

	/**
	 * @brief Executes an Undo operation by reverting the topmost delta record.
	 * @return true if an action was successfully reverted, false otherwise.
	 */
	virtual bool Undo() = 0;

	/**
	 * @brief Executes a Redo operation by re-applying the topmost reverted delta record.
	 * @return true if an action was successfully re-applied, false otherwise.
	 */
	virtual bool Redo() = 0;

	/**
	 * @brief Pushes a new delta action onto the Undo stack and purges the Redo stack.
	 * @param action Shared pointer to the reversible action to record.
	 */
	virtual void PushAction(std::shared_ptr<IUndoableAction> action) = 0;

	/**
	 * @brief Clears both Undo and Redo stacks.
	 */
	virtual void Clear() = 0;

	/**
	 * @brief Gets the description of the action at the top of the Undo stack.
	 * @return Name of the undo action, or empty string if Undo stack is empty.
	 */
	virtual std::wstring GetUndoActionName() const = 0;

	/**
	 * @brief Gets the description of the action at the top of the Redo stack.
	 * @return Name of the redo action, or empty string if Redo stack is empty.
	 */
	virtual std::wstring GetRedoActionName() const = 0;

	/**
	 * @brief Begins a composite undo transaction scope.
	 * 
	 * Nested calls will create sub-composites or append to the active composite.
	 * Actions pushed while a composite scope is open are batched together.
	 * @param name Descriptive name of the composite transaction (e.g. L"Array Elements").
	 */
	virtual void BeginComposite(const std::wstring& name = L"Composite Action") = 0;

	/**
	 * @brief Ends the active composite transaction scope and commits it to the Undo stack.
	 */
	virtual void EndComposite() = 0;

	/**
	 * @brief Cancels the active composite transaction scope without committing it to the Undo stack.
	 */
	virtual void CancelComposite() = 0;

	/**
	 * @brief Checks if a composite transaction scope is currently active.
	 * @return true if currently inside BeginComposite/EndComposite, false otherwise.
	 */
	virtual bool IsInComposite() const = 0;
};
