// =============================================================================
//  VBimJson.h - Public JSON facade for VinaBIM SDK & Plugins.
//  Rules: RapidJSON types never appear in this header (pimpl). Strings are
//  UTF-8. Parsing is strict RFC 8259; errors carry an offset. Values are
//  read-only views that keep their Document alive.
// =============================================================================
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

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace vb {
namespace json {

class Document;

/** @brief Maximum array/object nesting depth accepted by Document::Parse. */
inline constexpr std::size_t kMaxNestingDepth = 512;

/** @brief JSON value kind. */
enum class Type
{
	Missing, ///< Key or index not present (lookups never throw).
	Null,    ///< JSON null.
	Bool,    ///< true or false.
	Number,  ///< Integer or floating-point number.
	String,  ///< UTF-8 string.
	Array,   ///< Ordered list.
	Object   ///< Ordered key/value members.
};

/**
 * @brief Read-only view of a JSON value. Cheap to copy; keeps the owning
 *        Document alive. Missing lookups return a Value of Type::Missing, so
 *        chains like root["data"][0]["name"].AsString() never crash.
 * @note Safe to read from several threads at once; not mutable. A
 *       default-constructed Value is Type::Missing.
 */
class VINABIM_API Value
{
public:
	/**
	 * @brief Kind of this value.
	 * @return Type::Missing when the lookup failed.
	 */
	Type type() const noexcept;
	/**
	 * @brief Tells whether the lookup that produced this value succeeded.
	 * @return true unless Type::Missing.
	 */
	bool Exists() const noexcept;

	/**
	 * @brief Object member lookup (first member with that name).
	 * @param key Member name, UTF-8.
	 * @return The member; Missing when not an object or key absent.
	 */
	Value operator[](std::string_view key) const;
	/**
	 * @brief Array element lookup.
	 * @param index Zero-based element index.
	 * @return The element; Missing when not an array or out of range.
	 */
	Value operator[](std::size_t index) const;
	/**
	 * @brief RFC 6901 JSON Pointer lookup relative to this value.
	 * @param jsonPointer Pointer text such as "/data/0/name".
	 * @return The addressed value (this value itself for an empty pointer); Missing when the
	 *         pointer is invalid or unresolved.
	 */
	Value At(std::string_view jsonPointer) const;
	/**
	 * @brief Number of children.
	 * @return Element count for arrays, member count for objects, 0 otherwise.
	 */
	std::size_t Size() const noexcept;

	/**
	 * @brief String content, no coercion.
	 * @return The string when Type::String, otherwise nullopt.
	 */
	std::optional<std::string> AsString() const;
	/**
	 * @brief Integer content.
	 * @return The integer when Type::Number and integral and in range, otherwise nullopt.
	 */
	std::optional<std::int64_t> AsInt() const;
	/**
	 * @brief Floating-point content.
	 * @return The number when Type::Number, otherwise nullopt.
	 */
	std::optional<double> AsDouble() const;
	/**
	 * @brief Boolean content, no coercion.
	 * @return The boolean when Type::Bool, otherwise nullopt.
	 */
	std::optional<bool> AsBool() const;

	/**
	 * @brief Shortcut: member string or fallback. Mirrors legacy GetValueFromJson usage.
	 * @param key Member name, UTF-8.
	 * @param fallback Returned when the member is absent or not a string.
	 * @return The member string or the fallback.
	 */
	std::string GetString(std::string_view key, std::string fallback = {}) const;

	/**
	 * @brief Compact serialization (for legacy APIs that want raw JSON).
	 * @return JSON text of this value; empty for Type::Missing.
	 */
	std::string ToJson() const;

	/**
	 * @brief Object member by position, in document order.
	 * @param index Zero-based member index.
	 * @param key Optional out-parameter receiving the member name; the view stays
	 *        valid while this Value (or any copy) is alive.
	 * @return The member value; Missing when not an object or index out of range.
	 */
	Value MemberAt(std::size_t index, std::string_view* key = nullptr) const;

	/**
	 * @brief Visits object members in document order.
	 * @param fn Callable (std::string_view key, const Value& value) -> void.
	 */
	template <class Fn> void ForEachMember(Fn&& fn) const
	{
		const std::size_t count = Size();
		for (std::size_t i = 0; i < count; ++i)
		{
			std::string_view key;
			const Value member = MemberAt(i, &key);
			fn(key, member);
		}
	}
	/**
	 * @brief Visits array elements in order.
	 * @param fn Callable (std::size_t index, const Value& value) -> void.
	 */
	template <class Fn> void ForEachElement(Fn&& fn) const
	{
		const std::size_t count = Size();
		for (std::size_t i = 0; i < count; ++i)
		{
			const Value element = (*this)[i];
			fn(i, element);
		}
	}

private:
	friend class Document;
	std::shared_ptr<const void> m_owner; ///< Keeps the parsed document alive.
	const void* m_node = nullptr;        ///< rapidjson::Value* inside m_owner.
};

/** @brief Parse failure details. */
struct ParseError
{
	std::size_t offset = 0;   ///< Byte offset of the error in the input.
	std::string message;      ///< English description (RapidJSON GetParseError_En, or "nesting too deep").
};

/**
 * @brief Parsed, immutable JSON document.
 * @note Immutable after Parse; safe to read concurrently from several threads.
 */
class VINABIM_API Document
{
public:
	/**
	 * @brief Parses UTF-8 JSON (strict RFC 8259; validates UTF-8 and surrogate pairs).
	 *
	 * Nesting deeper than kMaxNestingDepth (512) arrays/objects is rejected before
	 * parsing with ParseError message "nesting too deep" and the offset of the
	 * first bracket exceeding the limit.
	 * @param utf8 Input text; may be any size, not required to be null-terminated.
	 * @param error Optional out-parameter filled on failure.
	 * @return Document on success, nullopt on malformed input.
	 */
	static std::optional<Document> Parse(std::string_view utf8, ParseError* error = nullptr);

	/**
	 * @brief Root value of the document.
	 * @return Root value view (Missing for a default-constructed Document).
	 */
	Value Root() const;

private:
	std::shared_ptr<const void> m_impl; ///< rapidjson::Document + input buffer.
};

/**
 * @brief Streaming JSON writer that always escapes correctly.
 *
 * Misuse is tracked in every build configuration: an unmatched EndObject or
 * EndArray, a value inside an object without a preceding Key, or a Key outside
 * an object is ignored and marks the writer failed. Take() on a failed writer
 * returns an empty string and resets it. A null/empty string_view is written as
 * an empty string.
 *
 * @code
 *   std::string body = vb::json::Writer()
 *       .BeginObject()
 *           .Key("action").String(action)
 *           .Key("email").String(email)      // quotes/backslashes escaped
 *           .Key("count").Int(3)
 *       .EndObject()
 *       .Take();
 * @endcode
 * @note Not thread-safe. A moved-from Writer must not be used.
 */
class VINABIM_API Writer
{
public:
	/** @brief Creates an empty writer. */
	Writer();
	/** @brief Destroys the writer. */
	~Writer();
	/** @brief Move constructor; the source must not be used afterwards. */
	Writer(Writer&&) noexcept;
	/** @brief Move assignment; the source must not be used afterwards. */
	Writer& operator=(Writer&&) noexcept;

	/** @brief Starts '{'. @return *this for chaining. */
	Writer& BeginObject();
	/** @brief Ends '}'; fails the writer when no object is open. @return *this for chaining. */
	Writer& EndObject();
	/** @brief Starts '['. @return *this for chaining. */
	Writer& BeginArray();
	/** @brief Ends ']'; fails the writer when no array is open. @return *this for chaining. */
	Writer& EndArray();
	/**
	 * @brief Writes a member name; fails the writer outside an object or after another Key.
	 * @param utf8 Member name, UTF-8.
	 * @return *this for chaining.
	 */
	Writer& Key(std::string_view utf8);
	/**
	 * @brief Writes an escaped string value.
	 * @param utf8 Value text, UTF-8; null/empty writes "".
	 * @return *this for chaining.
	 */
	Writer& String(std::string_view utf8);
	/**
	 * @brief Writes an integer value.
	 * @param v The integer.
	 * @return *this for chaining.
	 */
	Writer& Int(std::int64_t v);
	/**
	 * @brief Writes a number value; NaN/Infinity are written as null.
	 * @param v The number.
	 * @return *this for chaining.
	 */
	Writer& Double(double v);
	/**
	 * @brief Writes true/false.
	 * @param v The boolean.
	 * @return *this for chaining.
	 */
	Writer& Bool(bool v);
	/** @brief Writes null. @return *this for chaining. */
	Writer& Null();
	/**
	 * @brief Returns the JSON written so far and resets the writer.
	 * @return The JSON text, including partial text of an unbalanced (but not
	 *         failed) writer; empty when the writer failed through misuse.
	 */
	std::string Take();

private:
	struct Impl;
	std::unique_ptr<Impl> m_impl;
};

} // namespace json
} // namespace vb
