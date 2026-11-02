import type { Feature } from '@kittycad/lib'
import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import { createLspService } from '@src/lang/lsp/service'
import type { ProjectLanguageService } from '@src/lang/lsp/registry/contract'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { URI } from 'vscode-uri'
import type * as RuntimeFlagsModule from '@src/lib/kclRuntimeFlags'
import {
  USER_FEATURES_SETTLE_TIMEOUT_MS,
  type UserFeaturesSettleSnapshot,
  UserFeaturesState,
} from '@src/machines/userFeaturesMachine'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TestRuntimeFlags = KclRuntimeFlags & {
  use_new_parser: 'Off'
  test_flag: 'Off' | 'On'
}

type MockWorker = {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
}

type MockClient = {
  close: ReturnType<typeof vi.fn>
  finishInitialize: () => void
  textDocumentDidClose: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>
  textDocumentDidOpen: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>
  workspaceDidChangeWorkspaceFolders: ReturnType<typeof vi.fn>
  workspaceDidCreateFiles: ReturnType<typeof vi.fn>
  workspaceDidDeleteFiles: ReturnType<typeof vi.fn>
  workspaceDidRenameFiles: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  clients: [] as MockClient[],
  runtimeFlags: undefined as TestRuntimeFlags | undefined,
  workers: [] as MockWorker[],
}))

vi.mock('@src/lib/kclRuntimeFlags', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeFlagsModule>()
  return {
    ...actual,
    // Inject a test-only flag to exercise payload changes while the parser is disabled.
    kclRuntimeFlagsFromUserFeatures: (
      ...args: Parameters<typeof actual.kclRuntimeFlagsFromUserFeatures>
    ) => mocks.runtimeFlags ?? actual.kclRuntimeFlagsFromUserFeatures(...args),
  }
})

vi.mock('@src/lang/lsp/kcl/language', () => ({
  kcl: (options: { documentUri: string; client: MockClient }) =>
    ViewPlugin.define((view) => {
      const uri = URI.file(options.documentUri).toString()
      options.client.textDocumentDidOpen({
        textDocument: { uri, text: view.state.doc.toString() },
      })
      return {
        destroy: () =>
          options.client.textDocumentDidClose({ textDocument: { uri } }),
      }
    }),
}))

vi.mock('@src/lang/wasmUtils', () => ({
  wasmUrl: () => '/kcl.wasm',
}))

vi.mock('@src/lang/lsp/worker.ts?worker', () => ({
  default: class {
    onmessage: ((event: MessageEvent) => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()

    constructor() {
      mocks.workers.push(this)
    }
  },
}))

vi.mock('@kittycad/codemirror-lsp-client', () => ({
  FromServer: {
    create: vi.fn(() => ({ add: vi.fn() })),
  },
  IntoServer: class {},
  LanguageServerClient: class {
    close = vi.fn()
    textDocumentDidClose = vi.fn()
    textDocumentDidOpen = vi.fn()
    workspaceDidChangeWorkspaceFolders = vi.fn()
    workspaceDidCreateFiles = vi.fn()
    workspaceDidDeleteFiles = vi.fn()
    workspaceDidRenameFiles = vi.fn()
    readonly finishInitialize: () => void

    constructor(options: { initializedCallback: () => void }) {
      this.finishInitialize = options.initializedCallback
      mocks.clients.push(this)
    }
  },
  LspWorkerEventType: {
    Call: 'call',
    Init: 'init',
  },
}))

function createAuth(initialToken = 'token-a') {
  let token = initialToken
  const listeners = new Set<() => void>()
  const actor = {
    getSnapshot: () => ({ context: { token } }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return { unsubscribe: () => listeners.delete(listener) }
    },
  }

  return {
    service: { actor } as unknown as AuthRegistryService,
    setToken: (nextToken: string) => {
      token = nextToken
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

function createUserFeatures(
  initialState: UserFeaturesState,
  initialFeatureIds: Set<Feature> = new Set()
) {
  let state = initialState
  let featureIds = initialFeatureIds
  let fetchedAt =
    initialState === UserFeaturesState.Ready ? new Date() : undefined
  const listeners = new Set<(snapshot: UserFeaturesSettleSnapshot) => void>()
  const snapshot = (): UserFeaturesSettleSnapshot => ({
    matches: (candidate) => candidate === state,
    context: { fetchedAt },
  })
  const actor = {
    getSnapshot: snapshot,
    subscribe: (listener: (snapshot: UserFeaturesSettleSnapshot) => void) => {
      listeners.add(listener)
      return { unsubscribe: () => listeners.delete(listener) }
    },
  }

  return {
    listenerCount: () => listeners.size,
    service: {
      actor,
      has: (featureFlagId: Feature, defaultValue: boolean) =>
        featureIds.has(featureFlagId) ? true : defaultValue,
    } as unknown as UserFeaturesRegistryService,
    update: (nextState: UserFeaturesState, nextFeatureIds: Set<Feature>) => {
      state = nextState
      featureIds = nextFeatureIds
      fetchedAt = nextState === UserFeaturesState.Ready ? new Date() : undefined
      for (const listener of listeners) {
        listener(snapshot())
      }
    },
  }
}

const views: EditorView[] = []
const factories: ReturnType<typeof createLspService>[] = []

function openEditor(
  session: ProjectLanguageService,
  path = '/project/main.kcl',
  text = 'current buffer'
) {
  const view = new EditorView({
    doc: text,
    extensions: session.editorExtension(URI.file(path).toString()),
  })
  views.push(view)
  return view
}

function attachService(options?: {
  auth?: ReturnType<typeof createAuth>
  features?: ReturnType<typeof createUserFeatures>
}) {
  const auth = options?.auth ?? createAuth()
  const features =
    options?.features ?? createUserFeatures(UserFeaturesState.Ready)
  const factory = createLspService({
    getAuth: () => auth.service,
    getUserFeatures: () => features.service,
  })
  factories.push(factory)
  const service = factory.service.createProjectSession({
    name: 'Project',
    path: '/project',
  })
  const view = openEditor(service)
  return {
    auth,
    features,
    lsp: { service, dispose: service.dispose },
    factory,
    view,
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

function initPayload(worker: MockWorker) {
  return worker.postMessage.mock.calls[0]?.[0]?.eventData
}

describe('LSP runtime feature flags', () => {
  beforeEach(() => {
    mocks.workers.length = 0
    mocks.clients.length = 0
    mocks.runtimeFlags = { use_new_parser: 'Off', test_flag: 'Off' }
    vi.clearAllMocks()
    vi.stubGlobal('Worker', class {})
  })

  afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
    for (const factory of factories.splice(0)) factory.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for settled flags before constructing and initializing the worker', async () => {
    const features = createUserFeatures(UserFeaturesState.Idle)
    attachService({ features })

    expect(mocks.workers).toHaveLength(0)
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()

    expect(mocks.workers).toHaveLength(1)
    expect(initPayload(mocks.workers[0])).toMatchObject({
      token: 'token-a',
      kclRuntimeFlags: {
        use_new_parser: 'Off',
      },
    })
  })

  it('cancels pending startup when disposed', async () => {
    const features = createUserFeatures(UserFeaturesState.Idle)
    const { lsp } = attachService({ features })

    expect(features.listenerCount()).toBe(2)
    lsp.dispose()
    expect(features.listenerCount()).toBe(0)

    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(0)
  })

  it('replaces pending startup when the token changes', async () => {
    const auth = createAuth()
    const features = createUserFeatures(UserFeaturesState.Idle)
    attachService({ auth, features })

    auth.setToken('token-b')
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()

    expect(mocks.workers).toHaveLength(1)
    expect(initPayload(mocks.workers[0])).toMatchObject({ token: 'token-b' })
  })

  it('restarts once for changed flags and not for unchanged flags', async () => {
    const features = createUserFeatures(UserFeaturesState.Ready)
    attachService({ features })
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)

    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)

    mocks.runtimeFlags = { use_new_parser: 'Off', test_flag: 'On' }
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(2)
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(initPayload(mocks.workers[1])).toMatchObject({
      kclRuntimeFlags: {
        use_new_parser: 'Off',
        test_flag: 'On',
      },
    })

    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(2)
  })

  it('shares one worker across editors and reopens their current buffers after restart', async () => {
    const { lsp, features } = attachService()
    const second = openEditor(
      lsp.service,
      '/project/second.kcl',
      'second buffer'
    )
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)
    mocks.clients[0].finishInitialize()
    await flushMicrotasks()
    expect(mocks.clients[0].textDocumentDidOpen).toHaveBeenCalledTimes(2)
    second.dispatch({
      changes: {
        from: 0,
        to: second.state.doc.length,
        insert: 'unsaved buffer',
      },
    })

    mocks.runtimeFlags = { use_new_parser: 'Off', test_flag: 'On' }
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    mocks.clients[1].finishInitialize()
    await flushMicrotasks()
    expect(
      mocks.clients[1].workspaceDidChangeWorkspaceFolders
    ).toHaveBeenCalledExactlyOnceWith(
      [{ name: 'Project', uri: 'file:///project' }],
      []
    )
    expect(mocks.clients[1].textDocumentDidOpen).toHaveBeenCalledTimes(2)
    expect(mocks.clients[1].textDocumentDidOpen).toHaveBeenCalledWith({
      textDocument: {
        uri: 'file:///project/second.kcl',
        text: 'unsaved buffer',
      },
    })
  })

  it('does not replay an editor closed before restart', async () => {
    const { lsp, features } = attachService()
    const second = openEditor(lsp.service, '/project/second.kcl')
    await flushMicrotasks()
    mocks.clients[0].finishInitialize()
    await flushMicrotasks()
    second.destroy()
    views.splice(views.indexOf(second), 1)
    expect(
      mocks.clients[0].textDocumentDidClose
    ).toHaveBeenCalledExactlyOnceWith({
      textDocument: { uri: 'file:///project/second.kcl' },
    })
    mocks.runtimeFlags = { use_new_parser: 'Off', test_flag: 'On' }
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    mocks.clients[1].finishInitialize()
    await flushMicrotasks()
    expect(
      mocks.clients[1].textDocumentDidOpen
    ).toHaveBeenCalledExactlyOnceWith({
      textDocument: { uri: 'file:///project/main.kcl', text: 'current buffer' },
    })
  })

  it('does not start for an editorless project and releases project resources', async () => {
    const { factory, lsp } = attachService()
    const other = factory.service.createProjectSession({
      name: 'Other',
      path: '/other',
    })
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)
    mocks.clients[0].finishInitialize()
    await flushMicrotasks()
    lsp.dispose()
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
    const view = openEditor(other, '/other/main.kcl')
    view.destroy()
    views.splice(views.indexOf(view), 1)
    other.dispose()
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)
  })

  it('ignores initialization callbacks from a disposed project', async () => {
    const { lsp } = attachService()
    await flushMicrotasks()
    lsp.dispose()
    mocks.clients[0].finishInitialize()
    await flushMicrotasks()
    expect(mocks.clients[0].textDocumentDidOpen).not.toHaveBeenCalled()
    expect(
      mocks.clients[0].workspaceDidChangeWorkspaceFolders
    ).not.toHaveBeenCalled()
  })

  it('isolates sessions when one project closes while another is open', async () => {
    const { factory, lsp } = attachService()
    const other = factory.service.createProjectSession({
      name: 'Other',
      path: '/other',
    })
    openEditor(other, '/other/main.kcl', 'other buffer')
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(2)
    mocks.clients[0].finishInitialize()
    mocks.clients[1].finishInitialize()
    await flushMicrotasks()
    lsp.dispose()
    await flushMicrotasks()
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(mocks.workers[1].terminate).not.toHaveBeenCalled()
    expect(mocks.clients[1].textDocumentDidClose).not.toHaveBeenCalled()
    other.onFileCreate('/other/new.kcl')
    expect(
      mocks.clients[1].workspaceDidCreateFiles
    ).toHaveBeenCalledExactlyOnceWith({
      files: [{ uri: 'file:///other/new.kcl' }],
    })
  })

  it('detaches documents on sign-out and reopens them after authentication', async () => {
    const { auth } = attachService()
    await flushMicrotasks()
    mocks.clients[0].finishInitialize()
    await flushMicrotasks()
    auth.setToken('')
    await flushMicrotasks()
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(mocks.clients[0].textDocumentDidClose).toHaveBeenCalledTimes(1)
    auth.setToken('token-b')
    await flushMicrotasks()
    expect(initPayload(mocks.workers[1])).toMatchObject({ token: 'token-b' })
    mocks.clients[1].finishInitialize()
    await flushMicrotasks()
    expect(
      mocks.clients[1].textDocumentDidOpen
    ).toHaveBeenCalledExactlyOnceWith({
      textDocument: { uri: 'file:///project/main.kcl', text: 'current buffer' },
    })
  })

  it('starts after timeout and restarts only when late flags differ', async () => {
    vi.useFakeTimers()
    const features = createUserFeatures(UserFeaturesState.Idle)
    attachService({ features })

    await vi.advanceTimersByTimeAsync(USER_FEATURES_SETTLE_TIMEOUT_MS)
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)
    expect(initPayload(mocks.workers[0])).toMatchObject({
      kclRuntimeFlags: {
        use_new_parser: 'Off',
      },
    })

    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)
    expect(mocks.workers[0].terminate).not.toHaveBeenCalled()

    mocks.runtimeFlags = { use_new_parser: 'Off', test_flag: 'On' }
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(2)
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)
  })
})
