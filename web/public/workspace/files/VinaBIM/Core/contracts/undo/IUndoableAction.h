#pragma once

#include <string>

/**
 * @brief Abstract interface representing a reversible action in VinaBIM.
 * 
 * Implements the GoF Command pattern for the Undo/Redo mechanism.
 * Implementations capture pre-image delta states and provide inverted
 * executions to restore the model without full database replication.
 */
class IUndoableAction
{
public:
	/**
	 * @brief Virtual destructor.
	 */
	virtual ~IUndoableAction() = default;

	/**
	 * @brief Reverts the changes made by this action (Undo).
	 * 
	 * Restores pre-image delta state within an ODA RAII transaction.
	 */
	virtual void Undo() = 0;

	/**
	 * @brief Re-applies the changes reverted by this action (Redo).
	 * 
	 * Re-applies post-image delta state within an ODA RAII transaction.
	 */
	virtual void Redo() = 0;

	/**
	 * @brief Retrieves the human-readable name of the action.
	 * @return Localized or descriptive action name (e.g. L"Move", L"Rotate").
	 */
	virtual std::wstring GetName() const = 0;

	/**
	 * @brief Retrieves underlying database context pointer associated with this action, if any.
	 * @return Opaque pointer to the associated database (e.g. OdBmDatabase*), or nullptr.
	 */
	virtual const void* GetDatabaseContext() const { return nullptr; }
};
