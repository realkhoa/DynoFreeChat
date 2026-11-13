#pragma once

#include "shared/core/VbResult.h"

#include <cstdint>
#include <string>
#include <vector>

namespace vb {
namespace cloud {

struct CloudFileItem
{
	std::wstring id;
	std::wstring name;
	std::wstring lastSync;
	std::uint64_t sizeBytes = 0;
	std::wstring extension;
};

class ICloudFileService
{
public:
	virtual ~ICloudFileService() = default;

	/// Retrieve the list of files stored in the cloud portal.
	///
	/// The limit parameter specifies the maximum number of file items to retrieve from
	/// the cloud portal.
	///
	/// Returns a vector of CloudFileItem on success, or an error if authentication
	/// fails due to a missing or invalid token.
	virtual vb::Result<std::vector<CloudFileItem>> ListFiles(int limit) = 0;

	/// Download a file from the cloud portal to a local destination path.
	///
	/// The id parameter specifies the remote file identifier on the portal.
	/// The outputPath parameter specifies the local destination file path where the
	/// downloaded file will be saved.
	///
	/// Returns vb::Void on success, or an error if the download fails or the
	/// written file cannot be validated.
	virtual vb::Result<vb::Void> DownloadFile(const std::wstring& id, const std::wstring& outputPath) = 0;

	/// Upload a local BIM model (RVT or RFA) file to the cloud portal.
	///
	/// The localPath parameter specifies the absolute path to the local RVT or RFA
	/// file that will be uploaded.
	///
	/// Returns vb::Void on success, or an error if the file format is unsupported
	/// or the network upload fails.
	virtual vb::Result<vb::Void> UploadFile(const std::wstring& localPath) = 0;

	/// Rename an existing file on the cloud portal.
	///
	/// The id parameter specifies the remote file identifier on the portal.
	/// The newName parameter specifies the new filename (with a supported extension
	/// like .rvt or .rfa) to assign to the file.
	///
	/// Returns vb::Void on success, or an error if the new file name is invalid
	/// or the portal returns a failure response.
	virtual vb::Result<vb::Void> RenameFile(const std::wstring& id, const std::wstring& newName) = 0;

	/// Delete an existing file from the cloud portal.
	///
	/// The id parameter specifies the remote file identifier on the portal.
	///
	/// Returns vb::Void on success, or an error if the deletion fails.
	virtual vb::Result<vb::Void> DeleteFile(const std::wstring& id) = 0;
};

} // namespace cloud
} // namespace vb
