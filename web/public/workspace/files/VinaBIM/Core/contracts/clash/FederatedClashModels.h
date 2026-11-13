#pragma once

#include <array>
#include <cstdint>
#include <cmath>
#include <string>
#include <vector>

// Engine-neutral federated clash DTOs.  Keep this contract free of MFC/ODA
// types so the host, worker client and future non-ODA adapters can share the
// same validation and pair-planning semantics.
enum class FederatedModelFormat
{
  Rvt,
  Ifc,
  Nwc,
  Nwd
};

enum class FederatedComparisonMode
{
  SelectionAB,
  AllFiles
};

enum class FederatedComparisonSide
{
  A,
  B,
  Both
};

enum class FederatedIdentityKind
{
  Persistent,
  HierarchyPath
};

enum class FederatedMetadataQuality
{
  Complete,
  Inferred,
  Missing
};

struct FederatedMatrix4x4
{
  std::array<double, 16> values{};

  static FederatedMatrix4x4 Identity()
  {
    FederatedMatrix4x4 result;
    result.values = { 1.0, 0.0, 0.0, 0.0,
                      0.0, 1.0, 0.0, 0.0,
                      0.0, 0.0, 1.0, 0.0,
                      0.0, 0.0, 0.0, 1.0 };
    return result;
  }
};

struct FederatedCoordinateMetadata
{
  std::string sourceUnit;
  double metersPerUnit = 0.0;
  std::string coordinateSystem;
  FederatedMatrix4x4 sourceToFederated = FederatedMatrix4x4::Identity();
  std::array<double, 3> origin{};
  bool hasSharedCoordinates = false;
  FederatedMetadataQuality metadataQuality = FederatedMetadataQuality::Missing;
};

// Returns the phase-one federated coordinate contract: every importer is
// placed into one metre-based scene with an identity source transform. Reader
// adapters remain responsible for exposing each model's ODA units matrix; the
// worker bakes that per-source conversion into this target transform. Callers
// do not read or persist sidecar metadata.
inline FederatedCoordinateMetadata MakeFederatedMetresIdentityMetadata()
{
  FederatedCoordinateMetadata metadata;
  metadata.sourceUnit = "metre";
  metadata.metersPerUnit = 1.0;
  metadata.coordinateSystem = "FEDERATED_METRES";
  metadata.sourceToFederated = FederatedMatrix4x4::Identity();
  metadata.origin = { 0.0, 0.0, 0.0 };
  metadata.hasSharedCoordinates = true;
  metadata.metadataQuality = FederatedMetadataQuality::Complete;
  return metadata;
}

struct FederatedModelInput
{
  std::string sourceModelId;
  std::wstring sourcePath;
  FederatedModelFormat format = FederatedModelFormat::Rvt;
  std::string displayName;
  FederatedComparisonSide side = FederatedComparisonSide::Both;
  FederatedCoordinateMetadata coordinates;
  std::string fileFingerprint;
  std::string readerVersion;
};

struct FederatedIdentity
{
  std::string sourceModelId;
  std::string value;
  FederatedIdentityKind kind = FederatedIdentityKind::Persistent;
  bool stable = true;
};

struct FederatedClashPair
{
  FederatedIdentity identityA;
  FederatedIdentity identityB;
  std::uint64_t nativeHandleA = 0;
  std::uint64_t nativeHandleB = 0;
  double distance = 0.0;
};

struct FederatedClashRequest
{
  int schemaVersion = 1;
  FederatedComparisonMode comparisonMode = FederatedComparisonMode::AllFiles;
  std::vector<FederatedModelInput> models;
  int engineCollisionType = 1;
  int collisionLevel = 0;
  double tolerance = 0.0;
  bool calculateDistance = true;
  bool allowExplicitSelfClash = false;
};

inline bool IsFiniteMatrix(const FederatedMatrix4x4& matrix)
{
  for (double value : matrix.values)
  {
    if (!std::isfinite(value))
      return false;
  }
  return true;
}

inline bool HasValidCoordinateMetadata(const FederatedCoordinateMetadata& metadata)
{
  if (metadata.metadataQuality == FederatedMetadataQuality::Missing ||
      !std::isfinite(metadata.metersPerUnit) || metadata.metersPerUnit <= 0.0 ||
      metadata.coordinateSystem.empty() || !IsFiniteMatrix(metadata.sourceToFederated))
    return false;

  // sourceToFederated is row-major affine transform.  Reject malformed
  // projective matrices and zero/sheared bases: silently accepting either can
  // produce plausible-looking but spatially incorrect clashes.
  const auto& m = metadata.sourceToFederated.values;
  constexpr double kEpsilon = 1.0e-12;
  if (std::abs(m[12]) > 1.0e-9 || std::abs(m[13]) > 1.0e-9 ||
      std::abs(m[14]) > 1.0e-9 || std::abs(m[15] - 1.0) > 1.0e-9)
    return false;
  const double c0x = m[0], c0y = m[4], c0z = m[8];
  const double c1x = m[1], c1y = m[5], c1z = m[9];
  const double c2x = m[2], c2y = m[6], c2z = m[10];
  const double n0 = std::sqrt(c0x*c0x + c0y*c0y + c0z*c0z);
  const double n1 = std::sqrt(c1x*c1x + c1y*c1y + c1z*c1z);
  const double n2 = std::sqrt(c2x*c2x + c2y*c2y + c2z*c2z);
  if (n0 <= kEpsilon || n1 <= kEpsilon || n2 <= kEpsilon)
    return false;
  const double d01 = (c0x*c1x + c0y*c1y + c0z*c1z) / (n0*n1);
  const double d02 = (c0x*c2x + c0y*c2y + c0z*c2z) / (n0*n2);
  const double d12 = (c1x*c2x + c1y*c2y + c1z*c2z) / (n1*n2);
  return std::abs(d01) <= 1.0e-6 && std::abs(d02) <= 1.0e-6 &&
    std::abs(d12) <= 1.0e-6 &&
    std::isfinite(metadata.origin[0]) && std::isfinite(metadata.origin[1]) &&
    std::isfinite(metadata.origin[2]);
}
