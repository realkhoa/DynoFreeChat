/**
 * @file VBimNetworkHelper.h
 * @brief Public network utilities for VinaBIM plugins and project commands.
 */
#pragma once

#if defined(__has_include)
  #if __has_include("../VinaBIMApiExport.h")
    #include "../VinaBIMApiExport.h"
  #elif __has_include("VinaBIMApiExport.h")
    #include "VinaBIMApiExport.h"
  #elif __has_include("domain/public_api/VinaBIMApiExport.h")
    #include "domain/public_api/VinaBIMApiExport.h"
  #endif
#endif

#ifndef VINABIM_API
  #if defined(VINABIM_STATIC)
    #define VINABIM_API
  #elif defined(VINABIM_DLL)
    #define VINABIM_API __declspec(dllexport)
  #else
    #define VINABIM_API __declspec(dllimport)
  #endif
#endif

#include <string>

namespace vb {
namespace net {

/**
 * @brief Common network and encoding utilities for VinaBIM plugins and project commands.
 */
class VINABIM_API VBimNetworkHelper
{
public:
	/**
	 * @brief Decodes a URL-encoded UTF-8 string (RFC 3986 percent-decoding).
	 * @param encoded URL-encoded string.
	 * @return Decoded plain string. '+' is kept as '+' (not form-decoded to a space), and a
	 *         malformed escape such as "%zz" is copied through unchanged.
	 */
	static std::string UrlDecode(const std::string& encoded);

	/**
	 * @brief URL-encodes a UTF-8 string per RFC 3986.
	 * @param raw Input string.
	 * @return URL-encoded string.
	 */
	static std::string UrlEncode(const std::string& raw);

	/**
	 * @brief Retrieves the local computer / device name.
	 * @return Device name string.
	 */
	static std::string GetDeviceName();

	/**
	 * @brief Extracts a top-level scalar or JSON field from a JSON string.
	 *
	 * Returns the raw string, the shortest round-trip number text ("0.1", "401"),
	 * "true"/"false", or compact JSON for an object or array stored under @p key on the
	 * root object.
	 *
	 * @param jsonString Raw JSON string (UTF-8).
	 * @param key Top-level field key.
	 * @return Field text; empty when the JSON does not parse (including truncated input),
	 *         the root is not an object, or the key is missing or null.
	 */
	static std::string GetValueFromJson(const std::string& jsonString, const std::string& key);
};

} // namespace net
} // namespace vb
