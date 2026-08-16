import {
  FromServer,
  IntoServer,
  LanguageServerClient,
  LspWorkerEventType,
} from '@kittycad/codemirror-lsp-client'
import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import { wasmUrl } from '@src/lang/wasmUtils'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import {
  kclRuntimeFlagsEqual,
  kclRuntimeFlagsFromUserFeatures,
  waitForSettledKclRuntimeFlags,
} from '@src/lib/kclRuntimeFlags'
import type { FileEntry } from '@src/lib/project'
import { err, reportRejection } from '@src/lib/trap'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { attachKclLspToCodeMirror } from '@src/lang/lsp/codeMirror'
import type { LspService } from '@src/lang/lsp/registry/contract'
import type { KclLspEditor } from '@src/lang/lsp/types'
import type { KclWorkerOptions } from '@src/lang/lsp/workerTypes'
import { LspWorker } from '@src/lang/lsp/workerTypes'
import KclLspWorker from '@src/lang/lsp/worker.ts?worker'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'
import type * as LSP from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import type { Subscription } from 'xstate'

type LspRuntime = {
  token: string
  worker: globalThis.Worker
  client: LanguageServerClient
  ready: boolean
  /** The flags the worker was initialized with; null until Init is posted. */
  kclRuntimeFlags: KclRuntimeFlags | null
}

type ProjectSnapshot = {
  project: { name: string | null; path: string | null } | null
  file: FileEntry | null
}

type FileSnapshot = {
  filePath: string | null
  projectPath: string | null
}

type CreateLspServiceOptions = {
  getAuth: () => AuthRegistryService
  getUserFeatures: () => UserFeaturesRegistryService
}

export function createLspService({
  getAuth,
  getUserFeatures,
}: CreateLspServiceOptions): {
  service: LspService
  dispose: () => void
} {
  let auth: AuthRegistryService | null = null
  let authSubscription: Subscription | undefined
  let userFeatures: UserFeaturesRegistryService | null = null
  let userFeaturesSubscription: Subscription | undefined
  let kclManager: KclLspEditor | null = null
  let runtime: LspRuntime | null = null
  let disposeCodeMirrorAttachment: (() => void) | undefined
  let currentProjectSnapshot: ProjectSnapshot | null = null
  let currentFileSnapshot: FileSnapshot | null = null

  const service: LspService = {
    attachKclManager: (manager) => {
      kclManager = manager
      ensureAuthSubscription()
      ensureUserFeaturesSubscription()
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
      const documentUri = filePathToUri(filePath || PROJECT_ENTRYPOINT)
      forEachClient((client) => {
        client.textDocumentDidOpen({
          textDocument: {
            uri: documentUri,
            languageId: 'kcl',
            version: 1,
            text: '',
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

  function ensureUserFeaturesSubscription(): UserFeaturesRegistryService {
    if (userFeatures) {
      return userFeatures
    }

    const service = getUserFeatures()
    userFeatures = service
    userFeaturesSubscription = service.actor.subscribe(() => {
      reconcileRuntime()
    })
    return service
  }

  function reconcileRuntime() {
    const token = getAuthToken()
    if (!kclManager || !token || !canStartWorkerRuntime()) {
      stopRuntime()
      return
    }

    if (runtime?.token === token && !runtimeFlagsChanged()) {
      return
    }

    stopRuntime()
    startRuntime(token)
  }

  /**
   * True once the runtime was initialized with flags that no longer match the
   * current user features. Restarting the worker is the only way to apply
   * them: the LSP's ExecutorContext resolves the KCL executor from the flags
   * at construction time, inside lsp_run_kcl.
   */
  function runtimeFlagsChanged() {
    if (!runtime?.kclRuntimeFlags || !userFeatures) {
      return false
    }

    return !kclRuntimeFlagsEqual(
      runtime.kclRuntimeFlags,
      kclRuntimeFlagsFromUserFeatures(userFeatures)
    )
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
      kclRuntimeFlags: null,
    }

    lspWorker.onmessage = (event) => {
      fromServer.add(event.data)
    }

    runtime = nextRuntime

    const features = ensureUserFeaturesSubscription()
    void (async () => {
      // Don't Init until the user-features fetch settles: the flags shipped
      // here decide the worker's KCL executor and lexer. Client requests are
      // queued in the meantime, so the LSP just starts a moment later.
      const kclRuntimeFlags = await waitForSettledKclRuntimeFlags(features)
      if (runtime !== nextRuntime) {
        // The runtime was stopped or replaced while waiting.
        return
      }

      nextRuntime.kclRuntimeFlags = kclRuntimeFlags
      const initEvent: KclWorkerOptions = {
        wasmUrl: wasmUrl(),
        token,
        apiBaseUrl: withAPIBaseURL(''),
        kclRuntimeFlags,
      }

      lspWorker.postMessage({
        worker: LspWorker.Kcl,
        eventType: LspWorkerEventType.Init,
        eventData: initEvent,
      })
    })().catch(reportRejection)
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

    detachCodeMirror()
    disposeCodeMirrorAttachment = attachKclLspToCodeMirror(
      kclManager,
      runtime.client
    )
  }

  function detachCodeMirror() {
    disposeCodeMirrorAttachment?.()
    disposeCodeMirrorAttachment = undefined
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

    const documentUri = filePathToUri(file.path || PROJECT_ENTRYPOINT)
    forEachClient((client) => {
      client.textDocumentDidOpen({
        textDocument: {
          uri: documentUri,
          languageId: 'kcl',
          version: 1,
          text: '',
        },
      })
    })
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
      userFeaturesSubscription?.unsubscribe()
      userFeaturesSubscription = undefined
      userFeatures = null
      stopRuntime()
      kclManager = null
    },
  }
}

function filePathToUri(filePath: string): string {
  return URI.file(filePath).toString()
}
