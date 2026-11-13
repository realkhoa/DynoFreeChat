#pragma once
#include "OdaCommon.h"
#include "RxVariantValue.h"
#include "Ge/Ge.h"
#include "OdString.h"
#include <vector>
#include <unordered_map>

/**
 * @brief Level 2 Order Depth Tier Structure conforming to VinaBIM Doxygen standards.
 */
struct OdOrderDepthTier {
    double   price = 0.0;  ///< Price in thousands VND
    OdUInt64 volume = 0;    ///< Matching share count
};

/**
 * @brief Snapshot of market quote and bid/ask queue.
 */
struct OdStockSnapshot {
    double lastPrice = 0.0;
    OdString diff;
    double refPrice = 0.0;
    double ceilPrice = 0.0;
    double floorPrice = 0.0;
    std::vector<OdOrderDepthTier> bids; ///< Top 3 Bid orders
    std::vector<OdOrderDepthTier> asks; ///< Top 3 Ask orders
    OdUInt64 totalVolume = 0;
};

namespace VinaBIM {
    namespace Infrastructure {
        namespace Oda {
            OdResult GetStockSnapshot(const OdString& sSymbol, OdStockSnapshot& outSnapshot);
        }
    }
}
