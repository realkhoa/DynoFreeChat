#pragma once

// Per-component solid containment for grounded-walk spawn checks (plan §8.4).
// Engine-free (std only).
//
// A component is the triangle range of one source geometry item (one shell or
// one mesh). Only CLOSED components (every welded directed edge matched by
// exactly one reverse edge, non-zero signed volume) are treated as solids;
// inside/outside is decided by the generalized winding number of that
// component alone, so overlapping solids never cancel each other. OPEN
// components are zero-thickness sheets: they never enclose volume, so a room
// assembled from separate wall sheets is free space. As a conservative
// supplement, a point inside the bounding box of an open component that is
// "volume-like" (all extents larger than the body diameter) is reported as
// Ambiguous. This does not prove safety for open geometry.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "Core/walk/GroundedWalkSolver.h"

namespace vbim
{
namespace grounded_walk
{
enum class ComponentTopology
{
	Closed,
	Open
};

/** @brief Classification and bounds of one component (triangle range). */
struct ComponentInfo
{
	std::size_t first = 0;
	std::size_t count = 0;
	ComponentTopology topology = ComponentTopology::Open;
	Vec3 min;
	Vec3 max;
};

enum class ContainmentResult
{
	Outside,
	Ambiguous,
	InsideSolid
};

namespace detail
{
struct WeldKey
{
	long long x, y, z;
	bool operator==(const WeldKey& o) const { return x == o.x && y == o.y && z == o.z; }
};
struct WeldKeyHash
{
	std::size_t operator()(const WeldKey& k) const
	{
		std::size_t h = static_cast<std::size_t>(k.x) * 73856093u;
		h ^= static_cast<std::size_t>(k.y) * 19349663u;
		h ^= static_cast<std::size_t>(k.z) * 83492791u;
		return h;
	}
};
}

/** @brief Classifies triangles [first, first+count) as a closed oriented solid or an open sheet set.
 * @note Vertices are welded on a grid of 1e-6 of the component size. A weld that
 * splits a shared vertex makes a solid look Open; the volume-like Ambiguous check
 * in CheckContainment is the fail-closed backstop for that case.
 */
inline ComponentInfo ClassifyComponent(const std::vector<Triangle>& tris, std::size_t first, std::size_t count)
{
	ComponentInfo info;
	info.first = first;
	info.count = count;
	info.min = { 1e300, 1e300, 1e300 };
	info.max = { -1e300, -1e300, -1e300 };
	for (std::size_t i = first; i < first + count; ++i)
	{
		for (const Vec3* p : { &tris[i].a, &tris[i].b, &tris[i].c })
		{
			info.min = { (std::min)(info.min.x, p->x), (std::min)(info.min.y, p->y), (std::min)(info.min.z, p->z) };
			info.max = { (std::max)(info.max.x, p->x), (std::max)(info.max.y, p->y), (std::max)(info.max.z, p->z) };
		}
	}
	if (count < 4)
		return info;
	const Vec3 extent = detail::Sub(info.max, info.min);
	const double size = std::sqrt(detail::Dot(extent, extent));
	if (!(size > 0.0))
		return info;
	const double tolerance = 1e-6 * size;

	std::unordered_map<detail::WeldKey, std::uint32_t, detail::WeldKeyHash> weld;
	const auto vertexId = [&](const Vec3& p) {
		const detail::WeldKey key{ std::llround((p.x - info.min.x) / tolerance), std::llround((p.y - info.min.y) / tolerance),
			std::llround((p.z - info.min.z) / tolerance) };
		const auto found = weld.find(key);
		if (found != weld.end())
			return found->second;
		const std::uint32_t id = static_cast<std::uint32_t>(weld.size());
		weld.emplace(key, id);
		return id;
	};
	std::unordered_map<std::uint64_t, int> directed;
	double volume6 = 0.0;
	std::size_t used = 0;
	for (std::size_t i = first; i < first + count; ++i)
	{
		const std::uint32_t a = vertexId(tris[i].a), b = vertexId(tris[i].b), c = vertexId(tris[i].c);
		if (a == b || b == c || c == a)
			continue;  // collapsed by welding
		++used;
		for (const auto& e : { std::make_pair(a, b), std::make_pair(b, c), std::make_pair(c, a) })
			++directed[(static_cast<std::uint64_t>(e.first) << 32) | e.second];
		const Vec3 pa = detail::Sub(tris[i].a, info.min), pb = detail::Sub(tris[i].b, info.min), pc = detail::Sub(tris[i].c, info.min);
		volume6 += detail::Dot(pa, detail::Cross(pb, pc));
	}
	if (used < 4)
		return info;
	for (const auto& entry : directed)
	{
		if (entry.second != 1)
			return info;  // duplicated directed edge: non-manifold or inconsistent winding
		const std::uint64_t reverse = (entry.first << 32) | (entry.first >> 32);
		const auto back = directed.find(reverse);
		if (back == directed.end() || back->second != 1)
			return info;  // boundary edge: open
	}
	if (!(std::abs(volume6) > 1e-12 * size * size * size))
		return info;
	info.topology = ComponentTopology::Closed;
	return info;
}

/** @brief Generalized winding number of point p w.r.t. triangles [first, first+count).
 * @return About +/-1 inside a closed oriented component, about 0 outside
 * (Van Oosterom-Strackee solid angles; no ray degeneracy).
 */
inline double WindingNumber(const std::vector<Triangle>& tris, std::size_t first, std::size_t count, const Vec3& p)
{
	double total = 0.0;
	for (std::size_t i = first; i < first + count; ++i)
	{
		const Vec3 a = detail::Sub(tris[i].a, p), b = detail::Sub(tris[i].b, p), c = detail::Sub(tris[i].c, p);
		const double la = std::sqrt(detail::Dot(a, a)), lb = std::sqrt(detail::Dot(b, b)), lc = std::sqrt(detail::Dot(c, c));
		const double det = detail::Dot(a, detail::Cross(b, c));
		const double den = la * lb * lc + detail::Dot(a, b) * lc + detail::Dot(a, c) * lb + detail::Dot(b, c) * la;
		total += 2.0 * std::atan2(det, den);
	}
	return total / (4.0 * 3.14159265358979323846);
}

/** @brief Worst containment result of point p over all components.
 * @param bodyDiameter Open components whose bounding box exceeds this in all three
 * extents and contains p yield Ambiguous.
 * @return InsideSolid if p is inside any closed component (|w| > 0.5), else
 * Ambiguous per the rule above, else Outside.
 */
inline ContainmentResult CheckContainment(const std::vector<Triangle>& tris, const std::vector<ComponentInfo>& components,
	const Vec3& p, double bodyDiameter)
{
	ContainmentResult worst = ContainmentResult::Outside;
	for (const ComponentInfo& c : components)
	{
		if (p.x < c.min.x || p.x > c.max.x || p.y < c.min.y || p.y > c.max.y || p.z < c.min.z || p.z > c.max.z)
			continue;
		if (c.topology == ComponentTopology::Closed)
		{
			if (std::abs(WindingNumber(tris, c.first, c.count, p)) > 0.5)
				return ContainmentResult::InsideSolid;
			continue;
		}
		const Vec3 e = detail::Sub(c.max, c.min);
		if (e.x > bodyDiameter && e.y > bodyDiameter && e.z > bodyDiameter)
			worst = ContainmentResult::Ambiguous;
	}
	return worst;
}

/** @brief Classifies every component stored in the solver (call once after SetGeometry). */
inline std::vector<ComponentInfo> ClassifyComponents(const GroundedWalkSolver& solver)
{
	std::vector<ComponentInfo> infos;
	infos.reserve(solver.Components().size());
	for (const ComponentRange& range : solver.Components())
		infos.push_back(ClassifyComponent(solver.Triangles(), range.first, range.count));
	return infos;
}

enum class SpawnStatus
{
	Ok,
	NotAtEyeHeight,  // the first surface below the eye is missing or not walkable
	Blocked,         // body touches geometry at the spawn point
	NoFootprint,     // footprint sampling policy failed
	InsideSolid,     // eye or body center inside a closed component
	Ambiguous,       // inside the bounds of a volume-like open component
	InvalidInput
};

struct SpawnResult
{
	SpawnStatus status = SpawnStatus::InvalidInput;
	Vec3 feet;
};

/** @brief Finds a grounded spawn directly below the camera eye (plan §8.4).
 * @param eye Current camera eye in meters.
 * @return Ok with the feet on the first surface below the eye (at any distance) when
 * that surface is walkable, the body is clear, the footprint holds, and neither the
 * original eye, the eye at the placed height nor the body center is inside a closed
 * component or a volume-like open one. The caller then moves the camera vertically to
 * feet + eyeHeight, so the camera may drop onto a roof or, through a floor opening, onto
 * a lower floor. Off-axis objects inside the body are rejected by the body check, not by
 * containment. Safety for open geometry is not proven.
 */
inline SpawnResult FindGroundedSpawn(const GroundedWalkSolver& solver, const std::vector<ComponentInfo>& components, const Vec3& eye)
{
	SpawnResult result;
	result.feet = eye;
	if (!detail::IsFinite(eye) || solver.Triangles().empty())
		return result;
	const Profile& p = solver.GetProfile();
	// The probe must reach below the lowest triangle; its length does not affect the cost
	// because candidates come from the XY grid cell only.
	double lowestZ = eye.z;
	for (const Triangle& tri : solver.Triangles())
		lowestZ = (std::min)({ lowestZ, tri.a.z, tri.b.z, tri.c.z });
	double supportZ = 0.0;
	if (lowestZ >= eye.z || !solver.ProbeSupport(eye.x, eye.y, eye.z, lowestZ - 1.0, supportZ))
	{
		result.status = SpawnStatus::NotAtEyeHeight;
		return result;
	}
	const Vec3 feet{ eye.x, eye.y, supportZ };
	if (!solver.IsBodyPathClear(feet, feet))
	{
		result.status = SpawnStatus::Blocked;
		return result;
	}
	if (!solver.IsFootprintSupported(feet))
	{
		result.status = SpawnStatus::NoFootprint;
		return result;
	}
	const double diameter = 2.0 * p.radius;
	ContainmentResult worst = ContainmentResult::Outside;
	for (const Vec3& point : { eye, Vec3{ feet.x, feet.y, feet.z + p.eyeHeight }, Vec3{ feet.x, feet.y, feet.z + 0.5 * p.bodyHeight } })
	{
		const ContainmentResult r = CheckContainment(solver.Triangles(), components, point, diameter);
		if (r == ContainmentResult::InsideSolid)
		{
			result.status = SpawnStatus::InsideSolid;
			return result;
		}
		if (r == ContainmentResult::Ambiguous)
			worst = r;
	}
	if (worst == ContainmentResult::Ambiguous)
	{
		result.status = SpawnStatus::Ambiguous;
		return result;
	}
	result.status = SpawnStatus::Ok;
	result.feet = feet;
	return result;
}
}
}
