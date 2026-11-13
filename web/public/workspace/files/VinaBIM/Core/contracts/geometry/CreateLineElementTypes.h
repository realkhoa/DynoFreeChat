#pragma once

#include <cstdint>

enum class CreateLineElementStatus : int
{
	Ok = 0,
	NoDatabase,
	InvalidInput,
	OdaError
};

/** Host- and ODA-neutral input for a straight curve element on a sketch plane. */
struct CreateLineElementRequest
{
	std::uint64_t sketchPlaneHandle = 0;
	double startX = 0.0;
	double startY = 0.0;
	double startZ = 0.0;
	double endX = 0.0;
	double endY = 0.0;
	double endZ = 0.0;
};

struct CreateLineElementOutcome
{
	CreateLineElementStatus status = CreateLineElementStatus::OdaError;
	std::uint64_t newElementHandle = 0;
	int odResultCode = 0;
};
