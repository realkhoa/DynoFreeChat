/**
 * @file VBimProjectCommand.h
 * @brief High-level base class for VinaBIM Project (.rvt) commands.
 *
 * Provides backward-compatibility alias for the unified VBimCommand base class.
 */

#pragma once

#include "../VBimCommand.h"
#include "VBimProjectExecutionContext.h"

namespace vb::commands
{
    /**
     * @brief Command result alias maintaining 100% backward compatibility.
     */
    using CommandResult = ::CommandResult;

    /**
     * @brief Transaction mode policy alias maintaining 100% backward compatibility.
     */
    using TransactionMode = ::TransactionMode;

    /**
     * @brief Base class alias for Project commands mapping to the unified VBimCommand base class.
     */
    using VBimProjectCommand = ::VBimCommand;
}
