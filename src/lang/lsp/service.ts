import {
  FromServer,
  IntoServer,
  LanguageServerClient,
  LspWorkerEventType,
} from '@kittycad/codemirror-lsp-client'
import { wasmUrl } from '@src/lang/wasmUtils'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import type { FileEntry } from '@src/lib/project'
import { err } from '@src/lib/trap'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import {
  attachKclLspToCodeMirror,
  getKclLspDocumentPath,
} from '@src/lang/lsp/codeMirror'
import type { LspService } from '@src/lang/lsp/registry/contract'
import type { KclLspEditor } from '@src/lang/lsp/types'
import type { KclWorkerOptions } from '@src/lang/lsp/workerTypes'
import { LspWorker } from '@src/lang/lsp/workerTypes'
import KclLspWorker from '@src/lang/lsp/worker.ts?worker'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import type * as LSP from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import type { Subscription } from 'xstate'

type LspRuntime = {
  token: string
  worker: globalThis.Worker
  client: LanguageServerClient
  ready: boolean
}

type ProjectSnapshot = {
  project: { name: string | null; path: string | null } | null
  file: FileEntry | null
}

/**
 * What the live CodeMirror attachment was built for, so we can tell a redundant
 * re-attach from one that would actually change something.
 */
type CodeMirrorAttachment = {
  dispose: () => void
  editor: KclLspEditor
  client: LanguageServerClient
  documentPath: string
}

type FileSnapshot = {
  filePath: string | null
  projectPath: string | null
}

type CreateLspServiceOptions = {
  getAuth: () => AuthRegistryService
}

export function createLspService({ getAuth }: CreateLspServiceOptions): {
  service: LspService
  dispose: () => void
} {
  let auth: AuthRegistryService | null = null
  let authSubscription: Subscription | undefined
  let kclManager: KclLspEditor | null = null
  let runtime: LspRuntime | null = null
  let codeMirrorAttachment: CodeMirrorAttachment | undefined
  let currentProjectSnapshot: ProjectSnapshot | null = null
  let currentFileSnapshot: FileSnapshot | null = null

  const service: LspService = {
    attachKclManager: (manager) => {
      kclManager = manager
      ensureAuthSubscription()
      reconcileRuntime()

      return () => {
        if (kclManager !== manager) {
          return
        }

        detachCodeMirror()
        kclManager = null
        reconcileRuntime()
      }
    },
    onProjectClose: (file) => {
      const documentUri = filePathToUri(file?.path || PROJECT_ENTRYPOINT)
      forEachClient((client) => {
        client.textDocumentDidClose({
          textDocument: {
            uri: documentUri,
          },
        })
      })
      kclManager?.clearGlobalHistory()
      currentProjectSnapshot = null
      currentFileSnapshot = null
    },
    onProjectOpen: (project, file) => {
      currentProjectSnapshot = { project, file }
      currentFileSnapshot = {
        filePath: file?.path || null,
        projectPath: project?.path || null,
      }
      notifyProjectOpen(project, file)
      reattachCodeMirror()
    },
    onFileOpen: (filePath, projectPath) => {
      currentFileSnapshot = { filePath, projectPath }
      const path = filePath || PROJECT_ENTRYPOINT
      forEachClient((client) => {
        client.textDocumentDidOpen({
          textDocument: {
            uri: filePathToUri(path),
            languageId: 'kcl',
            version: 1,
            text: documentTextFor(path),
          },
        })
      })
    },
    onFileClose: (filePath) => {
      const documentUri = filePathToUri(filePath || PROJECT_ENTRYPOINT)
      forEachClient((client) => {
        client.textDocumentDidClose({
          textDocument: {
            uri: documentUri,
          },
        })
      })
    },
    onFileCreate: (file) => {
      const documentUri = filePathToUri(file.path)
      forEachClient((client) => {
        client.workspaceDidCreateFiles({
          files: [
            {
              uri: documentUri,
            },
          ],
        })
      })
    },
    onFileRename: (oldFile, newFile) => {
      const oldUri = filePathToUri(oldFile.path)
      const newUri = filePathToUri(newFile.path)
      forEachClient((client) => {
        client.workspaceDidRenameFiles({
          files: [
            {
              oldUri,
              newUri,
            },
          ],
        })
      })
    },
    onFileDelete: (file) => {
      const documentUri = filePathToUri(file.path)
      forEachClient((client) => {
        client.workspaceDidDeleteFiles({
          files: [
            {
              uri: documentUri,
            },
          ],
        })
      })
    },
  }

  function ensureAuthSubscription() {
    if (auth) {
      return
    }

    auth = getAuth()
    authSubscription = auth.actor.subscribe(() => {
      reconcileRuntime()
    })
  }

  function reconcileRuntime() {
    const token = getAuthToken()
    if (!kclManager || !token || !canStartWorkerRuntime()) {
      stopRuntime()
      return
    }

    if (runtime?.token === token) {
      return
    }

    stopRuntime()
    startRuntime(token)
  }

  function canStartWorkerRuntime() {
    // Vitest's happy-dom environment does not provide the Worker runtime that
    // Vite's worker wrapper constructs.
    return typeof globalThis.Worker !== 'undefined'
  }

  function startRuntime(token: string) {
    const lspWorker = new KclLspWorker({ name: LspWorker.Kcl })
    const fromServer = FromServer.create()
    if (err(fromServer)) {
      lspWorker.terminate()
      return
    }

    const intoServer = new IntoServer(LspWorker.Kcl, lspWorker)
    const nextRuntime: LspRuntime = {
      token,
      worker: lspWorker,
      client: new LanguageServerClient({
        name: LspWorker.Kcl,
        fromServer,
        intoServer,
        initializedCallback: () => {
          if (runtime !== nextRuntime) {
            return
          }

          nextRuntime.ready = true
          replayCurrentProjectState()
          reattachCodeMirror()
        },
      }),
      ready: false,
    }

    lspWorker.onmessage = (event) => {
      fromServer.add(event.data)
    }

    const initEvent: KclWorkerOptions = {
      wasmUrl: wasmUrl(),
      token,
      apiBaseUrl: withAPIBaseURL(''),
    }

    lspWorker.postMessage({
      worker: LspWorker.Kcl,
      eventType: LspWorkerEventType.Init,
      eventData: initEvent,
    })

    runtime = nextRuntime
  }

  function stopRuntime() {
    detachCodeMirror()
    runtime?.client.close()
    runtime?.worker.terminate()
    runtime = null
  }

  function reattachCodeMirror() {
    if (!runtime?.ready || !kclManager) {
      return
    }

    // The attachment wires one editor to one client for one document, so it only
    // has to be rebuilt when one of those three changes — a swapped-in editor, a
    // language server runtime restarted underneath us, or a file switch.
    // Rebuilding it otherwise costs the editor a visible flash of unhighlighted
    // code.
    const documentPath = getKclLspDocumentPath(kclManager)
    if (
      codeMirrorAttachment?.editor === kclManager &&
      codeMirrorAttachment.client === runtime.client &&
      codeMirrorAttachment.documentPath === documentPath
    ) {
      return
    }

    detachCodeMirror()
    codeMirrorAttachment = {
      dispose: attachKclLspToCodeMirror(kclManager, runtime.client),
      editor: kclManager,
      client: runtime.client,
      documentPath,
    }
  }

  function detachCodeMirror() {
    codeMirrorAttachment?.dispose()
    codeMirrorAttachment = undefined
  }

  function replayCurrentProjectState() {
    if (currentProjectSnapshot) {
      notifyProjectOpen(
        currentProjectSnapshot.project,
        currentProjectSnapshot.file
      )
      return
    }

    if (currentFileSnapshot) {
      service.onFileOpen(
        currentFileSnapshot.filePath,
        currentFileSnapshot.projectPath
      )
    }
  }

  function notifyProjectOpen(
    project: ProjectSnapshot['project'],
    file: FileEntry | null
  ) {
    const projectName = project?.name || 'ProjectRoot'
    const workspaceFolder: LSP.WorkspaceFolder = {
      uri: project?.path ? filePathToUri(project.path) : 'file://',
      name: projectName,
    }

    forEachClient((client) => {
      client.workspaceDidChangeWorkspaceFolders([workspaceFolder], [])
    })

    if (!file) {
      return
    }

    const path = file.path || PROJECT_ENTRYPOINT
    forEachClient((client) => {
      client.textDocumentDidOpen({
        textDocument: {
          uri: filePathToUri(path),
          languageId: 'kcl',
          version: 1,
          text: documentTextFor(path),
        },
      })
    })
  }

  /**
   * The text to announce a document with. `didOpen` is a full-text sync on the
   * server, so announcing a document the editor already holds as empty wipes the
   * server's copy of it: diagnostics, folding ranges and semantic tokens all
   * come back describing an empty file until something re-sends the real text.
   */
  function documentTextFor(path: string) {
    if (!kclManager || getKclLspDocumentPath(kclManager) !== path) {
      return ''
    }

    return kclManager.editorView.state.doc.toString()
  }

  function forEachClient(callback: (client: LanguageServerClient) => void) {
    if (!runtime?.ready) {
      return
    }

    callback(runtime.client)
  }

  function getAuthToken() {
    const token = auth?.actor.getSnapshot().context.token
    return token && token !== '' ? token : null
  }

  return {
    service,
    dispose: () => {
      authSubscription?.unsubscribe()
      authSubscription = undefined
      auth = null
      stopRuntime()
      kclManager = null
    },
  }
}

function filePathToUri(filePath: string): string {
  return URI.file(filePath).toString()
}
