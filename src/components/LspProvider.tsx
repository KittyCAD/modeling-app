import { LanguageSupport } from '@codemirror/language'
import { Extension } from '@codemirror/state'
import {
  FromServer,
  IntoServer,
  LanguageServerClient,
  LanguageServerPlugin,
  LspWorkerEventType,
} from '@kittycad/codemirror-lsp-client'
import { copilotPlugin } from 'editor/plugins/lsp/copilot'
import { kcl } from 'editor/plugins/lsp/kcl/language'
import {
  CopilotWorkerOptions,
  KclWorkerOptions,
  LspWorker,
} from 'editor/plugins/lsp/types'
import Worker from 'editor/plugins/lsp/worker.ts?worker'
import { TEST, VITE_KC_API_BASE_URL } from 'env'
import { wasmUrl } from 'lang/wasm'
import { PROJECT_ENTRYPOINT } from 'lib/constants'
import { isDesktop } from 'lib/isDesktop'
import { PATHS } from 'lib/paths'
import { FileEntry } from 'lib/project'
import { codeManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { useToken } from 'machines/appMachine'
import React, { createContext, useContext, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type * as LSP from 'vscode-languageserver-protocol'

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
    project: { name: string | null; path: string | null } | null,
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
  const [isKclLspReady, setIsKclLspReady] = useState(false)
  const [isCopilotLspReady, setIsCopilotLspReady] = useState(false)

  const token = useToken()
  const navigate = useNavigate()

  // So this is a bit weird, we need to initialize the lsp server and client.
  // But the server happens async so we break this into two parts.
  // Below is the client and server promise.
  const { lspClient: kclLspClient } = useMemo(() => {
    if (!token || token === '' || TEST) {
      return { lspClient: null }
    }

    const lspWorker = new Worker({ name: 'kcl' })
    const initEvent: KclWorkerOptions = {
      wasmUrl: wasmUrl(),
      token: token,
      apiBaseUrl: VITE_KC_API_BASE_URL,
    }
    lspWorker.postMessage({
      worker: LspWorker.Kcl,
      eventType: LspWorkerEventType.Init,
      eventData: initEvent,
    })
    lspWorker.onmessage = function (e) {
      if (err(fromServer)) return
      fromServer.add(e.data)
    }

    const intoServer: IntoServer = new IntoServer(LspWorker.Kcl, lspWorker)
    const fromServer: FromServer | Error = FromServer.create()
    if (err(fromServer)) return { lspClient: null }

    const lspClient = new LanguageServerClient({
      name: LspWorker.Kcl,
      fromServer,
      intoServer,
      initializedCallback: () => {
        setIsKclLspReady(true)
      },
    })

    return { lspClient }
  }, [
    // We need a token for authenticating the server.
    token,
  ])

  useMemo(() => {
    if (!isDesktop() && isKclLspReady && kclLspClient && codeManager.code) {
      kclLspClient.textDocumentDidOpen({
        textDocument: {
          uri: `file:///${PROJECT_ENTRYPOINT}`,
          languageId: 'kcl',
          version: 1,
          text: codeManager.code,
        },
      })
    }
  }, [kclLspClient, isKclLspReady])

  // Here we initialize the plugin which will start the client.
  // Now that we have multi-file support the name of the file is a dep of
  // this use memo, as well as the directory structure, which I think is
  // a good setup because it will restart the client but not the server :)
  // We do not want to restart the server, its just wasteful.
  const kclLSP = useMemo(() => {
    let plugin = null
    if (isKclLspReady && !TEST && kclLspClient) {
      // Set up the lsp plugin.
      const lsp = kcl({
        documentUri: `file:///${PROJECT_ENTRYPOINT}`,
        workspaceFolders: getWorkspaceFolders(),
        client: kclLspClient,
        processLspNotification: (
          plugin: LanguageServerPlugin,
          notification: LSP.NotificationMessage
        ) => {
          try {
            switch (notification.method) {
              case 'kcl/astUpdated':
                // Update the folding ranges, since the AST has changed.
                // This is a hack since codemirror does not support async foldService.
                // When they do we can delete this.
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                plugin.updateFoldingRanges()
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                plugin.requestSemanticTokens()
                break
            }
          } catch (error) {
            console.error(error)
          }
        },
      })

      plugin = lsp
    }
    return plugin
  }, [kclLspClient, isKclLspReady])

  const { lspClient: copilotLspClient } = useMemo(() => {
    if (!token || token === '' || TEST) {
      return { lspClient: null }
    }

    const lspWorker = new Worker({ name: 'copilot' })
    const initEvent: CopilotWorkerOptions = {
      wasmUrl: wasmUrl(),
      token: token,
      apiBaseUrl: VITE_KC_API_BASE_URL,
    }
    lspWorker.postMessage({
      worker: LspWorker.Copilot,
      eventType: LspWorkerEventType.Init,
      eventData: initEvent,
    })
    lspWorker.onmessage = function (e) {
      if (err(fromServer)) return
      fromServer.add(e.data)
    }

    const intoServer: IntoServer = new IntoServer(LspWorker.Copilot, lspWorker)
    const fromServer: FromServer | Error = FromServer.create()
    if (err(fromServer)) return { lspClient: null }

    const lspClient = new LanguageServerClient({
      name: LspWorker.Copilot,
      fromServer,
      intoServer,
      initializedCallback: () => {
        setIsCopilotLspReady(true)
      },
    })
    return { lspClient }
  }, [token])

  // Here we initialize the plugin which will start the client.
  // When we have multi-file support the name of the file will be a dep of
  // this use memo, as well as the directory structure, which I think is
  // a good setup because it will restart the client but not the server :)
  // We do not want to restart the server, its just wasteful.
  const copilotLSP = useMemo(() => {
    let plugin = null
    if (isCopilotLspReady && !TEST && copilotLspClient) {
      // Set up the lsp plugin.
      const lsp = copilotPlugin({
        documentUri: `file:///${PROJECT_ENTRYPOINT}`,
        workspaceFolders: getWorkspaceFolders(),
        client: copilotLspClient,
        allowHTMLContent: true,
      })

      plugin = lsp
    }
    return plugin
  }, [copilotLspClient, isCopilotLspReady])

  let lspClients: LanguageServerClient[] = []
  if (kclLspClient) {
    lspClients.push(kclLspClient)
  }
  if (copilotLspClient) {
    lspClients.push(copilotLspClient)
  }

  const onProjectClose = (
    file: FileEntry | null,
    projectPath: string | null,
    redirect: boolean
  ) => {
    const currentFilePath = projectBasename(
      file?.path || PROJECT_ENTRYPOINT,
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
      navigate(PATHS.HOME)
    }
  }

  const onProjectOpen = (
    project: { name: string | null; path: string | null } | null,
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
        file?.path || PROJECT_ENTRYPOINT,
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
      filePath || PROJECT_ENTRYPOINT,
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
      filePath || PROJECT_ENTRYPOINT,
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
