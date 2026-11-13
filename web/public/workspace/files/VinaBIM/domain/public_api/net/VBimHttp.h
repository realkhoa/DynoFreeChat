/**
 * @file VBimHttp.h
 * @brief Public SDK interface of the VinaBIM network layer (vb::net).
 *
 * Rules: std:: only (no libcurl, MFC, Win32 or ODA types); UTF-8 std::string for
 * URLs, headers and bodies; std::wstring only for local file paths. Every
 * IHttpClient method is safe to call from any thread at the same time and
 * nothing here ever touches an HWND or shows UI.
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

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace vb {
namespace net {

/** @brief HTTP method of a request. */
enum class Method
{
	Get,    ///< GET; idempotent, retried by default, follows redirects when maxRedirects > 0.
	Post,   ///< POST; not retried unless Request::Retries() is set.
	Put,    ///< PUT; idempotent.
	Patch,  ///< PATCH; not retried unless Request::Retries() is set.
	Delete, ///< DELETE; idempotent.
	Head    ///< HEAD; headers only, no body.
};

/**
 * @brief Why a request failed. ErrorKind::None means success (2xx).
 *
 * Callers branch on the kind, never on message text. HttpStatus means the
 * server answered with a non-2xx code; the response body is still available.
 */
enum class ErrorKind : int
{
	None = 0,
	InvalidRequest,   ///< Bad URL, empty method, invalid header or multipart field.
	Resolve,          ///< DNS lookup failed.
	Connect,          ///< TCP connect refused or unreachable.
	Tls,              ///< Handshake or certificate verification failed.
	Timeout,          ///< Connect, total or low-speed timeout hit.
	Cancelled,        ///< CancelToken fired or the client is shutting down.
	Transport,        ///< Any other transport error (see Error::transportCode).
	HttpStatus,       ///< Server answered with a non-2xx status.
	ResponseTooLarge, ///< Body exceeded ClientOptions::maxResponseBytes.
	Unauthorized,     ///< Authentication failure (no token signed in, or 401 after token refresh + retry).
	LocalFile         ///< Download target could not be written / renamed, or an upload file is missing / unreadable.
};

/** @brief One HTTP header line. Names compare case-insensitively. */
struct Header
{
	std::string name;              ///< Header name (case-insensitive).
	std::string value;             ///< Header value string.
};
/** @brief Sequence of HTTP headers. */
using Headers = std::vector<Header>;

/** @brief Per-phase timings in microseconds, measured by the transport. */
struct Timing
{
	std::int64_t dnsUs = 0;       ///< Name lookup done.
	std::int64_t connectUs = 0;   ///< TCP connected.
	std::int64_t tlsUs = 0;       ///< TLS handshake done (0 for http or reused).
	std::int64_t firstByteUs = 0; ///< First response byte received.
	std::int64_t totalUs = 0;     ///< Whole transfer, last attempt.
};

/** @brief Server response. Filled for 2xx and also for HttpStatus errors. */
struct VINABIM_API Response
{
	long status = 0;          ///< HTTP status code, 0 when no response arrived.
	Headers headers;          ///< Response headers of the final attempt.
	std::string body;         ///< Raw body bytes (UTF-8 for JSON APIs).
	std::string requestId;    ///< Value sent as X-Request-Id; join key for logs.
	Timing timing;            ///< Timings of the final attempt.
	int attempts = 1;         ///< Total attempts made (1 + retries and refresh resends).

	/** @return true for status 200..299. */
	bool IsSuccess() const noexcept { return status >= 200 && status < 300; }

	/**
	 * @brief Finds a response header.
	 * @param name Header name, case-insensitive.
	 * @return Pointer into headers, or nullptr when absent. Valid while *this lives.
	 */
	const std::string* FindHeader(std::string_view name) const;
};

/** @brief Failure description. message is English, for logs only. */
struct Error
{
	ErrorKind kind = ErrorKind::None; ///< Failure class; ErrorKind::None on success.
	long httpStatus = 0;     ///< Copy of Response::status when one arrived.
	int transportCode = 0;   ///< Underlying CURLcode as int; 0 when not applicable.
	std::string message;     ///< English diagnostic; never shown to the user as is.
	std::string requestId;   ///< Same id as Response::requestId.
};

/**
 * @brief Outcome of one call: response plus error.
 *
 * response is meaningful when ok() or when error.kind == HttpStatus.
 */
struct HttpResult
{
	Response response; ///< Status, headers, body and timing (see the struct note for validity).
	Error error;       ///< Failure details; kind == ErrorKind::None on success.

	/** @return true when the request completed with a 2xx status. */
	bool ok() const noexcept { return error.kind == ErrorKind::None; }
	/** @brief Boolean conversion operator evaluating to ok(). */
	explicit operator bool() const noexcept { return ok(); }
};

/**
 * @brief Cooperative cancellation shared between the caller and a transfer.
 *
 * Cheap to copy. Cancel() may be called from any thread; the transfer stops
 * at its next progress check (typically within ~1 s) with ErrorKind::Cancelled.
 */
class CancelToken
{
public:
	/** @brief Constructs a new, active cancellation token with its flag initially false. */
	CancelToken() : m_flag(std::make_shared<std::atomic_bool>(false)) {}
	/** @brief Requests cancellation of every transfer holding this token. */
	void Cancel() const noexcept { m_flag->store(true, std::memory_order_relaxed); }
	/** @return true once Cancel() was called. */
	bool IsCancelled() const noexcept { return m_flag->load(std::memory_order_relaxed); }

private:
	std::shared_ptr<std::atomic_bool> m_flag;
};

/**
 * @brief Transfer progress callback, invoked on the transfer's own thread.
 * @param done Bytes transferred so far.
 * @param total Expected bytes, 0 when unknown.
 * @return false to cancel the transfer.
 * @note Never touch UI from here; PostMessage to the UI thread instead.
 */
using ProgressFn = std::function<bool(std::uint64_t done, std::uint64_t total)>;

/** @brief How the client adds the Authorization header. */
enum class AuthMode
{
	None,       ///< No Authorization header.
	Bearer,     ///< "Authorization: Bearer <ITokenProvider::AccessToken()>"; 401 -> refresh once -> retry once (refresh is skipped when redirected to another host/origin).
	Explicit    ///< Use the value given in Request::Authorization() verbatim (e.g. ODA/CDE tokens).
};

/**
 * @brief Immutable-by-convention description of one HTTP call, built fluently.
 *
 * @code
 *   auto req = vb::net::Request::Get("https://api.vina-cad.com/api/user")
 *                  .Query("page", "1")
 *                  .WithAuth(AuthMode::Bearer)
 *                  .Tag("auth.user");
 * @endcode
 */
class VINABIM_API Request
{
public:
	/** @brief Creates a GET request. @param url Absolute URL (e.g. "https://api.vina-cad.com/..."). Plugins must use absolute URLs. */
	static Request Get(std::string url);
	/** @brief Creates a HEAD request. @param url Absolute URL or base-relative path. */
	static Request Head(std::string url);
	/** @brief Creates a POST request. @param url Absolute URL or base-relative path. */
	static Request Post(std::string url);
	/** @brief Creates a PUT request. @param url Absolute URL or base-relative path. */
	static Request Put(std::string url);
	/** @brief Creates a PATCH request. @param url Absolute URL or base-relative path. */
	static Request Patch(std::string url);
	/** @brief Creates a DELETE request. @param url Absolute URL or base-relative path. */
	static Request Delete(std::string url);

	/** @brief Appends "?" or "&" (depending on whether the URL already holds '?') plus key=value, both percent-encoded (RFC 3986). */
	Request& Query(std::string_view key, std::string_view value);
	/**
	 * @brief Adds a request header, replacing any existing header of the same name (case-insensitive).
	 * @note A header named "Authorization" (any case) is silently ignored; use WithAuth/Authorization.
	 */
	Request& SetHeader(std::string name, std::string value);
	/** @brief Sets a UTF-8 JSON body plus Content-Type and Accept: application/json (replace semantics of SetHeader). */
	Request& Json(std::string utf8Json);
	/** @brief Sets a raw body and its Content-Type header. */
	Request& Body(std::string bytes, std::string contentType);
	/** @brief Selects how the Authorization header is produced. Default: AuthMode::None. */
	Request& WithAuth(AuthMode mode);
	/** @brief Sets a verbatim Authorization value and switches to AuthMode::Explicit. Never logged. */
	Request& Authorization(std::string value);
	/**
	 * @brief Sets the total time budget of this call (all attempts and back-off).
	 * @param total Budget; overrides ClientOptions::requestTimeout for Send(). Download() and
	 *        Upload() have no default budget. When set, ClientOptions::lowSpeedAbort is not applied.
	 * @return *this for chaining.
	 */
	Request& Timeout(std::chrono::milliseconds total);
	/** @brief Overrides the retry budget. Non-idempotent methods retry only when this is set explicitly. */
	Request& Retries(int maxRetries);
	/** @brief Attaches a cancellation token. */
	Request& Cancel(CancelToken token);
	/** @brief Logical operation name used in traces, e.g. "license.get". Defaults to "<METHOD> <path>". */
	Request& Tag(std::string operation);
	/**
	 * @brief Lets Download() accept a 2xx file whose TLS stream ends without close_notify
	 *        (CURLE_RECV_ERROR, e.g. Microsoft-IIS) after a body with no Content-Length.
	 * @note Off by default: such a body ends at connection close, so truncation cannot be ruled
	 *       out. Set it only for a server known to close this way, and validate the file afterwards.
	 *       Send() and Upload() always accept such an in-memory body; this flag does not affect them.
	 * @return *this for chaining.
	 */
	Request& AllowUncleanTlsClose();

	/** @return HTTP method. */
	Method method() const noexcept { return m_method; }
	/** @return Absolute URL or base-relative path, including appended query. */
	const std::string& url() const noexcept { return m_url; }
	/** @return Headers added by SetHeader/Json/Body (never Authorization). */
	const Headers& headers() const noexcept { return m_headers; }
	/** @return Request body bytes; empty when none. */
	const std::string& body() const noexcept { return m_body; }
	/** @return Authorization mode. */
	AuthMode auth() const noexcept { return m_auth; }
	/** @return Verbatim Authorization value for AuthMode::Explicit; never log it. */
	const std::string& authorization() const noexcept { return m_authorization; }
	/** @return Per-call total timeout override, if set. */
	const std::optional<std::chrono::milliseconds>& timeout() const noexcept { return m_timeout; }
	/** @return Per-call retry budget override, if set. */
	const std::optional<int>& retries() const noexcept { return m_retries; }
	/** @return Cancellation token, if attached. */
	const std::optional<CancelToken>& cancel() const noexcept { return m_cancel; }
	/** @return Operation tag; empty when not set. */
	const std::string& tag() const noexcept { return m_tag; }
	/** @return True when AllowUncleanTlsClose() was set. */
	bool allowUncleanTlsClose() const noexcept { return m_allowUncleanTlsClose; }

private:
	Request(Method method, std::string url);

	Method m_method = Method::Get;
	std::string m_url;
	Headers m_headers;
	std::string m_body;
	AuthMode m_auth = AuthMode::None;
	std::string m_authorization;
	std::optional<std::chrono::milliseconds> m_timeout;
	std::optional<int> m_retries;
	std::optional<CancelToken> m_cancel;
	std::string m_tag;
	bool m_allowUncleanTlsClose = false;
};

/** @brief One multipart/form-data part: either a text value or a file. */
struct MultipartPart
{
	std::string name;          ///< Form field name.
	std::string value;         ///< Text value; ignored when filePath is set.
	std::wstring filePath;     ///< Local file streamed from disk (never loaded fully in memory).
	std::string fileName;      ///< UTF-8 file name sent to the server; defaults to filePath's leaf.
	std::string contentType;   ///< Defaults to application/octet-stream for files.
};

/** @brief Result of a token refresh attempt. */
enum class RefreshOutcome
{
	Refreshed,       ///< A newer access token is now available (refreshed by us or by another thread).
	InvalidSession,  ///< Server rejected the refresh token; user must sign in again.
	NetworkError     ///< Transport failure; session may still be valid (offline fallback).
};

/**
 * @brief Supplies and refreshes the bearer token. Implemented by the Host
 *        (registry/DPAPI storage); the network layer never reads the registry.
 *
 * @note Must be thread-safe. Refresh() is single-flight (see TokenRefreshGate):
 *       when several threads get 401 at once, only one calls the server; the
 *       others wait for it and reuse its outcome. They see Refreshed because
 *       AccessToken() no longer equals rejectedToken, or, when that refresh failed
 *       and the token is unchanged, its InvalidSession / NetworkError outcome. A
 *       caller arriving after a failed refresh has completed starts a new one.
 */
class VINABIM_API ITokenProvider
{
public:
	virtual ~ITokenProvider() = default;
	/** @return Current access token without the "Bearer " prefix; empty when signed out. */
	virtual std::string AccessToken() = 0;
	/**
	 * @brief Refreshes the token that the server just rejected.
	 * @param rejectedToken Token value that produced the 401.
	 * @return Outcome; Refreshed also when another thread already rotated it.
	 */
	virtual RefreshOutcome Refresh(const std::string& rejectedToken) = 0;
};

/** @brief Everything recorded about one finished attempt; contains no secrets. */
struct RequestTrace
{
	std::string requestId;         ///< Unique correlation identifier for the request.
	std::string tag;               ///< Logical operation name or method+path fallback.
	Method method = Method::Get;   ///< HTTP method used for the attempt.
	std::string redactedUrl;       ///< Scheme+host+path; sensitive query values replaced by "***".
	long status = 0;               ///< HTTP status code received (0 on connection failure).
	ErrorKind kind = ErrorKind::None; ///< Classification of outcome error if any.
	int transportCode = 0;         ///< Underlying libcurl CURLcode.
	Timing timing;                 ///< Microsecond timings of the attempt.
	std::uint64_t bytesSent = 0;   ///< Total bytes sent across the wire.
	std::uint64_t bytesReceived = 0; ///< Total bytes received across the wire.
	int attempt = 1;               ///< 1-based attempt sequence number.
	bool connectionReused = false; ///< True if TCP/TLS connection was reused from pool.
};

/**
 * @brief Receives traces for logging / telemetry.
 * @note Called on transfer threads concurrently; implementations must be
 *       thread-safe and return quickly (queue, then write).
 */
class VINABIM_API IHttpObserver
{
public:
	virtual ~IHttpObserver() = default;
	/**
	 * @brief Called once per attempt after it finishes (success or failure).
	 * @param trace Trace metrics and metadata describing the finished attempt.
	 */
	virtual void OnAttemptFinished(const RequestTrace& trace) = 0;
};

/** @brief TLS verification policy. */
enum class TlsMode
{
	Verify,            ///< Verify peer certificate and host name (production default).
	InsecureNoVerify   ///< Skip verification. Forced back to Verify by EnforceTlsPolicy in production; the Host logs a WARNING at bootstrap (the client itself does not).
};

/** @brief TLS settings for a client. */
struct TlsOptions
{
	TlsMode mode = TlsMode::Verify; ///< Certificate checking mode.
	bool useNativeCaStore = true;  ///< Trust the Windows certificate store (CURLSSLOPT_NATIVE_CA).
	std::wstring caBundlePath;     ///< Optional PEM bundle used in addition to / instead of the native store.
	bool allowPlainHttp = false;   ///< Permit http:// URLs. Forced to false in production by EnforceTlsPolicy.
};

/** @brief Build channel that decides how strict the TLS policy is. */
enum class BuildChannel
{
	Production,  ///< Release builds shipped to customers: always verify, https only.
	Staging      ///< Internal/test builds: the requested options are honoured.
};

/**
 * @brief Applies the channel's TLS policy to requested options.
 * @param requested Options asked for by configuration.
 * @param channel Build channel. Production forces mode=Verify and allowPlainHttp=false;
 *        Staging returns @p requested unchanged.
 * @param downgraded Optional out flag, set true when Production changed mode or
 *        allowPlainHttp, false otherwise (also for Staging). May be nullptr.
 * @return The options the client must use.
 * @note Pure function, thread-safe.
 */
VINABIM_API TlsOptions EnforceTlsPolicy(TlsOptions requested, BuildChannel channel, bool* downgraded = nullptr);

/** @brief Configuration fixed at client creation. */
struct ClientOptions
{
	std::string baseUrl;                                   ///< Prefix for relative request URLs.
	std::string userAgent = "VinaBIM";                     ///< Sent as User-Agent (append version at bootstrap).
	std::chrono::milliseconds connectTimeout{5000};        ///< Connection establishment timeout in milliseconds.
	std::chrono::milliseconds requestTimeout{30000};       ///< Total budget for Send(); 0 = none (downloads).
	/// Stall abort for calls without a total timeout: fail when < 1 byte/s moves for this long.
	/// Server processing time after a fully sent body also counts as a stall, so a call that
	/// expects long server work must set Request::Timeout(), which replaces this check.
	std::chrono::seconds lowSpeedAbort{30};
	std::size_t maxResponseBytes = 32u * 1024u * 1024u;    ///< Cap for in-memory bodies (Send and Upload); 0 = unlimited.
	int maxRetries = 1;                                    ///< Idempotent methods only; Connect/Timeout/502/503/504/429.
	int maxRedirects = 0;                                  ///< 0 = do not follow redirects.
	TlsOptions tls;                                        ///< TLS policy; pass through EnforceTlsPolicy() before use.
	std::shared_ptr<ITokenProvider> tokens;                ///< Required for AuthMode::Bearer.
	std::shared_ptr<IHttpObserver> observer;               ///< Optional trace sink.
};

/**
 * @brief Thread-safe HTTP client abstraction.
 *
 * One instance per application/subsystem. Safe to call concurrently from any
 * thread. Every call blocks the calling thread until the transfer finishes,
 * times out, or is cancelled.
 */
class VINABIM_API IHttpClient
{
public:
	virtual ~IHttpClient() = default;

	/**
	 * @brief Sends a request and buffers the body in memory.
	 * @param request Request description.
	 * @return Response and error; see HttpResult.
	 */
	virtual HttpResult Send(const Request& request) = 0;

	/**
	 * @brief Streams the response body to a file.
	 * @param request Request description (usually GET).
	 * @param outputPath Destination path. Data is written to "<path>.part" and
	 *        renamed on success, so a failed download never leaves a partial file.
	 * @param progress Optional progress callback (worker thread).
	 * @return Response without body, and error.
	 */
	virtual HttpResult Download(const Request& request, const std::wstring& outputPath, ProgressFn progress = {}) = 0;

	/**
	 * @brief Sends multipart/form-data, streaming file parts from disk.
	 * @param request Request description (POST or PUT).
	 * @param parts Form fields and files.
	 * @param progress Optional upload progress callback (worker thread).
	 * @return Response and error.
	 * @note Without Request::Timeout() the call is bounded only by ClientOptions::lowSpeedAbort,
	 *       which also fires while the server processes the received file. Pass a Timeout()
	 *       covering transfer plus server processing for endpoints that answer slowly.
	 */
	virtual HttpResult Upload(const Request& request, std::vector<MultipartPart> parts, ProgressFn progress = {}) = 0;

	/**
	 * @brief Cancels in-flight transfers and makes new calls fail with Cancelled.
	 * @param wait Maximum time to wait for in-flight transfers to return.
	 * @return true when every transfer returned in time (safe to call curl_global_cleanup).
	 */
	virtual bool Shutdown(std::chrono::milliseconds wait) = 0;
};

/**
 * @brief Short English name of an ErrorKind for logs.
 * @param kind Error kind.
 * @return Enumerator name without prefix ("None", "Timeout", "HttpStatus", ...); "Unknown" for out-of-range values.
 */
VINABIM_API const char* ToString(ErrorKind kind) noexcept;

/**
 * @brief Percent-encodes UTF-8 bytes per RFC 3986.
 * @param text Input bytes. Unreserved set A-Z a-z 0-9 - _ . ~ is kept; all else becomes %XX (uppercase hex).
 * @return Encoded string.
 */
VINABIM_API std::string PercentEncode(std::string_view text);

/**
 * @brief Decodes %XX sequences.
 * @param text Encoded input. '+' is NOT mapped to space; malformed %XY sequences are copied literally.
 * @return Decoded bytes.
 */
VINABIM_API std::string PercentDecode(std::string_view text);

} // namespace net
} // namespace vb
