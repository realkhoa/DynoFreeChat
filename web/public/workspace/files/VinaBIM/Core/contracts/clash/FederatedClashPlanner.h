#pragma once

#include "Core/contracts/clash/FederatedClashModels.h"

#include <algorithm>
#include <cwctype>
#include <set>
#include <sstream>
#include <utility>

struct FederatedModelPair
{
  std::size_t indexA = 0;
  std::size_t indexB = 0;
};

struct FederatedValidationResult
{
  bool ok = true;
  std::string error;
};

namespace federated_clash_detail
{
// Builds a case-insensitive lexical comparison key for a Windows source path.
// The key collapses separators, ".", and resolvable ".." components while
// preserving whether the path is UNC, drive-rooted, current-drive-rooted,
// drive-relative, or relative. It performs no filesystem access.
inline std::wstring SourcePathComparisonKey(std::wstring path)
{
  std::replace(path.begin(), path.end(), L'/', L'\\');

  enum class RootKind
  {
    Relative,
    DriveRelative,
    CurrentDriveRooted,
    DriveRooted,
    Unc
  };

  RootKind rootKind = RootKind::Relative;
  std::wstring root;
  std::size_t componentStart = 0;
  std::size_t protectedComponents = 0;
  if (path.size() >= 2 && path[0] == L'\\' && path[1] == L'\\')
  {
    rootKind = RootKind::Unc;
    root = L"\\\\";
    componentStart = 2;
    protectedComponents = 2;
  }
  else if (path.size() >= 2 && path[1] == L':')
  {
    root = path.substr(0, 2);
    componentStart = 2;
    if (path.size() >= 3 && path[2] == L'\\')
    {
      rootKind = RootKind::DriveRooted;
      root += L'\\';
      componentStart = 3;
    }
    else
    {
      rootKind = RootKind::DriveRelative;
    }
  }
  else if (!path.empty() && path[0] == L'\\')
  {
    rootKind = RootKind::CurrentDriveRooted;
    root = L"\\";
    componentStart = 1;
  }

  std::vector<std::wstring> components;
  std::wstring component;
  const bool preserveLeadingParent = rootKind == RootKind::Relative ||
    rootKind == RootKind::DriveRelative;
  for (std::size_t i = componentStart; i <= path.size(); ++i)
  {
    const wchar_t ch = i < path.size() ? path[i] : L'\\';
    if (ch != L'\\')
    {
      component.push_back(ch);
      continue;
    }
    if (component == L"..")
    {
      if (components.size() > protectedComponents && components.back() != L"..")
        components.pop_back();
      else if (preserveLeadingParent)
        components.push_back(component);
    }
    else if (!component.empty() && component != L".")
    {
      components.push_back(component);
    }
    component.clear();
  }

  std::wstring normalized = root;
  for (const std::wstring& part : components)
  {
    const bool needsSeparator = !normalized.empty() && normalized.back() != L'\\' &&
      !(rootKind == RootKind::DriveRelative && normalized.size() == 2);
    if (needsSeparator)
      normalized += L'\\';
    normalized += part;
  }
  std::transform(normalized.begin(), normalized.end(), normalized.begin(),
    [](wchar_t value) { return static_cast<wchar_t>(std::towlower(value)); });
  return normalized;
}
} // namespace federated_clash_detail

inline FederatedValidationResult ValidateFederatedClashRequest(
  const FederatedClashRequest& request)
{
  FederatedValidationResult result;
  if (request.schemaVersion != 1)
  {
    result.ok = false;
    result.error = "Unsupported federated clash schema version";
    return result;
  }
  if (request.models.empty() || request.models.size() > 32)
  {
    result.ok = false;
    result.error = "Federated clash requires between 1 and 32 models";
    return result;
  }
  if (!std::isfinite(request.tolerance) || request.tolerance < 0.0)
  {
    result.ok = false;
    result.error = "Tolerance must be finite and non-negative";
    return result;
  }

  std::set<std::string> modelIds;
  std::set<std::wstring> paths;
  for (const FederatedModelInput& model : request.models)
  {
    if (model.sourceModelId.empty() || !modelIds.insert(model.sourceModelId).second)
    {
      result.ok = false;
      result.error = "Model IDs must be non-empty and unique";
      return result;
    }
    if (model.sourcePath.empty())
    {
      result.ok = false;
      result.error = "Every federated model must have a source path";
      return result;
    }
    const std::wstring normalized =
      federated_clash_detail::SourcePathComparisonKey(model.sourcePath);
    if (!paths.insert(normalized).second)
    {
      result.ok = false;
      result.error = "Federated models must not reference the same source path twice";
      return result;
    }
    if (!HasValidCoordinateMetadata(model.coordinates))
    {
      result.ok = false;
      result.error = "Every federated model needs complete coordinate metadata";
      return result;
    }
  }

  if (request.comparisonMode == FederatedComparisonMode::SelectionAB)
  {
    bool hasA = false;
    bool hasB = false;
    for (const FederatedModelInput& model : request.models)
    {
      hasA = hasA || model.side == FederatedComparisonSide::A || model.side == FederatedComparisonSide::Both;
      hasB = hasB || model.side == FederatedComparisonSide::B || model.side == FederatedComparisonSide::Both;
    }
    if (!hasA || !hasB)
    {
      result.ok = false;
      result.error = "Selection A vs B requires models on both sides";
    }
  }
  return result;
}

inline std::vector<FederatedModelPair> BuildFederatedModelPairs(
  const FederatedClashRequest& request)
{
  std::vector<FederatedModelPair> pairs;
  if (request.comparisonMode == FederatedComparisonMode::AllFiles)
  {
    for (std::size_t i = 0; i < request.models.size(); ++i)
      for (std::size_t j = i + 1; j < request.models.size(); ++j)
        pairs.push_back({ i, j });
    return pairs;
  }

  std::set<std::pair<std::size_t, std::size_t>> uniquePairs;
  for (std::size_t i = 0; i < request.models.size(); ++i)
  {
    const auto sideA = request.models[i].side == FederatedComparisonSide::A ||
      request.models[i].side == FederatedComparisonSide::Both;
    if (!sideA)
      continue;
    for (std::size_t j = 0; j < request.models.size(); ++j)
    {
      const auto sideB = request.models[j].side == FederatedComparisonSide::B ||
        request.models[j].side == FederatedComparisonSide::Both;
      if (!sideB || i == j)
        continue;
      const std::size_t first = std::min(i, j);
      const std::size_t second = std::max(i, j);
      if (uniquePairs.insert({ first, second }).second)
        pairs.push_back({ first, second });
    }
  }
  return pairs;
}

// Cheap preflight estimate used by the host to show workload before launching
// a worker. It never opens a source file, so it is safe to call from UI
// validation and to use for the soft warning thresholds.
inline std::size_t EstimateFederatedPairCount(const FederatedClashRequest& request)
{
  return BuildFederatedModelPairs(request).size();
}

inline std::string FederatedIdentityKey(const FederatedIdentity& identity)
{
  return identity.sourceModelId + "|" + identity.value;
}

inline std::string FederatedPairKey(
  const FederatedIdentity& a, const FederatedIdentity& b)
{
  std::string first = FederatedIdentityKey(a);
  std::string second = FederatedIdentityKey(b);
  if (second < first)
    std::swap(first, second);
  return first + "|" + second;
}
