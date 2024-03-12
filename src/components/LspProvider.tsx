import { LanguageServerClient } from 'editor/plugins/lsp'
import type * as LSP from 'vscode-languageserver-protocol'
import React, { createContext, useMemo, useContext } from 'react'
import { FromServer, IntoServer } from 'editor/plugins/lsp/codec'
import Server from '../editor/plugins/lsp/server'
import Client from '../editor/plugins/lsp/client'
import { TEST } from 'env'
import kclLanguage from 'editor/plugins/lsp/kcl/language'
import { copilotPlugin } from 'editor/plugins/lsp/copilot'
import { useStore } from 'useStore'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { Extension } from '@codemirror/state'
import { LanguageSupport } from '@codemirror/language'
import { useNavigate } from 'react-router-dom'
import { paths } from 'lib/paths'
import { FileEntry } from '@tauri-apps/api/fs'
import { ProjectWithEntryPointMetadata } from 'lib/types'

const DEFAULT_FILE_NAME: string = 'main.kcl'

function getWorkspaceFolders(): LSP.WorkspaceFolder[] {
  return []
}

// an OS-agnostic way to get the basename of the path.
export function projectBasename(filePath: string, projectPath: string): string {
  const newPath = filePath.replace(projectPath, '')
  // Trim any leading slashes.
  let trimmedStr = newPath.replace(/^\/+/, '').replace(/^\\+/, '')
  return trimmedStr
}

type LspContext = {
  lspClients: LanguageServerClient[]
  copilotLSP: Extension | null
  kclLSP: LanguageSupport | null
  onProjectClose: (
    file: FileEntry | null,
    projectPath: string | null,
    redirect: boolean
  ) => void
  onProjectOpen: (
    project: ProjectWithEntryPointMetadata | null,
    file: FileEntry | null
  ) => void
  onFileOpen: (filePath: string | null, projectPath: string | null) => void
  onFileClose: (filePath: string | null, projectPath: string | null) => void
  onFileCreate: (file: FileEntry, projectPath: string | null) => void
  onFileRename: (
    oldFile: FileEntry,
    newFile: FileEntry,
    projectPath: string | null
  ) => void
  onFileDelete: (file: FileEntry, projectPath: string | null) => void
}

export const LspStateContext = createContext({} as LspContext)
export const LspProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    isKclLspServerReady,
    isCopilotLspServerReady,
    setIsKclLspServerReady,
    setIsCopilotLspServerReady,
  } = useStore((s) => ({
    isKclLspServerReady: s.isKclLspServerReady,
    isCopilotLspServerReady: s.isCopilotLspServerReady,
    setIsKclLspServerReady: s.setIsKclLspServerReady,
    setIsCopilotLspServerReady: s.setIsCopilotLspServerReady,
  }))

  const { auth } = useSettingsAuthContext()
  const token = auth?.context?.token
  const navigate = useNavigate()

  // So this is a bit weird, we need to initialize the lsp server and client.
  // But the server happens async so we break this into two parts.
  // Below is the client and server promise.
  const { lspClient: kclLspClient } = useMemo(() => {
    const intoServer: IntoServer = new IntoServer()
    const fromServer: FromServer = FromServer.create()
    const client = new Client(fromServer, intoServer)
    if (!TEST) {
      Server.initialize(intoServer, fromServer).then((lspServer) => {
        lspServer.start('kcl', token)
        setIsKclLspServerReady(true)
      })
    }

    const lspClient = new LanguageServerClient({ client, name: 'kcl' })
    return { lspClient }
  }, [setIsKclLspServerReady, token])

  // Here we initialize the plugin which will start the client.
  // Now that we have multi-file support the name of the file is a dep of
  // this use memo, as well as the directory structure, which I think is
  // a good setup because it will restart the client but not the server :)
  // We do not want to restart the server, its just wasteful.
  const kclLSP = useMemo(() => {
    let plugin = null
    if (isKclLspServerReady && !TEST) {
      // Set up the lsp plugin.
      const lsp = kclLanguage({
        documentUri: `file:///${DEFAULT_FILE_NAME}`,
        workspaceFolders: getWorkspaceFolders(),
        client: kclLspClient,
      })

      plugin = lsp
    }
    return plugin
  }, [kclLspClient, isKclLspServerReady])

  const { lspClient: copilotLspClient } = useMemo(() => {
    const intoServer: IntoServer = new IntoServer()
    const fromServer: FromServer = FromServer.create()
    const client = new Client(fromServer, intoServer)
    if (!TEST) {
      Server.initialize(intoServer, fromServer).then((lspServer) => {
        lspServer.start('copilot', token)
        setIsCopilotLspServerReady(true)
      })
    }

    const lspClient = new LanguageServerClient({ client, name: 'copilot' })
    return { lspClient }
  }, [setIsCopilotLspServerReady, token])

  // Here we initialize the plugin which will start the client.
  // When we have multi-file support the name of the file will be a dep of
  // this use memo, as well as the directory structure, which I think is
  // a good setup because it will restart the client but not the server :)
  // We do not want to restart the server, its just wasteful.
  const copilotLSP = useMemo(() => {
    let plugin = null
    if (isCopilotLspServerReady && !TEST) {
      // Set up the lsp plugin.
      const lsp = copilotPlugin({
        documentUri: `file:///${DEFAULT_FILE_NAME}`,
        workspaceFolders: getWorkspaceFolders(),
        client: copilotLspClient,
        allowHTMLContent: true,
      })

      plugin = lsp
    }
    return plugin
  }, [copilotLspClient, isCopilotLspServerReady])

  const lspClients = [kclLspClient, copilotLspClient]

  const onProjectClose = (
    file: FileEntry | null,
    projectPath: string | null,
    redirect: boolean
  ) => {
    const currentFilePath = projectBasename(
      file?.path || DEFAULT_FILE_NAME,
      projectPath || ''
    )
    lspClients.forEach((lspClient) => {
      lspClient.textDocumentDidClose({
        textDocument: {
          uri: `file:///${currentFilePath}`,
        },
      })
    })

    if (redirect) {
      navigate(paths.HOME)
    }
  }

  const onProjectOpen = (
    project: ProjectWithEntryPointMetadata | null,
    file: FileEntry | null
  ) => {
    const projectName = project?.name || 'ProjectRoot'
    // Send that the workspace folders changed.
    lspClients.forEach((lspClient) => {
      lspClient.workspaceDidChangeWorkspaceFolders(
        [{ uri: 'file://', name: projectName }],
        []
      )
    })
    if (file) {
      // Send that the file was opened.
      const filename = projectBasename(
        file?.path || DEFAULT_FILE_NAME,
        project?.path || ''
      )
      lspClients.forEach((lspClient) => {
        lspClient.textDocumentDidOpen({
          textDocument: {
            uri: `file:///${filename}`,
            languageId: 'kcl',
            version: 1,
            text: '',
          },
        })
      })
    }
  }

  const onFileOpen = (filePath: string | null, projectPath: string | null) => {
    const currentFilePath = projectBasename(
      filePath || DEFAULT_FILE_NAME,
      projectPath || ''
    )
    lspClients.forEach((lspClient) => {
      lspClient.textDocumentDidOpen({
        textDocument: {
          uri: `file:///${currentFilePath}`,
          languageId: 'kcl',
          version: 1,
          text: '',
        },
      })
    })
  }

  const onFileClose = (filePath: string | null, projectPath: string | null) => {
    const currentFilePath = projectBasename(
      filePath || DEFAULT_FILE_NAME,
      projectPath || ''
    )
    lspClients.forEach((lspClient) => {
      lspClient.textDocumentDidClose({
        textDocument: {
          uri: `file:///${currentFilePath}`,
        },
      })
    })
  }

  const onFileCreate = (file: FileEntry, projectPath: string | null) => {
    const currentFilePath = projectBasename(file.path, projectPath || '')
    lspClients.forEach((lspClient) => {
      lspClient.workspaceDidCreateFiles({
        files: [
          {
            uri: `file:///${currentFilePath}`,
          },
        ],
      })
    })
  }

  const onFileRename = (
    oldFile: FileEntry,
    newFile: FileEntry,
    projectPath: string | null
  ) => {
    const oldFilePath = projectBasename(oldFile.path, projectPath || '')
    const newFilePath = projectBasename(newFile.path, projectPath || '')
    lspClients.forEach((lspClient) => {
      lspClient.workspaceDidRenameFiles({
        files: [
          {
            oldUri: `file:///${oldFilePath}`,
            newUri: `file:///${newFilePath}`,
          },
        ],
      })
    })
  }

  const onFileDelete = (file: FileEntry, projectPath: string | null) => {
    const currentFilePath = projectBasename(file.path, projectPath || '')
    lspClients.forEach((lspClient) => {
      lspClient.workspaceDidDeleteFiles({
        files: [
          {
            uri: `file:///${currentFilePath}`,
          },
        ],
      })
    })
  }

  return (
    <LspStateContext.Provider
      value={{
        lspClients,
        copilotLSP,
        kclLSP,
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
