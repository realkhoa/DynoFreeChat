#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "shared/core/VbResult.h"

namespace vb::param
{
	// Engine-neutral write access to a single parameter, covering the
	// resolve -> check-writable -> parse/unit-convert -> validate -> transact
	// -> write pipeline used by every parameter editing surface in VinaBIM
	// (Properties panel, Edit Type). Implemented by Infrastructure/Oda
	// (OdaParameterWriter).
	//
	// elementToken/paramToken are OdBmObjectId handles packed the same way
	// Host already packs every other element/parameter token (OBJID2DWORDPTR).
	// valueAsText is the raw display-unit user input (e.g. "2500" or "Yes");
	// per-storage-type parsing and unit conversion happen inside the writer.
	class IParameterWriter
	{
	public:
		virtual ~IParameterWriter() = default;

		// Resolves write eligibility (read-only / formula-driven / unsupported
		// target / Button-requires-dedicated-dialog / type-param-on-instance),
		// parses and unit-converts valueAsText for the parameter's storage
		// type, pre-validates it, then writes it inside its own RAII
		// transaction (committed on success, rolled back on any failure).
		//
		// calledFromPropertiesPanel controls whether a Type parameter on a
		// model instance is rejected (Properties panel must route the user to
		// Edit Type) or written directly (Edit Type/Family Editor callers).
		//
		// Returns Result::Err with a user-facing rejection/failure message on
		// any rejection or write failure.
		virtual vb::Result<vb::Void> WriteParameterValue(
			uint64_t elementToken,
			uint64_t paramToken,
			const std::wstring& valueAsText,
			bool calledFromPropertiesPanel) = 0;

		/**
		 * @brief Writes a parameter value to multiple elements atomically within a single transaction.
		 * @param elementTokens Vector of element handles (OBJID2DWORDPTR).
		 * @param paramToken Parameter handle.
		 * @param valueAsText New value in project display units.
		 * @param calledFromPropertiesPanel Whether initiated from the Properties panel.
		 * @return Success if all elements updated; failure rolls back all changes.
		 */
		virtual vb::Result<vb::Void> WriteParameterValueMulti(
			const std::vector<uint64_t>& elementTokens,
			uint64_t paramToken,
			const std::wstring& valueAsText,
			bool calledFromPropertiesPanel) = 0;
	};
}
