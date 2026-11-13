#pragma once

class CDocument;
class CView;
class OdBmCommandContext;
class OdBmDatabase;

/** Host-side command and document operations exposed to the view without CDocument/CVinaBIMDoc coupling. */
class ICommandExecutor
{
public:
	virtual ~ICommandExecutor() = default;

	virtual void executeCommand(const wchar_t* command, bool echo = true) = 0;
	/** Invokes Host component placement directly and reports whether dispatch started. */
	virtual bool executeComponentCommand() = 0;
	virtual void repeatLastCommand() = 0;
	virtual OdBmCommandContext* commandContext() = 0;
	virtual bool isHeavyDocument() const = 0;
	virtual void onViewClosing(CView* view) = 0;
	virtual OdBmDatabase* bimDatabase() = 0;
	virtual CDocument* createNewDocumentFromTemplate() = 0;
	virtual void removeDocument(CDocument* doc) = 0;
	virtual void registerDocumentForBmAssignment(CDocument* doc) = 0;
};
