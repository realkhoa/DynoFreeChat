#pragma once
#include <afxwin.h>

namespace VinaBIM {
    namespace Host {
        namespace Application {
            class CAppDocumentOpenDispatcher {
            public:
                static BOOL DispatchOpenFile(const CString& strFilePath);
            };
        }
    }
}
