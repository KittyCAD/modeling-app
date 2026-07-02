import type { LanguageSupport } from '@codemirror/language'
import { type Extension, Prec } from '@codemirror/state'
import type { LanguageServerPlugin } from '@kittycad/codemirror-lsp-client'
import {
  FromServer,
  IntoServer,
  LanguageServerClient,
  LspWorkerEventType,
} from '@kittycad/codemirror-lsp-client'
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type * as LSP from 'vscode-languageserver-protocol'

import { kclAutocompleteCompartment, kclLspCompartment } from '@src/editor'
import { copilotPlugin } from '@src/editor/plugins/lsp/copilot'
import { kcl } from '@src/editor/plugins/lsp/kcl/language'
import type {
  CopilotWorkerOptions,
  KclWorkerOptions,
} from '@src/editor/plugins/lsp/types'
import { LspWorker } from '@src/editor/plugins/lsp/types'
import Worker from '@src/editor/plugins/lsp/worker.ts?worker'
import { wasmUrl } from '@src/lang/wasmUtils'
import { useApp, useSingletons } from '@src/lib/boot'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { PATHS } from '@src/lib/paths'
import type { FileEntry } from '@src/lib/project'
import { err } from '@src/lib/trap'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

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

function fileUri(
  filePath: string | null | undefined,
  projectPath?: string | null
) {
  const path = filePath || PROJECT_ENTRYPOINT

  if (projectPath && path.startsWith(projectPath)) {
    return `file://${path}`
  }

  return `file:///${projectBasename(path, projectPath || '')}`
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
  const { auth } = useApp()
  const { kclManager } = useSingletons()
  const [isKclLspReady, setIsKclLspReady] = useState(false)
  const [isCopilotLspReady, setIsCopilotLspReady] = useState(false)
  const lastWorkspaceFolderByClientRef = useRef(
    new WeakMap<LanguageServerClient, string>()
  )

  const token = auth.useToken()
  const navigate = useNavigate()

  // So this is a bit weird, we need to initialize the lsp server and client.
  // But the server happens async so we break this into two parts.
  // Below is the client and server promise.
  const { lspClient: kclLspClient } = useMemo(() => {
    if (!token || token === '') {
      return { lspClient: null }
    }

    const lspWorker = new Worker({ name: 'kcl' })
    const initEvent: KclWorkerOptions = {
      wasmUrl: wasmUrl(),
      token: token,
      apiBaseUrl: withAPIBaseURL(''),
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
    if (!window.electron && isKclLspReady && kclLspClient && kclManager.code) {
      kclLspClient.textDocumentDidOpen({
        textDocument: {
          uri: `file:///${PROJECT_ENTRYPOINT}`,
          languageId: 'kcl',
          version: 1,
          text: kclManager.code,
        },
      })
    }
  }, [kclLspClient, isKclLspReady, kclManager.code])

  // Here we initialize the plugin which will start the client.
  // Now that we have multi-file support the name of the file is a dep of
  // this use memo, as well as the directory structure, which I think is
  // a good setup because it will restart the client but not the server :)
  // We do not want to restart the server, its just wasteful.
  const kclLSP = useMemo(() => {
    let plugin = null
    if (isKclLspReady && kclLspClient) {
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

  useEffect(() => {
    // New code to just update the CodeMirror extensions directly.
    if (kclLSP === null) {
      return
    }
    kclManager.editorView.dispatch({
      effects: kclLspCompartment.reconfigure(Prec.highest(kclLSP)),
    })
    return () =>
      kclManager.editorView.dispatch({
        effects: kclLspCompartment.reconfigure(Prec.highest([])),
      })
  }, [kclLSP, kclManager.editorView])

  const { lspClient: copilotLspClient } = useMemo(() => {
    if (!token || token === '') {
      return { lspClient: null }
    }

    const lspWorker = new Worker({ name: 'copilot' })
    const initEvent: CopilotWorkerOptions = {
      wasmUrl: wasmUrl(),
      token: token,
      apiBaseUrl: withAPIBaseURL(''),
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
    if (isCopilotLspReady && copilotLspClient) {
      // Set up the lsp plugin.
      const lsp = copilotPlugin(
        {
          documentUri: `file:///${PROJECT_ENTRYPOINT}`,
          workspaceFolders: getWorkspaceFolders(),
          client: copilotLspClient,
          allowHTMLContent: true,
        },
        kclManager
      )

      // New code to just update the CodeMirror extensions directly.
      kclManager.editorView.dispatch({
        effects: kclAutocompleteCompartment.reconfigure(Prec.highest(lsp)),
      })
      plugin = lsp
    }
    return plugin
  }, [copilotLspClient, isCopilotLspReady, kclManager])

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
    lspClients.forEach((lspClient) => {
      lspClient.textDocumentDidClose({
        textDocument: {
          uri: fileUri(file?.path, projectPath),
        },
      })
    })
    kclManager.clearGlobalHistory()
    lastWorkspaceFolderByClientRef.current = new WeakMap<
      LanguageServerClient,
      string
    >()

    if (redirect) {
      void navigate(PATHS.HOME)
    }
  }

  const onProjectOpen = (
    project: { name: string | null; path: string | null } | null,
    file: FileEntry | null
  ) => {
    const projectName = project?.name || 'ProjectRoot'
    const projectUri = project?.path ? `file://${project.path}` : 'file://'
    const workspaceFolderKey = `${projectUri}:${projectName}`
    // Send that the workspace folders changed.
    lspClients.forEach((lspClient) => {
      if (
        lastWorkspaceFolderByClientRef.current.get(lspClient) !==
        workspaceFolderKey
      ) {
        lspClient.workspaceDidChangeWorkspaceFolders(
          [{ uri: projectUri, name: projectName }],
          []
        )
        lastWorkspaceFolderByClientRef.current.set(
          lspClient,
          workspaceFolderKey
        )
      }
    })
    if (file) {
      // Send that the file was opened.
      lspClients.forEach((lspClient) => {
        lspClient.textDocumentDidOpen({
          textDocument: {
            uri: fileUri(file.path, project?.path),
            languageId: 'kcl',
            version: 1,
            text: '',
          },
        })
      })
    }
  }

  const onFileOpen = (filePath: string | null, projectPath: string | null) => {
    lspClients.forEach((lspClient) => {
      lspClient.textDocumentDidOpen({
        textDocument: {
          uri: fileUri(filePath, projectPath),
          languageId: 'kcl',
          version: 1,
          text: '',
        },
      })
    })
  }

  const onFileClose = (filePath: string | null, projectPath: string | null) => {
    lspClients.forEach((lspClient) => {
      lspClient.textDocumentDidClose({
        textDocument: {
          uri: fileUri(filePath, projectPath),
        },
      })
    })
  }

  const onFileCreate = (file: FileEntry, projectPath: string | null) => {
    lspClients.forEach((lspClient) => {
      lspClient.workspaceDidCreateFiles({
        files: [
          {
            uri: fileUri(file.path, projectPath),
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
    lspClients.forEach((lspClient) => {
      lspClient.workspaceDidRenameFiles({
        files: [
          {
            oldUri: fileUri(oldFile.path, projectPath),
            newUri: fileUri(newFile.path, projectPath),
          },
        ],
      })
    })
  }

  const onFileDelete = (file: FileEntry, projectPath: string | null) => {
    lspClients.forEach((lspClient) => {
      lspClient.workspaceDidDeleteFiles({
        files: [
          {
            uri: fileUri(file.path, projectPath),
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
