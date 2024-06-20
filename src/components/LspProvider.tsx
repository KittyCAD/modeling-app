import { LanguageServerClient } from 'editor/plugins/lsp'
import type * as LSP from 'vscode-languageserver-protocol'
import React, { createContext, useMemo, useEffect, useContext, useState, } from 'react'
import { FromServer, IntoServer } from 'editor/plugins/lsp/codec'
import Client from '../editor/plugins/lsp/client'
import { TEST, VITE_KC_API_BASE_URL } from 'env'
import kclLanguage from 'editor/plugins/lsp/kcl/language'
import { copilotPlugin } from 'editor/plugins/lsp/copilot'
import { useStore } from 'useStore'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { Extension } from '@codemirror/state'
import { LanguageSupport } from '@codemirror/language'
import { useNavigate } from 'react-router-dom'
import { paths } from 'lib/paths'
import { FileEntry } from 'lib/types'
import Worker from 'editor/plugins/lsp/worker.ts?worker'
import {
  LspWorkerEventType,
  KclWorkerOptions,
  CopilotWorkerOptions,
  LspWorker,
} from 'editor/plugins/lsp/types'
import { wasmUrl } from 'lang/wasm'
import { PROJECT_ENTRYPOINT } from 'lib/constants'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { err, trap } from 'lib/trap'

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
  const {
    isKclLspServerReady,
    isCopilotLspServerReady,
    setIsKclLspServerReady,
    setIsCopilotLspServerReady,
    isStreamReady,
  } = useStore((s) => ({
    isKclLspServerReady: s.isKclLspServerReady,
    isCopilotLspServerReady: s.isCopilotLspServerReady,
    setIsKclLspServerReady: s.setIsKclLspServerReady,
    setIsCopilotLspServerReady: s.setIsCopilotLspServerReady,
    isStreamReady: s.isStreamReady,
  }))
  const [isLspReady, setIsLspReady] = useState(false)
  const [isCopilotReady, setIsCopilotReady] = useState(false)

  const {
    auth,
    settings: {
      context: {
        modeling: { defaultUnit },
      },
    },
  } = useSettingsAuthContext()
  const token = auth?.context.token
  const navigate = useNavigate()
  const { overallState } = useNetworkContext()
  const isNetworkOkay = overallState === NetworkHealthState.Ok

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
      baseUnit: defaultUnit.current,
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

    const client = new Client(fromServer, intoServer)

    setIsLspReady(true)

    const lspClient = new LanguageServerClient({ client, name: LspWorker.Kcl })
    return { lspClient }
  }, [
    // We need a token for authenticating the server.
    token,
  ])

  // Here we initialize the plugin which will start the client.
  // Now that we have multi-file support the name of the file is a dep of
  // this use memo, as well as the directory structure, which I think is
  // a good setup because it will restart the client but not the server :)
  // We do not want to restart the server, its just wasteful.
  const kclLSP = useMemo(() => {
    let plugin = null
    if (isKclLspServerReady && !TEST && kclLspClient) {
      // Set up the lsp plugin.
      const lsp = kclLanguage({
        documentUri: `file:///${PROJECT_ENTRYPOINT}`,
        workspaceFolders: getWorkspaceFolders(),
        client: kclLspClient,
      })

      plugin = lsp
    }
    return plugin
  }, [kclLspClient, isKclLspServerReady])

  // Re-execute the scene when the units change.
  useEffect(() => {
    if (kclLspClient) {
      let plugins = kclLspClient.plugins
      for (let plugin of plugins) {
        if (plugin.updateUnits && isStreamReady && isNetworkOkay) {
          plugin.updateUnits(defaultUnit.current)
        }
      }
    }
  }, [
    kclLspClient,
    defaultUnit.current,

    // We want to re-execute the scene if the network comes back online.
    // The lsp server will only re-execute if there were previous errors or
    // changes, so it's fine to send it thru here.
    isStreamReady,
    isNetworkOkay,
  ])

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

    const client = new Client(fromServer, intoServer)

    setIsCopilotReady(true)

    const lspClient = new LanguageServerClient({
      client,
      name: LspWorker.Copilot,
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
    if (isCopilotLspServerReady && !TEST && copilotLspClient) {
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
  }, [copilotLspClient, isCopilotLspServerReady])

  let lspClients: LanguageServerClient[] = []
  if (kclLspClient) {
    lspClients.push(kclLspClient)
  }
  if (copilotLspClient) {
    lspClients.push(copilotLspClient)
  }

  useEffect(() => {
    setIsKclLspServerReady(isLspReady)
  }, [isLspReady])
  useEffect(() => {
    setIsCopilotLspServerReady(isCopilotReady)
  }, [isCopilotReady])

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
      navigate(paths.HOME)
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
