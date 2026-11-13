/**
 * @file VBimProjectExecutionContext.h
 * @brief Strongly-typed facade providing runtime services to commands.
 *
 * Provides backward compatibility alias for VBimExecutionContext.
 */

#pragma once

#include "../VBimCommand.h"

namespace vb::commands
{
    /**
     * @brief Strongly-typed execution context alias maintaining 100% backward compatibility.
     */
    using VBimProjectExecutionContext = ::VBimExecutionContext;
}
