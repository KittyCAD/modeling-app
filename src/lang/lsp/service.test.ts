import type { Feature } from '@kittycad/lib'
import type { KclRuntimeFlags } from '@rust/kcl-lib/bindings/KclRuntimeFlags'
import { createLspService } from '@src/lang/lsp/service'
import type { KclLspEditor } from '@src/lang/lsp/types'
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
  textDocumentDidClose: ReturnType<typeof vi.fn>
  textDocumentDidOpen: ReturnType<typeof vi.fn>
  workspaceDidChangeWorkspaceFolders: ReturnType<typeof vi.fn>
  workspaceDidCreateFiles: ReturnType<typeof vi.fn>
  workspaceDidDeleteFiles: ReturnType<typeof vi.fn>
  workspaceDidRenameFiles: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  attachKclLspToCodeMirror: vi.fn(() => vi.fn()),
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

vi.mock('@src/lang/lsp/codeMirror', () => ({
  attachKclLspToCodeMirror: mocks.attachKclLspToCodeMirror,
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

function createManager(path = '/project/main.kcl'): KclLspEditor {
  return {
    path,
    editorView: { dispatch: vi.fn() } as unknown as KclLspEditor['editorView'],
    clearGlobalHistory: vi.fn(),
  }
}

function attachService(options?: {
  auth?: ReturnType<typeof createAuth>
  features?: ReturnType<typeof createUserFeatures>
  manager?: KclLspEditor
  openProject?: boolean
}) {
  const auth = options?.auth ?? createAuth()
  const features =
    options?.features ?? createUserFeatures(UserFeaturesState.Ready)
  const manager = options?.manager ?? createManager()
  const lsp = createLspService({
    getAuth: () => auth.service,
    getUserFeatures: () => features.service,
  })
  lsp.service.attachKclManager(manager)
  if (options?.openProject !== false) {
    lsp.service.onProjectOpen(
      { name: 'Project', path: '/project' },
      { name: 'main.kcl', path: manager.path, children: [] }
    )
  }
  return { auth, features, lsp, manager }
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
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not start on authenticated Home, then replays the first opened project', async () => {
    const { auth, features, lsp } = attachService({
      manager: createManager(''),
      openProject: false,
    })
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(0)
    expect(mocks.attachKclLspToCodeMirror).not.toHaveBeenCalled()

    auth.setToken('token-b')
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(0)

    const manager = createManager()
    lsp.service.attachKclManager(manager)
    lsp.service.onProjectOpen(
      { name: 'Project', path: '/project' },
      { name: 'main.kcl', path: manager.path, children: [] }
    )
    lsp.service.onFileClose('/project/main.kcl', '/project')
    lsp.service.onFileOpen('/project/current.kcl', '/project')
    manager.path = '/project/current.kcl'
    await flushMicrotasks()

    expect(mocks.workers).toHaveLength(1)
    expect(initPayload(mocks.workers[0])).toMatchObject({ token: 'token-b' })
    mocks.clients[0].finishInitialize()
    expect(
      mocks.clients[0].workspaceDidChangeWorkspaceFolders
    ).toHaveBeenCalledWith([{ name: 'Project', uri: 'file:///project' }], [])
    expect(mocks.clients[0].textDocumentDidOpen).toHaveBeenCalledTimes(1)
    expect(mocks.clients[0].textDocumentDidOpen).toHaveBeenCalledWith({
      textDocument: expect.objectContaining({
        uri: 'file:///project/current.kcl',
      }),
    })
    expect(mocks.attachKclLspToCodeMirror).toHaveBeenCalledWith(
      manager,
      mocks.clients[0]
    )
    lsp.dispose()
  })

  it('cancels pending project startup on close and starts for a later file open', async () => {
    const features = createUserFeatures(UserFeaturesState.Idle)
    const { lsp } = attachService({ features })
    expect(features.listenerCount()).toBe(2)

    lsp.service.onProjectClose(null, '/project', false)
    expect(features.listenerCount()).toBe(1)
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(0)

    lsp.service.onFileOpen('/other/main.kcl', '/other')
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)
    mocks.clients[0].finishInitialize()
    expect(mocks.clients[0].textDocumentDidOpen).toHaveBeenCalledWith({
      textDocument: expect.objectContaining({ uri: 'file:///other/main.kcl' }),
    })
    lsp.dispose()
  })

  it('starts after project auth arrives and detaches its initialized editor on close', async () => {
    const auth = createAuth('')
    const { lsp } = attachService({ auth })
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(0)

    auth.setToken('token-b')
    await flushMicrotasks()
    mocks.clients[0].finishInitialize()
    const attachment = mocks.attachKclLspToCodeMirror.mock.results[0].value

    lsp.service.onProjectClose(
      { name: 'main.kcl', path: '/project/main.kcl', children: [] },
      '/project',
      false
    )
    expect(mocks.clients[0].textDocumentDidClose).toHaveBeenCalledWith({
      textDocument: { uri: 'file:///project/main.kcl' },
    })
    expect(attachment).toHaveBeenCalledTimes(1)
    expect(mocks.clients[0].close).toHaveBeenCalledTimes(1)
    expect(mocks.workers[0].terminate).toHaveBeenCalledTimes(1)

    auth.setToken('token-c')
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)
    lsp.dispose()
  })

  it('stops on project close and ignores a retired initialization after reopening', async () => {
    const { auth, features, lsp, manager } = attachService()
    await flushMicrotasks()
    const retiredClient = mocks.clients[0]
    const retiredWorker = mocks.workers[0]

    lsp.service.onProjectClose(null, '/project', false)
    expect(retiredClient.close).toHaveBeenCalledTimes(1)
    expect(retiredWorker.terminate).toHaveBeenCalledTimes(1)
    expect(manager.clearGlobalHistory).toHaveBeenCalledTimes(1)

    auth.setToken('token-b')
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    expect(mocks.workers).toHaveLength(1)

    lsp.service.onProjectOpen(
      { name: 'Other', path: '/other' },
      { name: 'main.kcl', path: '/other/main.kcl', children: [] }
    )
    await flushMicrotasks()
    retiredClient.finishInitialize()
    expect(retiredClient.textDocumentDidOpen).not.toHaveBeenCalled()
    expect(mocks.attachKclLspToCodeMirror).not.toHaveBeenCalled()

    mocks.clients[1].finishInitialize()
    expect(mocks.clients[1].textDocumentDidOpen).toHaveBeenCalledWith({
      textDocument: expect.objectContaining({ uri: 'file:///other/main.kcl' }),
    })
    expect(mocks.attachKclLspToCodeMirror).toHaveBeenCalledTimes(1)
    lsp.dispose()
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

  it('replays the workspace and latest file after a flag restart', async () => {
    const features = createUserFeatures(UserFeaturesState.Ready)
    const manager = createManager('/project/current.kcl')
    const { lsp } = attachService({ features, manager })
    await flushMicrotasks()
    mocks.clients[0].finishInitialize()

    lsp.service.onProjectOpen(
      { name: 'Project', path: '/project' },
      { name: 'main.kcl', path: '/project/main.kcl', children: [] }
    )
    lsp.service.onFileClose('/project/main.kcl', '/project')
    lsp.service.onFileOpen('/project/current.kcl', '/project')

    mocks.runtimeFlags = { use_new_parser: 'Off', test_flag: 'On' }
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    mocks.clients[1].finishInitialize()

    expect(
      mocks.clients[1].workspaceDidChangeWorkspaceFolders
    ).toHaveBeenCalledTimes(1)
    expect(mocks.clients[1].textDocumentDidOpen).toHaveBeenCalledTimes(1)
    expect(mocks.clients[1].textDocumentDidOpen).toHaveBeenCalledWith({
      textDocument: expect.objectContaining({
        uri: 'file:///project/current.kcl',
      }),
    })
  })

  it('does not replay a file that was closed before restart', async () => {
    const features = createUserFeatures(UserFeaturesState.Ready)
    const { lsp } = attachService({ features })
    await flushMicrotasks()
    mocks.clients[0].finishInitialize()

    lsp.service.onProjectOpen(
      { name: 'Project', path: '/project' },
      { name: 'main.kcl', path: '/project/main.kcl', children: [] }
    )
    lsp.service.onFileClose('/project/main.kcl', '/project')

    mocks.runtimeFlags = { use_new_parser: 'Off', test_flag: 'On' }
    features.update(UserFeaturesState.Ready, new Set())
    await flushMicrotasks()
    mocks.clients[1].finishInitialize()

    expect(
      mocks.clients[1].workspaceDidChangeWorkspaceFolders
    ).toHaveBeenCalledTimes(1)
    expect(mocks.clients[1].textDocumentDidOpen).not.toHaveBeenCalled()
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
