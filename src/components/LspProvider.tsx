import React, { createContext, useContext, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import type { LspService } from '@src/lang/lsp/registry/contract'
import { createLspService } from '@src/lang/lsp/service'
import { useApp, useSingletons } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import type { FileEntry } from '@src/lib/project'

type LspContext = Omit<LspService, 'attachKclManager'>

export const LspStateContext = createContext({} as LspContext)
export const LspProvider = ({ children }: { children: React.ReactNode }) => {
  const { auth } = useApp()
  const { kclManager } = useSingletons()
  const navigate = useNavigate()
  const lsp = useMemo(() => createLspService({ getAuth: () => auth }), [auth])

  useEffect(() => {
    const detach = lsp.service.attachKclManager(kclManager)
    return () => {
      detach()
      lsp.dispose()
    }
  }, [lsp, kclManager])

  const onProjectClose = (
    file: FileEntry | null,
    projectPath: string | null,
    redirect: boolean
  ) => {
    lsp.service.onProjectClose(file, projectPath, redirect)

    if (redirect) {
      void navigate(PATHS.HOME)
    }
  }

  const onProjectOpen = (
    project: { name: string | null; path: string | null } | null,
    file: FileEntry | null
  ) => {
    lsp.service.onProjectOpen(project, file)
  }

  const onFileOpen = (filePath: string | null, projectPath: string | null) => {
    lsp.service.onFileOpen(filePath, projectPath)
  }

  const onFileClose = (filePath: string | null, projectPath: string | null) => {
    lsp.service.onFileClose(filePath, projectPath)
  }

  const onFileCreate = (file: FileEntry, projectPath: string | null) => {
    lsp.service.onFileCreate(file, projectPath)
  }

  const onFileRename = (
    oldFile: FileEntry,
    newFile: FileEntry,
    projectPath: string | null
  ) => {
    lsp.service.onFileRename(oldFile, newFile, projectPath)
  }

  const onFileDelete = (file: FileEntry, projectPath: string | null) => {
    lsp.service.onFileDelete(file, projectPath)
  }

  return (
    <LspStateContext.Provider
      value={{
        onProjectClose,
        onProjectOpen,
        onFileOpen,
        onFileClose,
        onFileCreate,
        onFileRename,
        onFileDelete,
      }}
    >
      {children}
    </LspStateContext.Provider>
  )
}

export default LspProvider

export const useLspContext = () => {
  return useContext(LspStateContext)
}
