#include "pch.h"
#include "VBimNetworkHelper.h"
#include "shared/net/VbHttp.h"
#include "shared/json/VbJson.h"
#include "shared/json/VbJsonLegacy.h"

#include <windows.h>

namespace vb {
namespace net {

std::string VBimNetworkHelper::UrlDecode(const std::string& encoded)
{
	return vb::net::PercentDecode(encoded);
}

std::string VBimNetworkHelper::UrlEncode(const std::string& raw)
{
	return vb::net::PercentEncode(raw);
}

std::string VBimNetworkHelper::GetDeviceName()
{
	wchar_t buffer[MAX_COMPUTERNAME_LENGTH + 1] = {};
	DWORD size = MAX_COMPUTERNAME_LENGTH + 1;
	if (!::GetComputerNameExW(ComputerNamePhysicalNetBIOS, buffer, &size))
	{
		size = MAX_COMPUTERNAME_LENGTH + 1;
		if (!::GetComputerNameW(buffer, &size))
			return "DESKTOP-VINABIM";
	}
	const int utf8Len = ::WideCharToMultiByte(CP_UTF8, 0, buffer, -1, nullptr, 0, nullptr, nullptr);
	if (utf8Len <= 1)
		return "DESKTOP-VINABIM";
	std::string result(static_cast<size_t>(utf8Len - 1), '\0');
	::WideCharToMultiByte(CP_UTF8, 0, buffer, -1, &result[0], utf8Len, nullptr, nullptr);
	return result;
}

std::string VBimNetworkHelper::GetValueFromJson(const std::string& jsonString, const std::string& key)
{
	const auto doc = vb::json::Document::Parse(jsonString);
	if (!doc)
		return "";
	const vb::json::Value val = doc->Root()[key];
	if (!val.Exists() || val.type() == vb::json::Type::Null)
		return "";
	// Same text as the Host helpers: raw string, shortest number ("0.1", "401"),
	// "true"/"false", or compact JSON for objects and arrays.
	return vb::json::legacy::ScalarText(val);
}

} // namespace net
} // namespace vb
