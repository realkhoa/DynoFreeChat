#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace ManageLinks
{
enum class Kind { Rvt, Ifc, Cad, PointCloud, Pdf, Image };
enum class Reference { Linked, Imported, Unknown };
enum class RvtReferenceType { Attachment, Overlay };
enum class LoadState { Loaded, Unloaded, Requested, NotFound, Unknown };
enum class PathKind { Absolute, Relative, Unknown };

// Language-neutral messages. Only the host UI maps codes to localized resources.
enum class MessageCode
{
  None,
  HostUnavailable,
  SelectRvtSource,
  SourceMissing,
  ServicesUnavailable,
  SourceOpenFailed,
  SourceValidationFailed,
  SourceAlreadyLinked,
  AddFailed,
  LinkAdded,
  AddTrackingMissing,
  AddTrackingUnreadable,
  LinkUnavailable,
  LinkMissing,
  NotRvtLink,
  LoadAlreadySet,
  LoadFailed,
  LoadUpdated,
  LoadUnverified,
  LoadUnreadable,
  ResourceUnavailable,
  ResourceMissing,
  ResourceOpenFailed,
  ResourceInspectionFailed,
  RemovalUnsupported,
  DependencyInspectionFailed,
  RemoveFailed,
  ResourceRemoved,
  RemoveTrackingInconsistent,
  RemoveTrackingUnverified,
  SelectAbsoluteRvtPath,
  SaveHostFirst,
  DifferentRoots,
  PathAlreadySet,
  PathFailed,
  PathUpdated,
  PathMismatch,
  PathUnreadable,
  SourceUnresolved,
  ReloadFailed,
  LinkRefreshed,
  ReloadUnverified,
  ReloadUnreadable,
  RvtInstanceCountFailed,
  RvtTrackingReadFailed,
  RvtTrackingUnavailable,
  RvtOriginUnknown,
  RvtReferenceReadFailed,
  RvtResourceReadFailed,
  CadInstanceCountFailed,
  CadTrackingReadFailed,
  CadTrackingUnavailable,
  CadResourceReadFailed,
  PointCloudTrackingUnavailable,
  PointCloudReadFailed,
  RasterInstanceCountFailed,
  RasterTrackingReadFailed,
  RasterTrackingUnavailable,
  RasterSourceUnknown,
  RasterResourceReadFailed,
  NoDatabase,
  RvtEnumerationFailed,
  CadEnumerationFailed,
  PointCloudEnumerationFailed,
  RasterEnumerationFailed,
  Cancelled,
  Skipped,
  OperationFailed,
  SourceInvalid,
  RollbackFailed,
  SessionExpired,
};

struct Message
{
  MessageCode code = MessageCode::None;
  std::wstring diagnostic; // Technical detail for logs only; never display directly.
  bool rollbackFailed = false;
};

struct RasterMetadata
{
  int pageNumber = 0;
  int widthPixels = 0;
  int heightPixels = 0;
  double dpi = 0.0;
};

// A row represents a resource/type, not one of its placed instances. The handle
// is meaningful only together with the owning document/session.
struct Item
{
  std::uint64_t handle = 0;
  Kind kind = Kind::Rvt;
  Reference reference = Reference::Unknown;
  std::optional<RvtReferenceType> rvtReferenceType;
  LoadState load = LoadState::Unknown;
  PathKind pathKind = PathKind::Unknown;
  std::wstring name;
  std::wstring savedPath;
  std::wstring resolvedPath;
  std::optional<int> instanceCount;
  std::optional<RasterMetadata> raster;
};

struct Snapshot
{
  std::vector<Item> items;
  std::vector<MessageCode> warnings;
};

struct OperationResult
{
  bool success = false;
  bool modelChanged = false;
  std::uint64_t resourceHandle = 0;
  Message message;
};
} // namespace ManageLinks
