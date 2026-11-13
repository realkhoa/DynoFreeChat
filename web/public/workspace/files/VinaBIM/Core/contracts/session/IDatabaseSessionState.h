#pragma once

class ICommandExecutor;

/** Host BIM database attach/lifecycle state shared across UI and use cases. */
class IDatabaseSessionState
{
public:
	virtual ~IDatabaseSessionState() = default;

	virtual void attachFromCommandExecutor(ICommandExecutor* executor) = 0;
	virtual bool databaseIsAttached() const = 0;
	virtual bool documentIsModel() const = 0;

	/** Opaque native BIM database pointer for graphics init and legacy dialog/interop boundaries. */
	virtual void* nativeBimDatabasePtr() = 0;

	virtual void syncStartupShadowSettings(bool shadowsEnabled) = 0;
};
