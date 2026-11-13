#pragma once

#include <exception>
#include <string>

class EditFamilyException : public std::exception
{
	std::wstring m_msg;

public:
	explicit EditFamilyException(std::wstring msg) noexcept		: m_msg(std::move(msg))
	{
	}

	const wchar_t* wideWhat() const noexcept { return m_msg.c_str(); }

	const char* what() const noexcept override { return "EditFamilyException"; }
};
