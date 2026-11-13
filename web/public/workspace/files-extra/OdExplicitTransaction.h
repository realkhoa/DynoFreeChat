#pragma once
#include "Database/BmTransaction.h"

/**
 * @brief Alias for OdBmTransaction to conform to VinaBIM's RAII standards.
 * 100% RAII transaction scoping (OdExplicitTransaction tx(pDb););
 * Strictly forbids dangling transactions and unverified handle probing.
 */
typedef OdBmTransaction OdExplicitTransaction;
