#pragma once

// Grounded (visitor) walk controller — pure math, engine-free (std only).
//
// Designed in docs/research/walk-feature/walk-implementation-plan.md §7/§8 and
// tested by tests/local/visualize_grounded_walk_regression.ts. Integrated
// through IGroundedWalkCapability; the product keeps it hidden until runtime
// acceptance. Passing synthetic tests says nothing about geometry coverage,
// units or performance of real scenes.
//
// Coordinates are meters, world Z up. The caller supplies copied static
// triangles (two-sided); no SDK pointer is retained.

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace vbim
{
namespace grounded_walk
{
struct Vec3
{
	double x = 0.0;
	double y = 0.0;
	double z = 0.0;
};

struct Triangle
{
	Vec3 a;
	Vec3 b;
	Vec3 c;
};

/** @brief Physical body and probe policy. Values are experimental proposals (plan §7.1). */
struct Profile
{
	double eyeHeight = 1.65;        // above feet; camera placement only
	double bodyHeight = 1.75;
	double radius = 0.25;           // nominal body radius r
	double maxStepUp = 0.20;        // highest climbable rise
	double maxStepDown = 0.20;      // deepest descent per step
	double floorSnap = 0.10;        // footprint samples must lie within +/- this of the feet height
	double maxSlopeRadians = 35.0 * 3.14159265358979323846 / 180.0;
	double maxSubstep = 0.25;       // d, must be <= radius
	double footRingRadius = 0.12;   // footprint sample ring (proposal, not approved)
	int footRingSamples = 8;
	int minRingSupported = 4;       // sampling policy, not an area guarantee
	double crouchBodyHeight = 1.20; // body height while crouched (hold C)
	double crouchEyeHeight = 1.05;  // eye above feet while crouched; camera placement only
	double jumpUp = 0.70;           // highest surface a jump/climb can land on
	double jumpDown = 1.20;         // deepest drop a jump can land on
	double jumpReach = 0.80;        // farthest horizontal landing distance of a jump
};

/** @brief Triangle range [first, first+count) of one source geometry item (shell or mesh). */
struct ComponentRange
{
	std::size_t first = 0;
	std::size_t count = 0;
};

/** @brief Memory/size budget checked before the broad-phase grid is allocated.
 * Experimental limits (plan §8.5), not measured values.
 */
struct WalkBudget
{
	std::size_t maxTriangles = 2000000;
	std::size_t maxGridRefs = 16000000;
	std::size_t maxCells = 4000000;
	std::size_t maxOversize = 20000;
	std::size_t maxBytes = 256u * 1024u * 1024u;
	double cellSize = 1.0;            // meters
	std::size_t oversizeCellLimit = 64; // triangles covering more cells go to the oversize list
};

enum class GeometryStatus
{
	Ok,
	InvalidProfile,
	NonFinite,
	TooLarge
};

/** @brief Body posture: standing uses bodyHeight, crouched uses crouchBodyHeight. */
enum class Stance
{
	Standing,
	Crouched
};

enum class StepStatus
{
	Moved,        // reached the requested position
	Blocked,      // body would touch geometry, or rise exceeds maxStepUp
	NoSupport,    // no admissible support / footprint / consistent probe
	InvalidInput  // non-finite input, bad profile or no geometry
};

struct StepResult
{
	Vec3 feet;               // last safe feet position (unchanged on failure)
	StepStatus status = StepStatus::InvalidInput;
};

namespace detail
{
inline Vec3 Add(const Vec3& a, const Vec3& b) { return { a.x + b.x, a.y + b.y, a.z + b.z }; }
inline Vec3 Sub(const Vec3& a, const Vec3& b) { return { a.x - b.x, a.y - b.y, a.z - b.z }; }
inline Vec3 Mul(const Vec3& a, double s) { return { a.x * s, a.y * s, a.z * s }; }
inline double Dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 Cross(const Vec3& a, const Vec3& b)
{
	return { a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x };
}
inline bool IsFinite(const Vec3& v) { return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z); }
inline double Clamp01(double v) { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

// Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5).
inline Vec3 ClosestPointOnTriangle(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c)
{
	const Vec3 ab = Sub(b, a), ac = Sub(c, a), ap = Sub(p, a);
	const double d1 = Dot(ab, ap), d2 = Dot(ac, ap);
	if (d1 <= 0.0 && d2 <= 0.0)
		return a;
	const Vec3 bp = Sub(p, b);
	const double d3 = Dot(ab, bp), d4 = Dot(ac, bp);
	if (d3 >= 0.0 && d4 <= d3)
		return b;
	const double vc = d1 * d4 - d3 * d2;
	if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0)
		return Add(a, Mul(ab, d1 / (d1 - d3)));
	const Vec3 cp = Sub(p, c);
	const double d5 = Dot(ab, cp), d6 = Dot(ac, cp);
	if (d6 >= 0.0 && d5 <= d6)
		return c;
	const double vb = d5 * d2 - d1 * d6;
	if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0)
		return Add(a, Mul(ac, d2 / (d2 - d6)));
	const double va = d3 * d6 - d5 * d4;
	if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0)
		return Add(b, Mul(Sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
	const double denom = 1.0 / (va + vb + vc);
	return Add(a, Add(Mul(ab, vb * denom), Mul(ac, vc * denom)));
}

// Squared distance between segments p1q1 and p2q2 (Ericson 5.1.9).
inline double SegmentSegmentDistanceSq(const Vec3& p1, const Vec3& q1, const Vec3& p2, const Vec3& q2)
{
	constexpr double kEps = 1e-18;
	const Vec3 d1 = Sub(q1, p1), d2 = Sub(q2, p2), r = Sub(p1, p2);
	const double a = Dot(d1, d1), e = Dot(d2, d2), f = Dot(d2, r);
	double s = 0.0, t = 0.0;
	if (a <= kEps && e <= kEps)
		return Dot(r, r);
	if (a <= kEps)
	{
		t = Clamp01(f / e);
	}
	else
	{
		const double c = Dot(d1, r);
		if (e <= kEps)
		{
			s = Clamp01(-c / a);
		}
		else
		{
			const double b = Dot(d1, d2);
			const double denom = a * e - b * b;
			s = denom > kEps ? Clamp01((b * f - c * e) / denom) : 0.0;
			t = (b * s + f) / e;
			if (t < 0.0)
			{
				t = 0.0;
				s = Clamp01(-c / a);
			}
			else if (t > 1.0)
			{
				t = 1.0;
				s = Clamp01((b - c) / a);
			}
		}
	}
	const Vec3 diff = Sub(Add(p1, Mul(d1, s)), Add(p2, Mul(d2, t)));
	return Dot(diff, diff);
}

// Two-sided segment/triangle intersection parameter in [0,1] (Moller-Trumbore).
inline bool SegmentHitsTriangle(const Vec3& p0, const Vec3& p1, const Triangle& tri, double& outT)
{
	const Vec3 dir = Sub(p1, p0);
	const Vec3 e1 = Sub(tri.b, tri.a), e2 = Sub(tri.c, tri.a);
	const Vec3 pv = Cross(dir, e2);
	const double det = Dot(e1, pv);
	if (std::abs(det) < 1e-18)
		return false;
	const double inv = 1.0 / det;
	const Vec3 tv = Sub(p0, tri.a);
	const double u = Dot(tv, pv) * inv;
	if (u < 0.0 || u > 1.0)
		return false;
	const Vec3 qv = Cross(tv, e1);
	const double v = Dot(dir, qv) * inv;
	if (v < 0.0 || u + v > 1.0)
		return false;
	const double t = Dot(e2, qv) * inv;
	if (t < 0.0 || t > 1.0)
		return false;
	outT = t;
	return true;
}

// Exact squared distance between segment p0p1 and triangle tri.
inline double SegmentTriangleDistanceSq(const Vec3& p0, const Vec3& p1, const Triangle& tri)
{
	double t = 0.0;
	if (SegmentHitsTriangle(p0, p1, tri, t))
		return 0.0;
	const auto pointSq = [&tri](const Vec3& p) {
		const Vec3 d = Sub(p, ClosestPointOnTriangle(p, tri.a, tri.b, tri.c));
		return Dot(d, d);
	};
	double best = (std::min)(pointSq(p0), pointSq(p1));
	best = (std::min)(best, SegmentSegmentDistanceSq(p0, p1, tri.a, tri.b));
	best = (std::min)(best, SegmentSegmentDistanceSq(p0, p1, tri.b, tri.c));
	best = (std::min)(best, SegmentSegmentDistanceSq(p0, p1, tri.c, tri.a));
	return best;
}
}

/** @brief Kinematic grounded-walk controller over a static two-sided triangle set.
 *
 * Body: upright capsule of nominal radius r around a vertical core segment that
 * starts above the step zone (feet + maxStepUp + Rmax) and ends at
 * feet + bodyHeight - r. Obstacles below that core bottom are terrain handled by
 * the support probe, not by the body test.
 *
 * Swept coverage (plan §7.3): every straight leg is split into n samples with
 * spacing s <= maxSubstep, both ends included, and each sample core is tested
 * against the fixed radius Rmax = sqrt(r^2 + maxSubstep^2/4) >= sqrt(r^2 + s^2/4).
 * For a constant-shape translation this covers the whole radius-r swept volume, so
 * a touch between samples cannot be missed. Using Rmax for every test (not the
 * spacing of the current leg) keeps every accepted position at least Rmax from
 * geometry, so a body stopped at contact can always move away or along and the
 * answer does not depend on the step length (runtime finding 2026-10-05). It does NOT detect a body wholly inside a closed solid; that can only
 * arise at spawn or with missing geometry (see Spawn).
 *
 * Step limits: rises up to maxStepUp and drops up to maxStepDown are accepted with
 * kHeightTolerance (1 mm) so a riser of exactly the limit is not lost to rounding.
 * Jump uses the wider jumpUp/jumpDown limits for one landing within jumpReach, with
 * the same swept body test over the whole lift / advance / settle path.
 *
 * Stance: a crouched body only lowers the core top (crouchBodyHeight - r); the step
 * zone, radius and support rules are unchanged.
 *
 * Pass-through: components switched off with SetPassThrough are skipped by every
 * body, support and ray query except PickComponent; they stay in Triangles().
 *
 * Support (plan §7.4/§7.5): vertical probes start inside the verified-free body,
 * so the first surface hit from above is a top surface or an open sheet. Slope
 * uses the unoriented geometric triangle normal. The footprint rule (center plus
 * minRingSupported of footRingSamples ring probes within +/- floorSnap) is a
 * sampling policy: holes between samples can be missed.
 *
 * Thread/ownership: plain value object, no globals, no SDK types.
 */
class GroundedWalkSolver
{
public:
	/** @brief Rounding allowance on the step-up/step-down limits, in meters. */
	static constexpr double kHeightTolerance = 1e-3;

	/** @brief Validates and stores the profile and copied triangles, then builds the XY grid.
	 * @param triangles Copied triangles in meters.
	 * @param profile Body/probe policy; validated.
	 * @param components Optional triangle ranges per source item (must tile the input in
	 * order); empty means one component. Ranges are re-based after skipping degenerates.
	 * @param budget Size/memory limits checked BEFORE the grid is allocated.
	 * @return Ok, InvalidProfile, NonFinite (any non-finite vertex or bad ranges), or
	 * TooLarge (any budget exceeded). On any failure the solver stays unusable.
	 * Zero-area triangles are skipped and counted, never silently trusted.
	 */
	GeometryStatus SetGeometry(std::vector<Triangle> triangles, const Profile& profile,
		const std::vector<ComponentRange>& components = {}, const WalkBudget& budget = WalkBudget{})
	{
		m_ready = false;
		m_triangles.clear();
		m_components.clear();
		m_cellStart.clear();
		m_cellRefs.clear();
		m_oversize.clear();
		m_passThroughComponent.clear();
		m_passThroughTriangle.clear();
		m_skippedDegenerate = 0;
		m_estimatedBytes = 0;
		if (!IsProfileValid(profile) || !(budget.cellSize > 0.0) || !std::isfinite(budget.cellSize))
			return GeometryStatus::InvalidProfile;
		if (triangles.size() > budget.maxTriangles)
			return GeometryStatus::TooLarge;

		std::vector<ComponentRange> ranges = components;
		if (ranges.empty())
			ranges.push_back({ 0, triangles.size() });
		std::size_t expected = 0;
		for (const ComponentRange& range : ranges)
		{
			if (range.first != expected)
				return GeometryStatus::NonFinite;
			expected += range.count;
		}
		if (expected != triangles.size())
			return GeometryStatus::NonFinite;

		m_triangles.reserve(triangles.size());
		for (const ComponentRange& range : ranges)
		{
			const std::size_t first = m_triangles.size();
			for (std::size_t i = range.first; i < range.first + range.count; ++i)
			{
				const Triangle& tri = triangles[i];
				if (!detail::IsFinite(tri.a) || !detail::IsFinite(tri.b) || !detail::IsFinite(tri.c))
				{
					m_triangles.clear();
					return GeometryStatus::NonFinite;
				}
				const Vec3 n = detail::Cross(detail::Sub(tri.b, tri.a), detail::Sub(tri.c, tri.a));
				if (detail::Dot(n, n) < 1e-24)
				{
					++m_skippedDegenerate;
					continue;
				}
				m_triangles.push_back(tri);
			}
			if (m_triangles.size() > first)
				m_components.push_back({ first, m_triangles.size() - first });
		}
		if (!BuildGrid(budget))
		{
			m_triangles.clear();
			m_components.clear();
			return GeometryStatus::TooLarge;
		}
		m_profile = profile;
		m_rMax = std::sqrt(profile.radius * profile.radius + profile.maxSubstep * profile.maxSubstep / 4.0);
		m_coreBottom = profile.maxStepUp + m_rMax;
		m_coreTop = profile.bodyHeight - profile.radius;
		m_crouchCoreTop = profile.crouchBodyHeight - profile.radius;
		m_ready = true;
		return GeometryStatus::Ok;
	}

	/** @brief Profile accepted by the last successful SetGeometry. */
	const Profile& GetProfile() const { return m_profile; }
	/** @brief Stored (degenerate-free) triangles, in meters. */
	const std::vector<Triangle>& Triangles() const { return m_triangles; }
	/** @brief Component ranges into Triangles(), re-based after degenerate removal. */
	const std::vector<ComponentRange>& Components() const { return m_components; }
	/** @brief Size estimate of triangles + grid computed before allocation, in bytes. */
	std::size_t EstimatedBytes() const { return m_estimatedBytes; }
	/** @brief Triangles kept out of the grid because they span too many cells. */
	std::size_t OversizeCount() const { return m_oversize.size(); }

	/** @brief Number of zero-area input triangles ignored by SetGeometry. */
	std::size_t SkippedDegenerateCount() const { return m_skippedDegenerate; }

	/** @brief Places the body at a picked support point.
	 * @param feet Picked point on a walkable surface (meters).
	 * @return Moved with feet snapped to the support height, Blocked when the body
	 * touches geometry, NoSupport when the footprint/probe rules fail.
	 * @note Known limitation: a body wholly inside a closed solid (no surface within
	 * reach) is not detected; the integration must pick from a free camera ray.
	 */
	StepResult Spawn(const Vec3& feet) const
	{
		if (!m_ready || !detail::IsFinite(feet))
			return { feet, StepStatus::InvalidInput };
		double supportZ = 0.0;
		if (!ProbeSupport(feet.x, feet.y, feet.z + m_coreBottom, feet.z - m_profile.floorSnap, supportZ))
			return { feet, StepStatus::NoSupport };
		const Vec3 placed{ feet.x, feet.y, supportZ };
		if (!IsBodyPathClear(placed, placed))
			return { feet, StepStatus::Blocked };
		if (!IsFootprintSupported(placed))
			return { feet, StepStatus::NoSupport };
		return { placed, StepStatus::Moved };
	}

	/** @brief Moves the feet horizontally by (dx, dy) meters with step/support rules.
	 * @return Moved at the target, or the last safe feet with Blocked/NoSupport.
	 * Each substep: probe destination support, then lift (rise > 0), advance and
	 * settle (rise < 0) legs, each swept with the full body; then footprint and a
	 * consistency re-probe from the verified-free final body.
	 */
	StepResult Move(const Vec3& feet, double dx, double dy, Stance stance = Stance::Standing) const
	{
		if (!m_ready || !detail::IsFinite(feet) || !std::isfinite(dx) || !std::isfinite(dy))
			return { feet, StepStatus::InvalidInput };
		const double length = std::hypot(dx, dy);
		if (!std::isfinite(length))
			return { feet, StepStatus::InvalidInput };
		if (length == 0.0)
			return { feet, StepStatus::Moved };
		const int count = static_cast<int>(std::ceil(length / m_profile.maxSubstep));
		const double stepX = dx / count;
		const double stepY = dy / count;
		Vec3 current = feet;
		for (int i = 0; i < count; ++i)
		{
			const StepStatus status = TryStep(current, stepX, stepY, stance);
			if (status != StepStatus::Moved)
				return { current, status };
		}
		return { current, StepStatus::Moved };
	}

	/** @brief True when the body swept along the straight leg from -> to touches nothing.
	 * Exposed for coverage tests; uses the inflated radius described above.
	 */
	bool IsBodyPathClear(const Vec3& from, const Vec3& to, Stance stance = Stance::Standing) const
	{
		if (!m_ready)
			return false;
		const Vec3 delta = detail::Sub(to, from);
		const double length = std::sqrt(detail::Dot(delta, delta));
		const int count = length > 0.0 ? static_cast<int>(std::ceil(length / m_profile.maxSubstep)) : 0;
		const double inflated = m_rMax;
		const double inflatedSq = inflated * inflated;

		// Cull triangles outside the swept core bounds grown by the inflated radius.
		const double minX = (std::min)(from.x, to.x) - inflated, maxX = (std::max)(from.x, to.x) + inflated;
		const double minY = (std::min)(from.y, to.y) - inflated, maxY = (std::max)(from.y, to.y) + inflated;
		const double minZ = (std::min)(from.z, to.z) + m_coreBottom - inflated;
		const double coreTop = CoreTop(stance);
		const double maxZ = (std::max)(from.z, to.z) + coreTop + inflated;
		return ForEachCandidate(minX, maxX, minY, maxY, [&](const Triangle& tri) {
			if ((std::max)({ tri.a.x, tri.b.x, tri.c.x }) < minX || (std::min)({ tri.a.x, tri.b.x, tri.c.x }) > maxX
				|| (std::max)({ tri.a.y, tri.b.y, tri.c.y }) < minY || (std::min)({ tri.a.y, tri.b.y, tri.c.y }) > maxY
				|| (std::max)({ tri.a.z, tri.b.z, tri.c.z }) < minZ || (std::min)({ tri.a.z, tri.b.z, tri.c.z }) > maxZ)
				return true;
			for (int k = 0; k <= count; ++k)
			{
				const double t = count > 0 ? static_cast<double>(k) / count : 0.0;
				const Vec3 at = detail::Add(from, detail::Mul(delta, t));
				const Vec3 bottom{ at.x, at.y, at.z + m_coreBottom };
				const Vec3 top{ at.x, at.y, at.z + coreTop };
				if (detail::SegmentTriangleDistanceSq(bottom, top, tri) < inflatedSq)
					return false;
			}
			return true;
		});
	}

	/** @brief Nearest hit of the segment origin + t*dir, t in [0, maxDistance], with any triangle.
	 * @param dir Need not be unit length; distances are measured along normalized dir.
	 * @return True and outDistance (meters) when hit; false for no hit or invalid input.
	 * @note Nearest hit only; the entry-time cross-check uses RayCrossings because the
	 * engine ray trace drops near-plane crossings.
	 */
	bool RayFirstHit(const Vec3& origin, const Vec3& dir, double maxDistance, double& outDistance) const
	{
		const double len = std::sqrt(detail::Dot(dir, dir));
		if (!m_ready || !detail::IsFinite(origin) || !(len > 0.0) || !(maxDistance > 0.0) || !std::isfinite(maxDistance))
			return false;
		const Vec3 end = detail::Add(origin, detail::Mul(dir, maxDistance / len));
		double bestT = 2.0;
		ForEachCandidate((std::min)(origin.x, end.x), (std::max)(origin.x, end.x), (std::min)(origin.y, end.y),
			(std::max)(origin.y, end.y), [&](const Triangle& tri) {
				double t = 0.0;
				if (detail::SegmentHitsTriangle(origin, end, tri, t) && t < bestT)
					bestT = t;
				return true;
			});
		if (bestT > 1.0)
			return false;
		outDistance = bestT * maxDistance;
		return true;
	}

	/** @brief Jumps or climbs forward to the farthest admissible landing within jumpReach.
	 * @param dirX, dirY Horizontal jump direction (need not be unit length).
	 * @return Moved at the landing; otherwise the unchanged feet with Blocked (a landing
	 * exists but the body path or height limit fails) or NoSupport (no landing at all).
	 * Landings are probed every 5 cm from jumpReach down to 5 cm; each needs a rise of at
	 * most jumpUp and a drop of at most jumpDown (plus kHeightTolerance), a clear swept
	 * path lift -> advance -> settle at apex feet + jumpUp (or, under a low ceiling, at
	 * the landing height), the footprint and a consistent re-probe. No free fall.
	 */
	StepResult Jump(const Vec3& feet, double dirX, double dirY, Stance stance = Stance::Standing) const
	{
		const double len = std::hypot(dirX, dirY);
		if (!m_ready || !detail::IsFinite(feet) || !std::isfinite(len) || !(len > 0.0))
			return { feet, StepStatus::InvalidInput };
		const double ux = dirX / len;
		const double uy = dirY / len;
		const int count = (std::max)(1, static_cast<int>(std::ceil(m_profile.jumpReach / kJumpProbeSpacing)));
		bool sawBlocked = false;
		for (int i = count; i >= 1; --i)
		{
			const double d = m_profile.jumpReach * i / count;
			const double targetX = feet.x + ux * d;
			const double targetY = feet.y + uy * d;
			double supportZ = 0.0;
			if (!ProbeSupport(targetX, targetY, feet.z + m_profile.jumpUp + m_coreBottom,
					feet.z - m_profile.jumpDown - kHeightTolerance, supportZ))
				continue;
			const double rise = supportZ - feet.z;
			if (rise > m_profile.jumpUp + kHeightTolerance)
			{
				sawBlocked = true;
				continue;
			}
			const double apexes[] = { m_profile.jumpUp, (std::max)(rise, 0.0) };
			for (int a = 0; a < 2; ++a)
			{
				if (a == 1 && apexes[1] >= apexes[0])
					break;
				const double apexZ = feet.z + apexes[a];
				const Vec3 lifted{ feet.x, feet.y, apexZ };
				const Vec3 advanced{ targetX, targetY, apexZ };
				const Vec3 settled{ targetX, targetY, supportZ };
				if (!IsBodyPathClear(feet, lifted, stance) || !IsBodyPathClear(lifted, advanced, stance)
					|| (apexZ > supportZ && !IsBodyPathClear(advanced, settled, stance)))
				{
					sawBlocked = true;
					continue;
				}
				if (!IsFootprintSupported(settled))
					break;
				double confirmedZ = 0.0;
				if (!ProbeSupport(targetX, targetY, supportZ + m_coreBottom, supportZ - m_profile.floorSnap, confirmedZ)
					|| std::abs(confirmedZ - supportZ) > 1e-9)
					break;
				return { settled, StepStatus::Moved };
			}
		}
		return { feet, sawBlocked ? StepStatus::Blocked : StepStatus::NoSupport };
	}

	/** @brief First component hit by the segment origin + t*dir, t in [0, maxDistance].
	 * @return True with outComponent (index into Components()) on a hit. Pass-through
	 * components are included, so the same object can be picked again to restore it.
	 */
	bool PickComponent(const Vec3& origin, const Vec3& dir, double maxDistance, std::size_t& outComponent) const
	{
		const double len = std::sqrt(detail::Dot(dir, dir));
		if (!m_ready || !detail::IsFinite(origin) || !(len > 0.0) || !(maxDistance > 0.0) || !std::isfinite(maxDistance))
			return false;
		const Vec3 end = detail::Add(origin, detail::Mul(dir, maxDistance / len));
		double bestT = 2.0;
		std::size_t bestIndex = 0;
		ForEachCandidate((std::min)(origin.x, end.x), (std::max)(origin.x, end.x), (std::min)(origin.y, end.y),
			(std::max)(origin.y, end.y), [&](const Triangle& tri) {
				double t = 0.0;
				if (detail::SegmentHitsTriangle(origin, end, tri, t) && t < bestT)
				{
					bestT = t;
					bestIndex = static_cast<std::size_t>(&tri - m_triangles.data());
				}
				return true;
			}, false);
		if (bestT > 1.0)
			return false;
		outComponent = ComponentOfTriangle(bestIndex);
		return outComponent < m_components.size();
	}

	/** @brief Switches collision of a component off (passThrough) or back on, together
	 * with every component whose bounds lie inside its bounds grown by 5 cm (e.g. a door
	 * leaf and its handle; the surrounding frame and walls are not inside and keep blocking).
	 * @return Number of components switched (0 for an invalid index).
	 * @note Session state of this solver only; the copied triangles are not changed.
	 */
	std::size_t SetPassThrough(std::size_t component, bool passThrough)
	{
		if (!m_ready || component >= m_components.size())
			return 0;
		std::vector<Vec3> lo(m_components.size(), Vec3{ 1e300, 1e300, 1e300 });
		std::vector<Vec3> hi(m_components.size(), Vec3{ -1e300, -1e300, -1e300 });
		for (std::size_t c = 0; c < m_components.size(); ++c)
		{
			for (std::size_t i = m_components[c].first; i < m_components[c].first + m_components[c].count; ++i)
			{
				for (const Vec3* v : { &m_triangles[i].a, &m_triangles[i].b, &m_triangles[i].c })
				{
					lo[c] = { (std::min)(lo[c].x, v->x), (std::min)(lo[c].y, v->y), (std::min)(lo[c].z, v->z) };
					hi[c] = { (std::max)(hi[c].x, v->x), (std::max)(hi[c].y, v->y), (std::max)(hi[c].z, v->z) };
				}
			}
		}
		const Vec3 boxLo{ lo[component].x - kPassThroughMargin, lo[component].y - kPassThroughMargin, lo[component].z - kPassThroughMargin };
		const Vec3 boxHi{ hi[component].x + kPassThroughMargin, hi[component].y + kPassThroughMargin, hi[component].z + kPassThroughMargin };
		if (m_passThroughComponent.size() != m_components.size())
			m_passThroughComponent.assign(m_components.size(), 0);
		if (m_passThroughTriangle.size() != m_triangles.size())
			m_passThroughTriangle.assign(m_triangles.size(), 0);
		std::size_t switched = 0;
		for (std::size_t c = 0; c < m_components.size(); ++c)
		{
			if (lo[c].x < boxLo.x || lo[c].y < boxLo.y || lo[c].z < boxLo.z || hi[c].x > boxHi.x || hi[c].y > boxHi.y || hi[c].z > boxHi.z)
				continue;
			m_passThroughComponent[c] = passThrough ? 1 : 0;
			for (std::size_t i = m_components[c].first; i < m_components[c].first + m_components[c].count; ++i)
				m_passThroughTriangle[i] = passThrough ? 1 : 0;
			++switched;
		}
		return switched;
	}

	/** @brief True when the component's collision is switched off by SetPassThrough. */
	bool IsPassThrough(std::size_t component) const
	{
		return component < m_passThroughComponent.size() && m_passThroughComponent[component] != 0;
	}

	/** @brief Every crossing of the segment origin + t*dir, t in [0, maxDistance], with any triangle.
	 * @param dir Need not be unit length; distances are measured along normalized dir.
	 * @return Sorted distances in meters (a crossing on a shared edge may appear twice);
	 * empty for no hit or invalid input.
	 * @note Used for the entry-time cross-check against the engine ray trace, which drops
	 * crossings in front of the view's near clip plane (see CompareRayCrossings).
	 */
	std::vector<double> RayCrossings(const Vec3& origin, const Vec3& dir, double maxDistance) const
	{
		std::vector<double> crossings;
		const double len = std::sqrt(detail::Dot(dir, dir));
		if (!m_ready || !detail::IsFinite(origin) || !(len > 0.0) || !(maxDistance > 0.0) || !std::isfinite(maxDistance))
			return crossings;
		const Vec3 end = detail::Add(origin, detail::Mul(dir, maxDistance / len));
		ForEachCandidate((std::min)(origin.x, end.x), (std::max)(origin.x, end.x), (std::min)(origin.y, end.y),
			(std::max)(origin.y, end.y), [&](const Triangle& tri) {
				double t = 0.0;
				if (detail::SegmentHitsTriangle(origin, end, tri, t))
					crossings.push_back(t * maxDistance);
				return true;
			});
		std::sort(crossings.begin(), crossings.end());
		return crossings;
	}

	/** @brief Probes downward from (x, y, originZ) to minZ for the nearest walkable surface.
	 * @return False when nothing is hit or the first hit is steeper than maxSlope.
	 */
	bool ProbeSupport(double x, double y, double originZ, double minZ, double& outZ) const
	{
		if (!m_ready)
			return false;
		const Vec3 p0{ x, y, originZ };
		const Vec3 p1{ x, y, minZ };
		double bestT = 2.0;
		const Triangle* best = nullptr;
		ForEachCandidate(x, x, y, y, [&](const Triangle& tri) {
			double t = 0.0;
			if (detail::SegmentHitsTriangle(p0, p1, tri, t) && t < bestT)
			{
				bestT = t;
				best = &tri;
			}
			return true;
		});
		if (best == nullptr)
			return false;
		const Vec3 n = detail::Cross(detail::Sub(best->b, best->a), detail::Sub(best->c, best->a));
		const double cosSlope = std::abs(n.z) / std::sqrt(detail::Dot(n, n));
		if (cosSlope < std::cos(m_profile.maxSlopeRadians))
			return false;
		outZ = originZ + (minZ - originZ) * bestT;
		return true;
	}

	/** @brief Footprint policy at feet: center plus minRingSupported ring probes within +/- floorSnap.
	 * Sampling policy only; holes between samples can be missed.
	 */
	bool IsFootprintSupported(const Vec3& feet) const
	{
		if (!m_ready)
			return false;
		const double originZ = feet.z + m_coreBottom;
		const double low = feet.z - m_profile.floorSnap;
		const double high = feet.z + m_profile.floorSnap;
		double z = 0.0;
		if (!ProbeSupport(feet.x, feet.y, originZ, low, z) || z > high)
			return false;
		int supported = 0;
		for (int i = 0; i < m_profile.footRingSamples; ++i)
		{
			const double angle = 2.0 * 3.14159265358979323846 * i / m_profile.footRingSamples;
			const double sx = feet.x + m_profile.footRingRadius * std::cos(angle);
			const double sy = feet.y + m_profile.footRingRadius * std::sin(angle);
			if (ProbeSupport(sx, sy, originZ, low, z) && z <= high)
				++supported;
		}
		return supported >= m_profile.minRingSupported;
	}

private:
	static bool IsProfileValid(const Profile& p)
	{
		const double values[] = { p.eyeHeight, p.bodyHeight, p.radius, p.maxStepUp, p.maxStepDown,
			p.floorSnap, p.maxSlopeRadians, p.maxSubstep, p.footRingRadius };
		for (double v : values)
		{
			if (!std::isfinite(v) || v <= 0.0)
				return false;
		}
		if (p.maxSubstep > p.radius || p.footRingRadius >= p.radius || p.eyeHeight > p.bodyHeight
			|| p.maxSlopeRadians >= 1.5707963267948966 || p.footRingSamples < 1
			|| p.minRingSupported < 0 || p.minRingSupported > p.footRingSamples)
			return false;
		const double moves[] = { p.crouchBodyHeight, p.crouchEyeHeight, p.jumpUp, p.jumpDown, p.jumpReach };
		for (double v : moves)
		{
			if (!std::isfinite(v) || v <= 0.0)
				return false;
		}
		if (p.crouchBodyHeight > p.bodyHeight || p.crouchEyeHeight > p.crouchBodyHeight
			|| p.jumpUp < p.maxStepUp || p.jumpDown < p.maxStepDown)
			return false;
		const double rMax = std::sqrt(p.radius * p.radius + p.maxSubstep * p.maxSubstep / 4.0);
		// Core must have positive length above the step zone, standing and crouched.
		return p.crouchBodyHeight - p.radius > p.maxStepUp + rMax;
	}

	// Uniform XY grid in CSR form. Triangles whose XY bounds cover more than
	// oversizeCellLimit cells go to m_oversize and are visited by every query
	// instead of being replicated into each cell. Every budget is checked from
	// counts computed before anything large is allocated.
	bool BuildGrid(const WalkBudget& budget)
	{
		const std::size_t triBytes = m_triangles.size() * sizeof(Triangle);
		m_cell = budget.cellSize;
		m_nx = 0;
		m_ny = 0;
		if (m_triangles.empty())
		{
			m_estimatedBytes = 0;
			return true;
		}
		double minX = 1e300, minY = 1e300, maxX = -1e300, maxY = -1e300;
		for (const Triangle& t : m_triangles)
		{
			minX = (std::min)({ minX, t.a.x, t.b.x, t.c.x });
			maxX = (std::max)({ maxX, t.a.x, t.b.x, t.c.x });
			minY = (std::min)({ minY, t.a.y, t.b.y, t.c.y });
			maxY = (std::max)({ maxY, t.a.y, t.b.y, t.c.y });
		}
		const double cellsX = std::floor((maxX - minX) / m_cell) + 1.0;
		const double cellsY = std::floor((maxY - minY) / m_cell) + 1.0;
		if (!(cellsX * cellsY <= static_cast<double>(budget.maxCells)))
			return false;
		m_minX = minX;
		m_minY = minY;
		m_nx = static_cast<std::size_t>(cellsX);
		m_ny = static_cast<std::size_t>(cellsY);

		std::size_t refs = 0;
		std::size_t oversize = 0;
		for (const Triangle& t : m_triangles)
		{
			std::size_t x0, x1, y0, y1;
			CellRange(t, x0, x1, y0, y1);
			const std::size_t cover = (x1 - x0 + 1) * (y1 - y0 + 1);
			if (cover > budget.oversizeCellLimit)
				++oversize;
			else
				refs += cover;
		}
		const std::size_t cells = m_nx * m_ny;
		m_estimatedBytes = triBytes + refs * sizeof(std::uint32_t) + (cells + 1) * sizeof(std::uint32_t)
			+ oversize * sizeof(std::uint32_t) + m_triangles.size() * sizeof(std::uint32_t);
		if (refs > budget.maxGridRefs || oversize > budget.maxOversize || m_estimatedBytes > budget.maxBytes
			|| m_triangles.size() > 0xFFFFFFFFu || refs > 0xFFFFFFFFu)
			return false;

		m_cellStart.assign(cells + 1, 0);
		for (const Triangle& t : m_triangles)
		{
			std::size_t x0, x1, y0, y1;
			CellRange(t, x0, x1, y0, y1);
			if ((x1 - x0 + 1) * (y1 - y0 + 1) > budget.oversizeCellLimit)
				continue;
			for (std::size_t y = y0; y <= y1; ++y)
				for (std::size_t x = x0; x <= x1; ++x)
					++m_cellStart[y * m_nx + x + 1];
		}
		for (std::size_t i = 0; i < cells; ++i)
			m_cellStart[i + 1] += m_cellStart[i];
		m_cellRefs.assign(refs, 0);
		std::vector<std::uint32_t> fill(m_cellStart.begin(), m_cellStart.end() - 1);
		for (std::size_t i = 0; i < m_triangles.size(); ++i)
		{
			std::size_t x0, x1, y0, y1;
			CellRange(m_triangles[i], x0, x1, y0, y1);
			if ((x1 - x0 + 1) * (y1 - y0 + 1) > budget.oversizeCellLimit)
			{
				m_oversize.push_back(static_cast<std::uint32_t>(i));
				continue;
			}
			for (std::size_t y = y0; y <= y1; ++y)
				for (std::size_t x = x0; x <= x1; ++x)
					m_cellRefs[fill[y * m_nx + x]++] = static_cast<std::uint32_t>(i);
		}
		m_visitStamp.assign(m_triangles.size(), 0);
		m_stamp = 0;
		return true;
	}

	std::size_t CellIndex(double value, double origin, std::size_t count) const
	{
		const double c = std::floor((value - origin) / m_cell);
		if (!(c > 0.0))
			return 0;
		return (std::min)(static_cast<std::size_t>(c), count - 1);
	}

	void CellRange(const Triangle& t, std::size_t& x0, std::size_t& x1, std::size_t& y0, std::size_t& y1) const
	{
		x0 = CellIndex((std::min)({ t.a.x, t.b.x, t.c.x }), m_minX, m_nx);
		x1 = CellIndex((std::max)({ t.a.x, t.b.x, t.c.x }), m_minX, m_nx);
		y0 = CellIndex((std::min)({ t.a.y, t.b.y, t.c.y }), m_minY, m_ny);
		y1 = CellIndex((std::max)({ t.a.y, t.b.y, t.c.y }), m_minY, m_ny);
	}

	// Calls visit(triangle) once per candidate whose grid cells overlap the XY box,
	// plus every oversize triangle. visit returns false to stop; the function then
	// returns false. Not thread-safe (visit stamps); UI thread use only.
	template <class Visit>
	bool ForEachCandidate(double minX, double maxX, double minY, double maxY, Visit visit, bool skipPassThrough = true) const
	{
		if (m_triangles.empty())
			return true;
		const bool skip = skipPassThrough && !m_passThroughTriangle.empty();
		for (std::uint32_t index : m_oversize)
		{
			if (skip && m_passThroughTriangle[index] != 0)
				continue;
			if (!visit(m_triangles[index]))
				return false;
		}
		if (m_nx == 0 || m_ny == 0)
			return true;
		const double gridMaxX = m_minX + m_cell * static_cast<double>(m_nx);
		const double gridMaxY = m_minY + m_cell * static_cast<double>(m_ny);
		if (maxX < m_minX || minX > gridMaxX || maxY < m_minY || minY > gridMaxY)
			return true;
		if (++m_stamp == 0)
		{
			std::fill(m_visitStamp.begin(), m_visitStamp.end(), 0u);
			m_stamp = 1;
		}
		const std::size_t x0 = CellIndex(minX, m_minX, m_nx), x1 = CellIndex(maxX, m_minX, m_nx);
		const std::size_t y0 = CellIndex(minY, m_minY, m_ny), y1 = CellIndex(maxY, m_minY, m_ny);
		for (std::size_t y = y0; y <= y1; ++y)
		{
			for (std::size_t x = x0; x <= x1; ++x)
			{
				const std::size_t cell = y * m_nx + x;
				for (std::uint32_t r = m_cellStart[cell]; r < m_cellStart[cell + 1]; ++r)
				{
					const std::uint32_t index = m_cellRefs[r];
					if (m_visitStamp[index] == m_stamp)
						continue;
					m_visitStamp[index] = m_stamp;
					if (skip && m_passThroughTriangle[index] != 0)
						continue;
					if (!visit(m_triangles[index]))
						return false;
				}
			}
		}
		return true;
	}

	double CoreTop(Stance stance) const
	{
		return stance == Stance::Crouched ? m_crouchCoreTop : m_coreTop;
	}

	std::size_t ComponentOfTriangle(std::size_t triangle) const
	{
		const auto it = std::upper_bound(m_components.begin(), m_components.end(), triangle,
			[](std::size_t value, const ComponentRange& range) { return value < range.first; });
		if (it == m_components.begin())
			return m_components.size();
		const std::size_t c = static_cast<std::size_t>(it - m_components.begin()) - 1;
		return triangle < m_components[c].first + m_components[c].count ? c : m_components.size();
	}

	StepStatus TryStep(Vec3& feet, double stepX, double stepY, Stance stance) const
	{
		const double targetX = feet.x + stepX;
		const double targetY = feet.y + stepY;
		double supportZ = 0.0;
		if (!ProbeSupport(targetX, targetY, feet.z + m_coreBottom, feet.z - m_profile.maxStepDown - kHeightTolerance, supportZ))
			return StepStatus::NoSupport;
		const double rise = supportZ - feet.z;
		if (rise > m_profile.maxStepUp + kHeightTolerance)
			return StepStatus::Blocked;

		const double travelZ = feet.z + (std::max)(rise, 0.0);
		const Vec3 lifted{ feet.x, feet.y, travelZ };
		const Vec3 advanced{ targetX, targetY, travelZ };
		const Vec3 settled{ targetX, targetY, supportZ };
		// The lift leg is kept explicit (plan §7.6) although, for rise below the core
		// length, its swept volume equals the union of the already verified start body
		// and the advance leg's first sample; tests cannot distinguish its removal.
		if (rise > 0.0 && !IsBodyPathClear(feet, lifted, stance))
			return StepStatus::Blocked;
		if (!IsBodyPathClear(lifted, advanced, stance))
			return StepStatus::Blocked;
		if (rise < 0.0 && !IsBodyPathClear(advanced, settled, stance))
			return StepStatus::Blocked;
		if (!IsFootprintSupported(settled))
			return StepStatus::NoSupport;

		// The first probe started from an unverified point; re-probe from the
		// now verified-free body and require the same support.
		double confirmedZ = 0.0;
		if (!ProbeSupport(targetX, targetY, supportZ + m_coreBottom, supportZ - m_profile.floorSnap, confirmedZ)
			|| std::abs(confirmedZ - supportZ) > 1e-9)
			return StepStatus::NoSupport;

		feet = settled;
		return StepStatus::Moved;
	}

	Profile m_profile;
	std::vector<Triangle> m_triangles;
	std::vector<ComponentRange> m_components;
	std::size_t m_skippedDegenerate = 0;
	std::size_t m_estimatedBytes = 0;
	double m_cell = 1.0;
	double m_minX = 0.0;
	double m_minY = 0.0;
	std::size_t m_nx = 0;
	std::size_t m_ny = 0;
	std::vector<std::uint32_t> m_cellStart;
	std::vector<std::uint32_t> m_cellRefs;
	std::vector<std::uint32_t> m_oversize;
	mutable std::vector<std::uint32_t> m_visitStamp;
	mutable std::uint32_t m_stamp = 0;
	double m_rMax = 0.0;
	double m_coreBottom = 0.0;
	double m_coreTop = 0.0;
	double m_crouchCoreTop = 0.0;
	std::vector<std::uint8_t> m_passThroughComponent;
	std::vector<std::uint8_t> m_passThroughTriangle;
	bool m_ready = false;
	static constexpr double kJumpProbeSpacing = 0.05;
	static constexpr double kPassThroughMargin = 0.05;
};

/** @brief One cross-check ray: our crossings, the engine's crossings (meters along the ray)
 * and the ray's depth per meter along the view direction (cosine to the view axis).
 */
struct RayCrossingSample
{
	std::vector<double> ours;
	std::vector<double> engine;
	double depthPerDistance = 1.0;
};

/** @brief Outcome of CompareRayCrossings, with counts for diagnostics. */
struct CrossCheckVerdict
{
	bool agree = false;
	std::size_t matchedSdk = 0;       // engine crossings matched by one of ours
	std::size_t unmatchedSdk = 0;     // engine crossings with no counterpart (geometry differs)
	double maxOursOnlyDepth = 0.0;    // deepest of our crossings the engine did not report
	double minSdkDepth = 0.0;         // shallowest engine crossing
};

/** @brief Compares copied geometry with an engine ray trace that clips at a near plane.
 * @return agree when every engine crossing within maxDistance matches one of ours within
 * 1 mm + 1e-6 d, at least one engine crossing exists, and every crossing only we report
 * lies in front of every engine crossing in view depth, i.e. all of them can be explained
 * by one near clip plane perpendicular to the view axis.
 * @note Crossings within the tolerance of maxDistance are ignored on both sides. Geometry
 * in front of the near plane is not verified (runtime finding 2026-10-05).
 */
inline CrossCheckVerdict CompareRayCrossings(const std::vector<RayCrossingSample>& rays, double maxDistance)
{
	CrossCheckVerdict verdict;
	const auto tolerance = [](double d) { return 1e-3 + 1e-6 * d; };
	const auto has = [&tolerance](const std::vector<double>& list, double d) {
		for (double x : list)
		{
			if (std::abs(x - d) <= tolerance(d))
				return true;
		}
		return false;
	};
	const double limit = maxDistance - tolerance(maxDistance);
	double maxOursOnly = -1.0;
	double minSdk = 1e300;
	for (const RayCrossingSample& ray : rays)
	{
		for (double d : ray.engine)
		{
			if (d > limit)
				continue;
			if (has(ray.ours, d))
				++verdict.matchedSdk;
			else
				++verdict.unmatchedSdk;
			minSdk = (std::min)(minSdk, d * ray.depthPerDistance);
		}
		for (double d : ray.ours)
		{
			if (d <= limit && !has(ray.engine, d))
				maxOursOnly = (std::max)(maxOursOnly, d * ray.depthPerDistance);
		}
	}
	verdict.maxOursOnlyDepth = maxOursOnly;
	verdict.minSdkDepth = minSdk;
	verdict.agree = verdict.matchedSdk > 0 && verdict.unmatchedSdk == 0 && maxOursOnly <= minSdk + tolerance(minSdk);
	return verdict;
}
}
}
