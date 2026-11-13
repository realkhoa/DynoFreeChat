#pragma once

// Planar polygon triangulation for grounded-walk geometry extraction: a face is an
// outer loop plus optional hole loops. Engine-free (std only).
//
// Method: slab (trapezoid) decomposition in the face plane. The face is cut into
// vertical slabs at every vertex abscissa; inside a slab no edges meet, so the
// edges crossing it are ordered by height and paired even-odd, and each pair
// bounds one trapezoid (two triangles). Holes need no bridging. A final area
// check rejects self-intersecting outlines and overlapping or misplaced holes.
// (Ear clipping with hole bridges failed on real faces with many holes, runtime
// finding 2026-10-05.)

#include <algorithm>
#include <cmath>
#include <vector>

#include "Core/walk/GroundedWalkSolver.h"

namespace vbim
{
namespace grounded_walk
{
namespace detail
{
// Copies a loop without consecutive (and closing) duplicates closer than eps.
inline void CleanLoop(const std::vector<Vec3>& loop, double eps, std::vector<Vec3>& out)
{
	out.clear();
	for (const Vec3& p : loop)
	{
		if (!out.empty())
		{
			const Vec3 d = Sub(p, out.back());
			if (Dot(d, d) <= eps * eps)
				continue;
		}
		out.push_back(p);
	}
	while (out.size() > 1)
	{
		const Vec3 d = Sub(out.front(), out.back());
		if (Dot(d, d) > eps * eps)
			break;
		out.pop_back();
	}
}
}

/** @brief Triangulates one planar face given as an outer loop plus hole loops.
 * @param outer Outer boundary in order (either winding); consecutive duplicates tolerated.
 * @param holes Hole boundaries (either winding); each must lie inside the outer loop (a
 * hole touching the outline is a notch and is covered exactly), in its plane, and must
 * not overlap another hole.
 * @param out Receives the triangles on success; appended to.
 * @return False when any loop is degenerate, the face is non-planar beyond a relative
 * tolerance of 1e-4 of its size, a hole vertex is not inside the outer loop, or the
 * triangle areas do not add up to the outer area minus the hole areas (self-intersecting
 * outline, overlapping holes). Nothing is appended on failure.
 * @note Pure value math. Slab decomposition (see file comment): the triangle count
 * grows with the number of distinct vertex abscissas times the loops crossing a slab;
 * O(n^2 log n) in the total vertex count.
 */
inline bool TriangulatePlanarPolygonWithHoles(const std::vector<Vec3>& outer, const std::vector<std::vector<Vec3>>& holes,
	std::vector<Triangle>& out)
{
	double minC[3] = { 1e300, 1e300, 1e300 }, maxC[3] = { -1e300, -1e300, -1e300 };
	const auto grow = [&](const std::vector<Vec3>& loop) {
		for (const Vec3& p : loop)
		{
			if (!detail::IsFinite(p))
				return false;
			minC[0] = (std::min)(minC[0], p.x); maxC[0] = (std::max)(maxC[0], p.x);
			minC[1] = (std::min)(minC[1], p.y); maxC[1] = (std::max)(maxC[1], p.y);
			minC[2] = (std::min)(minC[2], p.z); maxC[2] = (std::max)(maxC[2], p.z);
		}
		return true;
	};
	if (outer.size() < 3 || !grow(outer))
		return false;
	for (const std::vector<Vec3>& hole : holes)
	{
		if (hole.size() < 3 || !grow(hole))
			return false;
	}
	const double size = std::sqrt((maxC[0] - minC[0]) * (maxC[0] - minC[0]) + (maxC[1] - minC[1]) * (maxC[1] - minC[1])
		+ (maxC[2] - minC[2]) * (maxC[2] - minC[2]));
	const double eps = 1e-9 * (size > 0.0 ? size : 1.0);

	// All loops cleaned and stored back to back in pts; loop k is [first[k], first[k+1]).
	std::vector<Vec3> pts;
	std::vector<std::size_t> first;
	std::vector<Vec3> cleaned;
	for (std::size_t k = 0; k <= holes.size(); ++k)
	{
		detail::CleanLoop(k == 0 ? outer : holes[k - 1], eps, cleaned);
		if (cleaned.size() < 3)
			return false;
		first.push_back(pts.size());
		pts.insert(pts.end(), cleaned.begin(), cleaned.end());
	}
	first.push_back(pts.size());
	const std::size_t outerCount = first[1];

	// Newell normal of the outer loop and planarity of every loop against it.
	Vec3 normal{};
	Vec3 centroid{};
	for (std::size_t i = 0; i < outerCount; ++i)
	{
		const Vec3& a = pts[i];
		const Vec3& b = pts[(i + 1) % outerCount];
		normal.x += (a.y - b.y) * (a.z + b.z);
		normal.y += (a.z - b.z) * (a.x + b.x);
		normal.z += (a.x - b.x) * (a.y + b.y);
		centroid = detail::Add(centroid, a);
	}
	const double normalLength = std::sqrt(detail::Dot(normal, normal));
	if (!(normalLength > eps * size))
		return false;
	normal = detail::Mul(normal, 1.0 / normalLength);
	centroid = detail::Mul(centroid, 1.0 / static_cast<double>(outerCount));
	// 1e-4 of the face size: exported faces carry micrometre noise (runtime 2026-10-05: up to
	// 6e-5 of size on otherwise flat faces); real bends are far larger.
	const double planeTolerance = 1e-4 * size;
	for (const Vec3& p : pts)
	{
		if (std::abs(detail::Dot(detail::Sub(p, centroid), normal)) > planeTolerance)
			return false;
	}

	// Project to 2D dropping the dominant normal axis.
	const double ax = std::abs(normal.x), ay = std::abs(normal.y), az = std::abs(normal.z);
	const int drop = (ax >= ay && ax >= az) ? 0 : (ay >= az ? 1 : 2);
	const std::size_t total = pts.size();
	std::vector<double> u(total), v(total);
	for (std::size_t i = 0; i < total; ++i)
	{
		u[i] = drop == 0 ? pts[i].y : pts[i].x;
		v[i] = drop == 2 ? pts[i].y : pts[i].z;
	}
	const double areaEps = eps * size;
	const auto loopArea2 = [&](std::size_t k) {
		double a = 0.0;
		const std::size_t b = first[k], n = first[k + 1] - first[k];
		for (std::size_t i = 0; i < n; ++i)
			a += u[b + i] * v[b + (i + 1) % n] - u[b + (i + 1) % n] * v[b + i];
		return a;
	};
	const double outerArea2 = loopArea2(0);
	if (std::abs(outerArea2) <= areaEps)
		return false;

	// Crossing-number point-in-polygon against the outer loop.
	const auto insideOuter = [&](double pu, double pv) {
		bool in = false;
		for (std::size_t i = 0, j = outerCount - 1; i < outerCount; j = i++)
		{
			if ((v[i] > pv) != (v[j] > pv) && pu < (u[j] - u[i]) * (pv - v[i]) / (v[j] - v[i]) + u[i])
				in = !in;
		}
		return in;
	};
	double holesArea2 = 0.0;
	for (std::size_t k = 1; k + 1 < first.size(); ++k)
	{
		const double a2 = loopArea2(k);
		if (std::abs(a2) <= areaEps)
			return false;
		holesArea2 += std::abs(a2);
		for (std::size_t i = first[k]; i < first[k + 1]; ++i)
		{
			if (!insideOuter(u[i], v[i]))
				return false;  // touching or outside the outer loop
		}
	}

	// Directed edges of all loops (start, end), skipping those parallel to the slabs.
	struct Edge
	{
		std::size_t a, b;
	};
	std::vector<Edge> edges;
	for (std::size_t k = 0; k + 1 < first.size(); ++k)
	{
		const std::size_t b = first[k], n = first[k + 1] - first[k];
		for (std::size_t i = 0; i < n; ++i)
		{
			const std::size_t ea = b + i, eb = b + (i + 1) % n;
			if (std::abs(u[ea] - u[eb]) > eps)
				edges.push_back({ ea, eb });
		}
	}
	std::vector<double> cuts(u);
	std::sort(cuts.begin(), cuts.end());
	std::vector<double> slabs;
	for (double c : cuts)
	{
		if (slabs.empty() || c - slabs.back() > eps)
			slabs.push_back(c);
	}
	// Point of edge e at abscissa x, in 3D (exact on the face plane by interpolation).
	const auto at = [&](const Edge& e, double x) {
		const double t = (x - u[e.a]) / (u[e.b] - u[e.a]);
		return detail::Add(pts[e.a], detail::Mul(detail::Sub(pts[e.b], pts[e.a]), t));
	};
	const auto heightAt = [&](const Edge& e, double x) {
		const double t = (x - u[e.a]) / (u[e.b] - u[e.a]);
		return v[e.a] + (v[e.b] - v[e.a]) * t;
	};

	std::vector<Triangle> result;
	std::vector<std::pair<double, std::size_t>> crossing;
	const auto emit = [&](const Vec3& p, const Vec3& q, const Vec3& r) {
		const Vec3 c = detail::Cross(detail::Sub(q, p), detail::Sub(r, p));
		if (std::abs(detail::Dot(c, normal)) > areaEps)
			result.push_back({ p, q, r });
	};
	// Convex face without holes (most faces): a fan gives n - 2 triangles, exactly
	// covering the face, instead of one trapezoid pair per slab.
	bool convex = holes.empty();
	for (std::size_t i = 0; i < outerCount && convex; ++i)
	{
		const std::size_t a = i, b = (i + 1) % outerCount, c = (i + 2) % outerCount;
		const double turn = (u[b] - u[a]) * (v[c] - v[a]) - (v[b] - v[a]) * (u[c] - u[a]);
		convex = outerArea2 > 0.0 ? turn >= -areaEps : turn <= areaEps;
	}
	for (std::size_t i = 1; convex && i + 1 < outerCount; ++i)
		emit(pts[0], pts[i], pts[i + 1]);
	for (std::size_t s = 0; !convex && s + 1 < slabs.size(); ++s)
	{
		const double x0 = slabs[s], x1 = slabs[s + 1], xm = 0.5 * (x0 + x1);
		crossing.clear();
		for (std::size_t e = 0; e < edges.size(); ++e)
		{
			const double lo = (std::min)(u[edges[e].a], u[edges[e].b]), hi = (std::max)(u[edges[e].a], u[edges[e].b]);
			if (lo <= x0 + eps && hi >= x1 - eps)
				crossing.push_back({ heightAt(edges[e], xm), e });
		}
		if (crossing.size() % 2 != 0)
			return false;
		std::sort(crossing.begin(), crossing.end());
		for (std::size_t i = 0; i + 1 < crossing.size(); i += 2)
		{
			const Edge& lower = edges[crossing[i].second];
			const Edge& upper = edges[crossing[i + 1].second];
			const Vec3 l0 = at(lower, x0), l1 = at(lower, x1), h0 = at(upper, x0), h1 = at(upper, x1);
			emit(l0, l1, h1);
			emit(l0, h1, h0);
		}
	}
	if (result.empty())
		return false;

	// Self-intersections or overlapping holes change the even-odd covered area; reject
	// anything whose triangles do not add up to the outer area minus the hole areas.
	double triangleArea2 = 0.0;
	for (const Triangle& t : result)
	{
		const Vec3 c = detail::Cross(detail::Sub(t.b, t.a), detail::Sub(t.c, t.a));
		triangleArea2 += std::abs(detail::Dot(c, normal));
	}
	const double scale = drop == 0 ? 1.0 / ax : drop == 1 ? 1.0 / ay : 1.0 / az;
	const double expected = (std::abs(outerArea2) - holesArea2) * scale;
	if (!(expected > areaEps) || std::abs(triangleArea2 - expected) > 1e-6 * triangleArea2 + areaEps)
		return false;
	out.insert(out.end(), result.begin(), result.end());
	return true;
}

/** @brief Triangulates one planar, simple polygon given in order (no holes).
 * @param polygon Vertices in boundary order (either winding); consecutive
 * duplicates are tolerated.
 * @param out Receives the triangles on success; appended to.
 * @return False when the polygon is degenerate (zero area), non-planar beyond a
 * relative tolerance of 1e-4 of its size, non-finite, or self-intersecting.
 * Nothing is appended on failure.
 * @note Same as TriangulatePlanarPolygonWithHoles with no holes.
 */
inline bool TriangulatePlanarPolygon(const std::vector<Vec3>& polygon, std::vector<Triangle>& out)
{
	return TriangulatePlanarPolygonWithHoles(polygon, {}, out);
}
}
}
