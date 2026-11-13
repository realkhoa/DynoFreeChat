#pragma once

// Affine transform composition for grounded-walk geometry extraction.
// Engine-free (std only). The extractor converts every SDK matrix it meets on
// the way from a geometry item up to the world into a WalkMatrix and composes
// them with ComposeWalkTransform, so there is exactly one place that decides
// the multiplication order. That order is verified by the
// tests/OdaWalkGeometrySmoke fixture against analytic coordinates and against
// the SDK's own ray trace (plan §8.3); it is not assumed.

#include <array>
#include <cmath>
#include <vector>

#include "Core/walk/GroundedWalkSolver.h"

namespace vbim
{
namespace grounded_walk
{
/** @brief Row-major 3x4 affine matrix: x' = m[0]*x + m[1]*y + m[2]*z + m[3], etc. */
struct WalkMatrix
{
	std::array<double, 12> m{ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0 };
};

/** @brief Returns a * b (apply b first, then a). Pure value math. */
inline WalkMatrix Multiply(const WalkMatrix& a, const WalkMatrix& b)
{
	WalkMatrix r;
	for (int row = 0; row < 3; ++row)
	{
		for (int col = 0; col < 4; ++col)
		{
			double v = a.m[row * 4 + 0] * b.m[0 + col] + a.m[row * 4 + 1] * b.m[4 + col] + a.m[row * 4 + 2] * b.m[8 + col];
			if (col == 3)
				v += a.m[row * 4 + 3];
			r.m[row * 4 + col] = v;
		}
	}
	return r;
}

/** @brief Composes a transform chain ordered from the outermost (world-side) matrix
 * to the innermost (geometry-side) matrix: result = chain[0] * chain[1] * ... * chain[n-1].
 * @return Identity for an empty chain.
 * @note The extractor passes: units matrix, model modeling matrix, insert block
 * transforms from outer to inner, then the geometry data modeling matrix.
 */
inline WalkMatrix ComposeWalkTransform(const std::vector<WalkMatrix>& chain)
{
	WalkMatrix result;
	for (const WalkMatrix& next : chain)
		result = Multiply(result, next);
	return result;
}

/** @brief Applies the affine matrix to a point. */
inline Vec3 Apply(const WalkMatrix& t, const Vec3& p)
{
	return { t.m[0] * p.x + t.m[1] * p.y + t.m[2] * p.z + t.m[3],
		t.m[4] * p.x + t.m[5] * p.y + t.m[6] * p.z + t.m[7],
		t.m[8] * p.x + t.m[9] * p.y + t.m[10] * p.z + t.m[11] };
}

/** @brief True when every coefficient is finite. */
inline bool IsFinite(const WalkMatrix& t)
{
	for (double v : t.m)
	{
		if (!std::isfinite(v))
			return false;
	}
	return true;
}
}
}
