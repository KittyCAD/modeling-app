import {
  FromServer,
  IntoServer,
  LanguageServerClient,
  LspWorkerEventType,
} from '@kittycad/codemirror-lsp-client'
import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import { createProjectLspExtension } from '@src/lang/lsp/codeMirror'
import { signal } from '@preact/signals-core'
import type {
  LspService,
  ProjectLanguageService,
  LspProject,
} from '@src/lang/lsp/registry/contract'
import KclLspWorker from '@src/lang/lsp/worker.ts?worker'
import type { KclWorkerOptions } from '@src/lang/lsp/workerTypes'
import { LspWorker } from '@src/lang/lsp/workerTypes'
import { wasmUrl } from '@src/lang/wasmUtils'
import {
  kclRuntimeFlagsEqual,
  kclRuntimeFlagsFromUserFeatures,
  waitForSettledKclRuntimeFlags,
} from '@src/lib/kclRuntimeFlags'
import { err, reportRejection } from '@src/lib/trap'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'
import { URI } from 'vscode-uri'
import type { Subscription } from 'xstate'

/** One authenticated worker, recreated when its construction-time flags change. */
type LspRuntime = {
  token: string
  worker: globalThis.Worker
  client: LanguageServerClient
  ready: boolean
  kclRuntimeFlags: KclRuntimeFlags
}

type PendingLspStartup = {
  token: string
  abortController: AbortController
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
  const sessions = new Set<ProjectLanguageService>()
  return {
    service: {
      createProjectSession: (project) => {
        const session = createProjectSession(
          project,
          { getAuth, getUserFeatures },
          () => sessions.delete(session)
        )
        sessions.add(session)
        return session
      },
    },
    dispose: () => {
      for (const session of sessions) session.dispose()
    },
  }
}

/** A project's worker outlives its editor plugins, and starts on the first mount. */
function createProjectSession(
  project: LspProject,
  { getAuth, getUserFeatures }: CreateLspServiceOptions,
  onDispose: () => void
): ProjectLanguageService {
  let auth: AuthRegistryService | null = null
  let authSubscription: Subscription | undefined
  let userFeatures: UserFeaturesRegistryService | null = null
  let userFeaturesSubscription: Subscription | undefined
  let runtime: LspRuntime | null = null
  let pendingStartup: PendingLspStartup | undefined
  const client = signal<LanguageServerClient | null>(null)
  let started = false
  let disposed = false

  const service: ProjectLanguageService = {
    editorExtension: (documentUri) =>
      createProjectLspExtension({
        documentUri,
        client,
        start: () => {
          if (disposed) return
          started = true
          ensureAuthSubscription()
          ensureUserFeaturesSubscription()
          reconcileRuntime()
        },
      }),
    onFileCreate: (path) =>
      forEachClient((client) =>
        client.workspaceDidCreateFiles({
          files: [{ uri: filePathToUri(path) }],
        })
      ),
    onFileRename: (oldPath, newPath) =>
      forEachClient((client) =>
        client.workspaceDidRenameFiles({
          files: [
            { oldUri: filePathToUri(oldPath), newUri: filePathToUri(newPath) },
          ],
        })
      ),
    onFileDelete: (path) =>
      forEachClient((client) =>
        client.workspaceDidDeleteFiles({
          files: [{ uri: filePathToUri(path) }],
        })
      ),
    dispose: () => {
      if (disposed) return
      disposed = true
      authSubscription?.unsubscribe()
      userFeaturesSubscription?.unsubscribe()
      stopRuntime()
      onDispose()
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
    if (disposed || !started || !token || !canStartWorkerRuntime()) {
      stopRuntime()
      return
    }

    if (runtime?.token === token && !runtimeFlagsChanged()) {
      return
    }

    if (pendingStartup?.token === token) {
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
    if (!runtime || !userFeatures) {
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
    const abortController = new AbortController()
    const nextStartup = { token, abortController }
    pendingStartup = nextStartup
    const features = ensureUserFeaturesSubscription()

    void (async () => {
      await waitForSettledKclRuntimeFlags(features, abortController.signal)
      if (pendingStartup !== nextStartup || abortController.signal.aborted) {
        return
      }

      pendingStartup = undefined
      createRuntime(token, kclRuntimeFlagsFromUserFeatures(features))
    })().catch((error) => {
      if (pendingStartup === nextStartup) {
        pendingStartup = undefined
      }
      reportRejection(error)
    })
  }

  function createRuntime(token: string, kclRuntimeFlags: KclRuntimeFlags) {
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
          nextRuntime.client.workspaceDidChangeWorkspaceFolders(
            [{ uri: filePathToUri(project.path), name: project.name }],
            []
          )
          client.value = nextRuntime.client
        },
      }),
      ready: false,
      kclRuntimeFlags,
    }

    lspWorker.onmessage = (event) => {
      fromServer.add(event.data)
    }

    runtime = nextRuntime
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
  }

  function stopRuntime() {
    pendingStartup?.abortController.abort()
    pendingStartup = undefined
    client.value = null
    runtime?.client.close()
    runtime?.worker.terminate()
    runtime = null
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

  return service
}

function filePathToUri(filePath: string): string {
  return URI.file(filePath).toString()
}
