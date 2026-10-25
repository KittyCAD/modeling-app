import type * as KittycadLibModule from '@kittycad/lib'
import type * as UiComponentsModule from '@kittycad/ui-components'
import { signal, type Signal } from '@preact/signals-core'
import type { ZookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import type * as ZookeeperManagerMachineModule from '@src/lib/zookeeper/zookeeperManagerMachine'
import type { ZookeeperManagerActor } from '@src/lib/zookeeper/zookeeperManagerMachine'
import type { BulkFileWriteProgress } from '@src/machines/systemIO/utils'
import type * as SystemIOUtilsModule from '@src/machines/systemIO/utils'
import { S } from '@src/machines/utils'
import toast from 'react-hot-toast'
import { NIL as uuidNIL } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const managerMocks = vi.hoisted(() => ({
  create: vi.fn(),
  stop: vi.fn(),
}))

const projectFilesMocks = vi.hoisted(() => ({
  collect: vi.fn(),
}))

const billingMocks = vi.hoisted(() => ({
  getBillingInfo: vi.fn(),
  getUserSelf: vi.fn(),
}))

vi.mock('@kittycad/ui-components', async (importOriginal) => ({
  ...(await importOriginal<typeof UiComponentsModule>()),
  getBillingInfo: billingMocks.getBillingInfo,
}))

vi.mock('@kittycad/lib', async (importOriginal) => {
  const original = await importOriginal<typeof KittycadLibModule>()
  return {
    ...original,
    users: { ...original.users, get_user_self: billingMocks.getUserSelf },
  }
})

const workerMocks = vi.hoisted(() => ({
  histories: [] as Array<{
    dispose: ReturnType<typeof vi.fn>
    finishPending: ReturnType<typeof vi.fn>
    handleActorSnapshot: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
  }>,
  processors: [] as Array<{
    hasPendingRequests: boolean
    fileWriteProgress: Signal<BulkFileWriteProgress | undefined>
    onQueueIdle: () => void
    dispose: ReturnType<typeof vi.fn>
    handleActorSnapshot: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

vi.mock(
  '@src/lib/zookeeper/zookeeperManagerMachine',
  async (importOriginal) => ({
    ...(await importOriginal<typeof ZookeeperManagerMachineModule>()),
    createZookeeperManagerActor: managerMocks.create,
    stopZookeeperManagerActor: managerMocks.stop,
  })
)

vi.mock('@src/machines/systemIO/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof SystemIOUtilsModule>()),
  collectProjectFiles: projectFilesMocks.collect,
}))

vi.mock('@src/lib/zookeeper/registry/ZookeeperEditPatchHistory', () => ({
  ZookeeperEditPatchHistory: class MockZookeeperEditPatchHistory {
    readonly dispose = vi.fn()
    readonly finishPending = vi.fn()
    readonly handleActorSnapshot = vi.fn()
    readonly reset = vi.fn()

    constructor() {
      workerMocks.histories.push(this)
    }
  },
}))

vi.mock('@src/lib/zookeeper/registry/ZookeeperFileRequestProcessor', () => ({
  ZookeeperFileRequestProcessor: class MockZookeeperFileRequestProcessor {
    hasPendingRequests = false
    readonly fileWriteProgress = signal<BulkFileWriteProgress | undefined>(
      undefined
    )
    readonly onQueueIdle: () => void
    readonly dispose = vi.fn(async () => undefined)
    readonly handleActorSnapshot = vi.fn()
    readonly reset = vi.fn(async () => undefined)

    constructor(deps: { onQueueIdle: () => void }) {
      this.onQueueIdle = deps.onQueueIdle
      workerMocks.processors.push(this)
    }
  },
}))

import type { ZDSProject } from '@src/lib/projectSession'
import { BillingTransition } from '@src/lib/billing'
import type { Project } from '@src/lib/project'
import {
  createZookeeperSessionController,
  type ZookeeperSessionController,
  type ZookeeperSessionControllerDependencies,
} from '@src/lib/zookeeper/registry/controller'
import {
  ZookeeperManagerStates,
  ZookeeperManagerTransitions,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'

type TestState =
  | 'other'
  | 'await'
  | 'ready'
  | 'ready-await'
  | 'wait-for-continue-check'

type ActorSnapshot = ReturnType<ZookeeperManagerActor['getSnapshot']>
type SnapshotContext = ActorSnapshot['context']

function createSnapshot(
  state: TestState,
  context: Partial<SnapshotContext> = {}
): ActorSnapshot {
  return {
    context: {
      abruptlyClosed: false,
      awaitingResponse: false,
      conversation: undefined,
      conversationId: undefined,
      lastMessageId: undefined,
      lastMessageType: undefined,
      setupFailed: false,
      ...context,
    },
    matches: (expected: unknown) => {
      if (typeof expected === 'object' && expected !== null) {
        return state === 'ready-await'
      }
      if (expected === S.Await) {
        return state === 'await'
      }
      if (expected === ZookeeperManagerStates.Ready) {
        return state === 'ready' || state === 'ready-await'
      }
      if (expected === ZookeeperManagerStates.WaitForContinueCheck) {
        return state === 'wait-for-continue-check'
      }
      return false
    },
    value: state === 'await' ? S.Await : state,
  } as ActorSnapshot
}

class TestActor {
  private listeners = new Set<(snapshot: ActorSnapshot) => void>()
  private snapshot = createSnapshot('other')

  readonly send = vi.fn()

  get listenerCount() {
    return this.listeners.size
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: (snapshot: ActorSnapshot) => void) => {
    this.listeners.add(listener)
    return {
      unsubscribe: () => {
        this.listeners.delete(listener)
      },
    }
  }

  setSnapshot(state: TestState, context: Partial<SnapshotContext> = {}) {
    this.snapshot = createSnapshot(state, context)
  }

  emit(state: TestState, context: Partial<SnapshotContext> = {}) {
    this.setSnapshot(state, context)
    for (const listener of [...this.listeners]) {
      listener(this.snapshot)
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const projectId = '24d8709c-8d07-4855-9357-f20d7d35a499'
const projectPath = '/projects/bracket'
const interruptedConversation = {
  exchanges: [
    {
      request: { type: 'user', content: 'finish the bracket' },
      responses: [],
      deltasAggregated: '',
    },
  ],
} as SnapshotContext['conversation']

function createHarness({
  actorState = 'other',
  actorContext,
  apiToken = 'initial-token',
  initialProjectId = projectId,
  storeGet = Promise.resolve(undefined),
}: {
  actorState?: TestState
  actorContext?: Partial<SnapshotContext>
  apiToken?: string
  initialProjectId?: string | undefined
  storeGet?: Promise<string | undefined>
} = {}) {
  const actor = new TestActor()
  actor.setSnapshot(actorState, actorContext)
  managerMocks.create.mockReturnValue(actor)

  const billingSend = vi.fn()
  const conversationStore: ZookeeperConversationStore = {
    deleteProjectConversationId: vi.fn().mockResolvedValue(undefined),
    getProjectConversationId: vi.fn().mockReturnValue(storeGet),
    saveProjectConversationId: vi.fn().mockResolvedValue(undefined),
  }
  const project: Project = {
    children: [],
    default_file: `${projectPath}/main.kcl`,
    directory_count: 0,
    kcl_file_count: 1,
    metadata: null,
    name: 'bracket',
    path: projectPath,
    projectId: initialProjectId,
    readWriteAccess: true,
  }
  const loaderFile = {
    children: [],
    name: 'main.kcl',
    path: `${projectPath}/main.kcl`,
  }
  const kclManager = {
    artifactGraph: new Map(),
    code: 'cube = startSketchOn(XY)',
    engineCommandManager: {
      apiCallId: 'engine-call-id',
      modelingSend: vi.fn(),
    },
    execState: { filenames: {} },
    modelingState: { context: { selectionRanges: null } },
    path: loaderFile.path,
    wasmInstancePromise: Promise.resolve({}),
    get wasmInstance(): never {
      throw new Error('Attempted to get wasmInstance before initialization')
    },
    zookeeperHistoryRecordingInProgress: false,
  }
  const executingEditor = signal<typeof kclManager | undefined>(kclManager)
  const zdsProject = {
    executingEditor,
    executingFileEntry: signal(loaderFile),
    projectIORefSignal: signal(project),
  } as unknown as ZDSProject
  const projectSignal = signal<ZDSProject | undefined>(zdsProject)
  const dependencies = {
    apiToken,
    billing: { send: billingSend },
    conversationStore,
    fileOperations: {
      readFile: vi.fn(async () => new Uint8Array()),
    },
    kclManager,
    project: projectSignal,
    projectId: initialProjectId,
    projectPath,
    systemIO: { actor: {} },
  } as unknown as ZookeeperSessionControllerDependencies
  const controller = createZookeeperSessionController(dependencies)
  activeControllers.add(controller)

  return {
    actor,
    billingSend,
    controller,
    conversationStore,
    executingEditor,
    kclManager,
    project,
    projectSignal,
    zdsProject,
  }
}

function sentEvents(actor: TestActor, type: string) {
  return actor.send.mock.calls
    .map(([event]) => event)
    .filter((event) => event.type === type)
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

const activeControllers = new Set<ZookeeperSessionController>()
let online = true

describe('Zookeeper session controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workerMocks.histories.length = 0
    workerMocks.processors.length = 0
    projectFilesMocks.collect.mockResolvedValue([])
    billingMocks.getBillingInfo.mockReset().mockResolvedValue({
      balance: 10,
      allowance: 10,
      isOrg: false,
      hasSubscription: false,
    })
    billingMocks.getUserSelf
      .mockReset()
      .mockResolvedValue({ allow_pay_as_you_go: false })
    online = true
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online)
  })

  afterEach(async () => {
    await Promise.all(
      Array.from(activeControllers, (controller) => controller.dispose())
    )
    activeControllers.clear()
    zookeeperPromptRunningSignal.value = false
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('owns billing transitions and auth rotation without a mounted pane', () => {
    const { actor, billingSend, controller, conversationStore } =
      createHarness()

    actor.emit('other', {
      awaitingResponse: true,
      conversationId: 'conversation-id',
    })
    controller.updateAuthToken('rotated-token')
    actor.emit('other', { awaitingResponse: false })

    expect(managerMocks.create).toHaveBeenCalledOnce()
    expect(managerMocks.create).toHaveBeenCalledWith('initial-token')
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.AuthTokenChanged)
    ).toEqual([
      {
        type: ZookeeperManagerTransitions.AuthTokenChanged,
        apiToken: 'rotated-token',
      },
    ])
    expect(controller.actor).toBe(actor)
    expect(conversationStore.saveProjectConversationId).toHaveBeenCalledWith({
      projectId,
      conversationId: 'conversation-id',
    })
    expect(billingSend.mock.calls.map(([event]) => event)).toEqual([
      { type: BillingTransition.UsageStarted },
      { type: BillingTransition.UsageEnded },
      { type: BillingTransition.Update, apiToken: 'rotated-token' },
    ])
  })

  it('waits for a fresh balance and preserves a blocked queued prompt', async () => {
    const balance = deferred<{
      balance: number
      isOrg: boolean
      hasSubscription: boolean
    }>()
    billingMocks.getBillingInfo.mockReturnValueOnce(balance.promise)
    const { actor, controller } = createHarness({ actorState: 'ready-await' })
    controller.sendOrQueue('keep this prompt', undefined, [])
    await vi.waitFor(() =>
      expect(billingMocks.getBillingInfo).toHaveBeenCalledOnce()
    )
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(0)

    balance.resolve({ balance: 0, isOrg: false, hasSubscription: false })
    await vi.waitFor(() =>
      expect(controller.billingWarning.value?.balance).toBe(0)
    )
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(0)
    expect(controller.queue.value.map((message) => message.text)).toEqual([
      'keep this prompt',
    ])
    expect(billingMocks.getBillingInfo).toHaveBeenCalledOnce()
  })

  it('checks the returned balance before sending the next queued prompt', async () => {
    const { actor, controller } = createHarness({ actorState: 'ready-await' })
    controller.sendOrQueue('first prompt', undefined, [])
    await vi.waitFor(() =>
      expect(
        sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
      ).toHaveLength(1)
    )
    actor.emit('other', { awaitingResponse: true })
    controller.sendOrQueue('second prompt', undefined, [])
    billingMocks.getBillingInfo.mockResolvedValue({
      balance: 0,
      isOrg: false,
      hasSubscription: false,
    })
    actor.emit('ready-await', { awaitingResponse: false })

    await vi.waitFor(() =>
      expect(controller.billingWarning.value?.balance).toBe(0)
    )
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(1)
    expect(controller.queue.value.map((message) => message.text)).toEqual([
      'second prompt',
    ])
  })

  it.each([
    { balance: Number.POSITIVE_INFINITY, isOrg: false, allowPayg: false },
    { balance: 0, isOrg: false, allowPayg: true },
    { balance: 0, isOrg: true, allowPayg: false },
  ])(
    'preserves paid, pay-as-you-go and organization access: %o',
    async ({ balance, isOrg, allowPayg }) => {
      billingMocks.getBillingInfo.mockResolvedValue({
        balance,
        isOrg,
        hasSubscription: true,
      })
      billingMocks.getUserSelf.mockResolvedValue({
        allow_pay_as_you_go: allowPayg,
      })
      const { actor, controller } = createHarness({ actorState: 'ready-await' })
      controller.sendOrQueue('paid prompt', undefined, [])
      await vi.waitFor(() =>
        expect(
          sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
        ).toHaveLength(1)
      )
      expect(controller.billingWarning.value).toBeUndefined()
    }
  )

  it('pauses submission when the balance service fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notification = vi.spyOn(toast, 'error')
    billingMocks.getBillingInfo.mockRejectedValueOnce(
      new Error('Billing unavailable')
    )
    const { actor, controller } = createHarness({ actorState: 'ready-await' })
    controller.sendOrQueue('retry this prompt', undefined, [])
    await vi.waitFor(() => expect(notification).toHaveBeenCalled())
    await flushPromises()
    expect(billingMocks.getBillingInfo).toHaveBeenCalledOnce()
    expect(controller.queue.value).toHaveLength(1)
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(0)
  })

  it('does not resume an interrupted turn without credits', async () => {
    billingMocks.getBillingInfo.mockResolvedValue({
      balance: 0,
      isOrg: false,
      hasSubscription: false,
    })
    const { actor, controller } = createHarness()
    actor.emit('wait-for-continue-check', {
      conversation: interruptedConversation,
    })
    controller.resumeInterruptedTurn()
    await vi.waitFor(() =>
      expect(controller.billingWarning.value?.balance).toBe(0)
    )
    expect(
      sentEvents(actor, ZookeeperManagerStates.ContinueCheck)
    ).toHaveLength(0)
  })

  it('ignores an exhausted balance returned after disposal', async () => {
    const balance = deferred<{
      balance: number
      isOrg: boolean
      hasSubscription: boolean
    }>()
    billingMocks.getBillingInfo.mockReturnValueOnce(balance.promise)
    const { actor, controller } = createHarness({ actorState: 'ready-await' })
    controller.sendOrQueue('old prompt', undefined, [])
    await vi.waitFor(() =>
      expect(billingMocks.getBillingInfo).toHaveBeenCalledOnce()
    )
    await controller.dispose()
    balance.resolve({ balance: 0, isOrg: false, hasSubscription: false })
    await flushPromises()
    expect(controller.billingWarning.value).toBeUndefined()
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(0)
  })

  it.each([
    {
      errorMessage: 'Failed to update Zookeeper history.',
      getWorker: () => workerMocks.histories[0],
    },
    {
      errorMessage: 'Failed to process Zookeeper file updates.',
      getWorker: () => workerMocks.processors[0],
    },
  ])(
    'continues snapshot reconciliation when a worker fails',
    async ({ errorMessage, getWorker }) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const { actor, billingSend, controller } = createHarness()

      actor.emit('other', { awaitingResponse: true })
      controller.sendOrQueue('send after worker failure', undefined, [])
      getWorker()?.handleActorSnapshot.mockImplementationOnce(() => {
        throw new Error('worker failed')
      })

      actor.emit('ready-await', { awaitingResponse: false })

      expect(consoleError).toHaveBeenCalledWith(errorMessage, expect.any(Error))
      expect(billingSend).toHaveBeenCalledWith({
        type: BillingTransition.UsageEnded,
      })
      expect(zookeeperPromptRunningSignal.value).toBe(false)
      await vi.waitFor(() => {
        expect(
          sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
        ).toHaveLength(1)
      })
    }
  )

  it('submits a queued prompt when the persistent actor becomes ready', async () => {
    const { actor, controller, kclManager, project } = createHarness({
      actorContext: { awaitingResponse: true },
    })
    const attachment = new File(['notes'], 'notes.txt')

    controller.sendOrQueue('add two holes', undefined, [attachment])
    expect(controller.queue.value).toHaveLength(1)

    actor.emit('ready-await', { awaitingResponse: false })

    await vi.waitFor(() => {
      expect(
        sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
      ).toHaveLength(1)
    })
    expect(controller.queue.value).toHaveLength(0)
    expect(projectFilesMocks.collect).toHaveBeenCalledWith({
      fileNames: kclManager.execState.filenames,
      fileOperations: expect.objectContaining({
        readFile: expect.any(Function),
      }),
      projectContext: project,
      selectedFileContents: kclManager.code,
      selectedFilePath: kclManager.path,
    })
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)[0]
    ).toMatchObject({
      additionalFiles: [attachment],
      prompt: 'add two holes',
      projectFiles: [],
      type: ZookeeperManagerTransitions.MessageSend,
    })
  })

  it('updates one bottom-center progress notification without a mounted pane', () => {
    const loading = vi
      .spyOn(toast, 'loading')
      .mockReturnValue('file-write-toast')
    const dismiss = vi.spyOn(toast, 'dismiss')
    createHarness()
    const processor = workerMocks.processors.at(-1)!

    processor.fileWriteProgress.value = { written: 0, total: 25 }
    expect(loading).toHaveBeenLastCalledWith('0 of 25 files written', {
      id: expect.any(String),
      position: 'bottom-center',
    })
    const toastId = loading.mock.calls[0][1]?.id
    processor.fileWriteProgress.value = { written: 12, total: 25 }
    expect(loading).toHaveBeenLastCalledWith('12 of 25 files written', {
      id: toastId,
      position: 'bottom-center',
    })
    processor.fileWriteProgress.value = undefined
    expect(dismiss).toHaveBeenLastCalledWith(toastId)
  })

  it('dismisses progress on session disposal and ignores subsequent updates', async () => {
    const loading = vi
      .spyOn(toast, 'loading')
      .mockReturnValue('file-write-toast')
    const dismiss = vi.spyOn(toast, 'dismiss')
    const { controller } = createHarness()
    const processor = workerMocks.processors.at(-1)!
    processor.fileWriteProgress.value = { written: 1, total: 25 }
    const toastId = loading.mock.calls[0][1]?.id

    await controller.dispose()
    expect(dismiss).toHaveBeenLastCalledWith(toastId)
    loading.mockClear()
    processor.fileWriteProgress.value = { written: 2, total: 25 }
    expect(loading).not.toHaveBeenCalled()
  })

  it('waits for file edits and editor synchronization before collecting the next prompt', async () => {
    const { actor, controller } = createHarness({ actorState: 'ready-await' })
    const processor = workerMocks.processors.at(-1)!
    processor.hasPendingRequests = true
    controller.sendOrQueue('use the new files', undefined, [])
    actor.emit('ready-await', { awaitingResponse: false })
    await flushPromises()
    expect(projectFilesMocks.collect).not.toHaveBeenCalled()
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(0)
    expect(controller.queue.value).toHaveLength(1)

    processor.hasPendingRequests = false
    processor.onQueueIdle()
    await vi.waitFor(() => {
      expect(
        sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
      ).toHaveLength(1)
    })
    expect(controller.queue.value).toHaveLength(0)
  })

  it('retains a prompt through a same-project editor readiness gap', async () => {
    const { actor, controller, executingEditor, kclManager } = createHarness({
      actorState: 'ready-await',
    })

    executingEditor.value = undefined
    controller.sendOrQueue('add a mounting hole', undefined, [])

    expect(controller.queue.value).toHaveLength(1)
    expect(projectFilesMocks.collect).not.toHaveBeenCalled()

    executingEditor.value = kclManager

    await vi.waitFor(() => {
      expect(
        sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
      ).toHaveLength(1)
    })
    expect(controller.queue.value).toHaveLength(0)
  })

  it('does not submit a queued prompt removed during project collection', async () => {
    const collectedFiles = deferred<[]>()
    projectFilesMocks.collect.mockReturnValueOnce(collectedFiles.promise)
    const { actor, controller } = createHarness({
      actorContext: { awaitingResponse: true },
    })

    controller.sendOrQueue('remove this prompt', undefined, [])
    const queuedMessage = controller.queue.value[0]
    if (!queuedMessage) {
      throw new Error('Expected the prompt to be queued')
    }
    actor.emit('ready-await', { awaitingResponse: false })
    expect(projectFilesMocks.collect).toHaveBeenCalledOnce()

    controller.removeQueued(queuedMessage.id)
    collectedFiles.resolve([])
    await flushPromises()

    expect(controller.queue.value).toHaveLength(0)
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(0)
  })

  it('waits for the exact prompt-ready actor state', async () => {
    const { actor, controller } = createHarness({ actorState: 'ready' })

    controller.sendOrQueue('wait for request await', undefined, [])

    expect(controller.queue.value).toHaveLength(1)
    expect(projectFilesMocks.collect).not.toHaveBeenCalled()

    actor.emit('ready-await')

    await vi.waitFor(() => {
      expect(
        sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
      ).toHaveLength(1)
    })
    expect(controller.queue.value).toHaveLength(0)
  })

  it('keeps rapid prompts in submission order', async () => {
    const firstCollection = deferred<[]>()
    const secondCollection = deferred<[]>()
    projectFilesMocks.collect
      .mockReturnValueOnce(firstCollection.promise)
      .mockReturnValueOnce(secondCollection.promise)
    const { actor, controller } = createHarness({
      actorState: 'ready-await',
    })

    controller.sendOrQueue('first prompt', undefined, [])
    controller.sendOrQueue('second prompt', undefined, [])

    expect(projectFilesMocks.collect).toHaveBeenCalledOnce()
    expect(controller.queue.value.map(({ text }) => text)).toEqual([
      'first prompt',
      'second prompt',
    ])

    firstCollection.resolve([])
    await vi.waitFor(() => {
      expect(projectFilesMocks.collect).toHaveBeenCalledTimes(2)
    })
    secondCollection.resolve([])
    await vi.waitFor(() => {
      expect(
        sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
      ).toHaveLength(2)
    })

    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend).map(
        ({ prompt }) => prompt
      )
    ).toEqual(['first prompt', 'second prompt'])
  })

  it('recollects project files when editor code changes during collection', async () => {
    const firstCollection = deferred<[]>()
    projectFilesMocks.collect.mockReturnValueOnce(firstCollection.promise)
    const { actor, controller, kclManager } = createHarness({
      actorState: 'ready-await',
    })

    controller.sendOrQueue('use the current code', undefined, [])
    kclManager.code = 'updated code'
    firstCollection.resolve([])

    await vi.waitFor(() => {
      expect(projectFilesMocks.collect).toHaveBeenCalledTimes(2)
      expect(
        sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
      ).toHaveLength(1)
    })
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)[0]
        ?.fileSelectedDuringPrompting.content
    ).toBe('updated code')
  })

  it('waits for the saved conversation lookup and for the browser to be online', async () => {
    online = false
    const lookup = deferred<string | undefined>()
    const { actor } = createHarness({
      actorState: 'ready-await',
      storeGet: lookup.promise,
    })

    expect(actor.send).toHaveBeenCalledWith({
      type: ZookeeperManagerTransitions.NetworkOffline,
    })
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toHaveLength(0)

    lookup.resolve('saved-conversation')
    await flushPromises()

    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toHaveLength(0)

    online = true
    window.dispatchEvent(new Event('online'))

    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toEqual([
      expect.objectContaining({
        conversationId: 'saved-conversation',
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      }),
    ])
  })

  it('does not connect to a stored nil conversation', async () => {
    const { actor } = createHarness({
      actorState: 'ready-await',
      storeGet: Promise.resolve(uuidNIL),
    })

    await flushPromises()

    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toHaveLength(0)
  })

  it('starts without a saved conversation when its lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const lookup = deferred<string | undefined>()
    const { actor, controller } = createHarness({
      actorState: 'ready-await',
      storeGet: lookup.promise,
    })
    lookup.reject(new Error('Cannot read project.toml'))
    await flushPromises()
    expect(controller.showManualConnect.value).toBe(false)
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toEqual([expect.objectContaining({ conversationId: undefined })])
    consoleError.mockRestore()
  })

  it('does not repeat setup while the actor waits for auth hydration', async () => {
    const { actor } = createHarness({
      actorState: 'ready-await',
      actorContext: {
        cachedSetup: {},
      },
    })

    await flushPromises()

    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toHaveLength(0)
  })

  it('allows a manual reconnect after setup reached a terminal error', () => {
    const { actor, controller } = createHarness({
      actorContext: {
        cachedSetup: {},
        conversationId: 'active-conversation',
      },
      initialProjectId: undefined,
    })

    controller.reconnect()

    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toEqual([
      expect.objectContaining({
        conversationId: 'active-conversation',
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      }),
    ])
  })

  it('refreshes billing access before reconnecting', () => {
    const { actor, billingSend, controller } = createHarness({
      actorContext: { conversationId: 'active-conversation' },
      initialProjectId: undefined,
    })

    controller.checkBillingAccess()

    expect(billingSend).toHaveBeenCalledWith({
      type: BillingTransition.Update,
      apiToken: 'initial-token',
    })
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toHaveLength(1)
  })

  it('reconnects abrupt closures after a delay and supports manual reconnect', () => {
    vi.useFakeTimers()
    const { actor, controller } = createHarness({
      actorContext: { conversationId: 'active-conversation' },
      initialProjectId: undefined,
    })

    actor.emit('other', {
      abruptlyClosed: true,
      conversationId: 'active-conversation',
    })
    vi.advanceTimersByTime(2999)
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toHaveLength(1)

    online = false
    window.dispatchEvent(new Event('offline'))
    expect(controller.showManualConnect.value).toBe(true)

    controller.reconnect()

    expect(controller.showManualConnect.value).toBe(false)
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toHaveLength(2)
  })

  it('deletes persisted state before closing and starts one fresh conversation', async () => {
    const lookup = deferred<string | undefined>()
    const deletion = deferred<undefined>()
    const { actor, controller, conversationStore } = createHarness({
      actorContext: { awaitingResponse: true },
      storeGet: lookup.promise,
    })
    vi.mocked(
      conversationStore.deleteProjectConversationId
    ).mockReturnValueOnce(deletion.promise)
    controller.sendOrQueue('queued before clear', undefined, [])

    const clearPromise = controller.clearConversation()

    expect(controller.isClearingChat.value).toBe(true)
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.ConversationClose)
    ).toHaveLength(0)

    deletion.resolve(undefined)
    await clearPromise
    lookup.resolve(undefined)

    expect(conversationStore.deleteProjectConversationId).toHaveBeenCalledWith(
      projectId
    )
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.ConversationClose)
    ).toHaveLength(1)

    actor.emit('await')
    await flushPromises()

    expect(controller.queue.value).toHaveLength(0)
    expect(controller.isClearingChat.value).toBe(false)
    expect(workerMocks.processors[0].reset).toHaveBeenCalledOnce()
    expect(workerMocks.histories[0].reset).toHaveBeenCalledOnce()
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.CacheSetupAndConnect)
    ).toEqual([
      expect.objectContaining({
        conversationId: undefined,
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      }),
    ])
  })

  it('does not let an old-conversation snapshot cancel a clear', async () => {
    const deletion = deferred<undefined>()
    const { actor, controller, conversationStore } = createHarness()
    vi.mocked(
      conversationStore.deleteProjectConversationId
    ).mockReturnValueOnce(deletion.promise)

    const clearPromise = controller.clearConversation()
    actor.emit('other', {
      conversation: { exchanges: [] },
      conversationId: 'old-conversation',
    })

    expect(controller.isClearingChat.value).toBe(true)
    expect(conversationStore.saveProjectConversationId).not.toHaveBeenCalled()

    deletion.resolve(undefined)
    await clearPromise

    expect(
      sentEvents(actor, ZookeeperManagerTransitions.ConversationClose)
    ).toHaveLength(1)
  })

  it('cancels a prompt being collected when clear starts', async () => {
    const collectedFiles = deferred<[]>()
    const deletion = deferred<undefined>()
    projectFilesMocks.collect.mockReturnValueOnce(collectedFiles.promise)
    const { actor, controller, conversationStore } = createHarness({
      actorState: 'ready-await',
    })
    vi.mocked(
      conversationStore.deleteProjectConversationId
    ).mockReturnValueOnce(deletion.promise)

    controller.sendOrQueue('do not send this', undefined, [])
    const clearPromise = controller.clearConversation()
    collectedFiles.resolve([])
    await flushPromises()

    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(0)

    deletion.resolve(undefined)
    await clearPromise
    actor.emit('await')
    await flushPromises()

    expect(controller.queue.value).toHaveLength(0)
    expect(
      sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
    ).toHaveLength(0)
  })

  it('does not let a stalled old collection block the fresh conversation', async () => {
    const oldCollection = deferred<[]>()
    projectFilesMocks.collect.mockReturnValueOnce(oldCollection.promise)
    const { actor, controller } = createHarness({ actorState: 'ready-await' })

    controller.sendOrQueue('old prompt', undefined, [])
    await controller.clearConversation()
    actor.emit('await')
    await flushPromises()
    actor.emit('ready-await')

    controller.sendOrQueue('fresh prompt', undefined, [])

    await vi.waitFor(() => {
      expect(projectFilesMocks.collect).toHaveBeenCalledTimes(2)
      expect(
        sentEvents(actor, ZookeeperManagerTransitions.MessageSend)
      ).toEqual([expect.objectContaining({ prompt: 'fresh prompt' })])
    })
  })

  it('cancels an interrupted-turn collection when clear starts', async () => {
    const collectedFiles = deferred<[]>()
    const deletion = deferred<undefined>()
    projectFilesMocks.collect.mockReturnValueOnce(collectedFiles.promise)
    const { actor, controller, conversationStore } = createHarness()
    vi.mocked(
      conversationStore.deleteProjectConversationId
    ).mockReturnValueOnce(deletion.promise)
    actor.emit('wait-for-continue-check', {
      conversation: interruptedConversation,
    })
    controller.resumeInterruptedTurn()

    const clearPromise = controller.clearConversation()
    collectedFiles.resolve([])
    await flushPromises()

    expect(
      sentEvents(actor, ZookeeperManagerStates.ContinueCheck)
    ).toHaveLength(0)

    deletion.resolve(undefined)
    await clearPromise
  })

  it('drops a stale ContinueCheck after project ownership changes', async () => {
    const collectedFiles = deferred<[]>()
    projectFilesMocks.collect.mockReturnValueOnce(collectedFiles.promise)
    const harness = createHarness()

    harness.actor.emit('wait-for-continue-check', {
      conversation: interruptedConversation,
    })
    harness.controller.resumeInterruptedTurn()
    expect(projectFilesMocks.collect).toHaveBeenCalledOnce()

    harness.zdsProject.projectIORefSignal.value = {
      ...harness.project,
      path: '/projects/other',
    }
    collectedFiles.resolve([])
    await flushPromises()

    expect(
      sentEvents(harness.actor, ZookeeperManagerStates.ContinueCheck)
    ).toHaveLength(0)
  })

  it('can retry ContinueCheck after collecting project files fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    projectFilesMocks.collect
      .mockRejectedValueOnce(new Error('could not collect files'))
      .mockResolvedValueOnce([])
    const { actor, controller } = createHarness()

    actor.emit('wait-for-continue-check', {
      conversation: interruptedConversation,
    })
    controller.resumeInterruptedTurn()
    await flushPromises()
    controller.resumeInterruptedTurn()
    await flushPromises()

    expect(projectFilesMocks.collect).toHaveBeenCalledTimes(2)
    await vi.waitFor(() =>
      expect(
        sentEvents(actor, ZookeeperManagerStates.ContinueCheck)
      ).toHaveLength(1)
    )
    expect(consoleError).toHaveBeenCalled()
  })

  it.each([
    {
      name: 'completed',
      response: { end_of_stream: { whole_response: 'Done.' } },
    },
    {
      name: 'failed',
      response: { error: { detail: 'Request failed.' } },
    },
  ])(
    'continues a $name restored turn without collecting files',
    ({ response }) => {
      const { actor } = createHarness()
      const conversation = {
        exchanges: [
          {
            request: { type: 'user', content: 'finish the bracket' },
            responses: [response],
            deltasAggregated: '',
          },
        ],
      } as SnapshotContext['conversation']

      actor.emit('wait-for-continue-check', { conversation })

      expect(projectFilesMocks.collect).not.toHaveBeenCalled()
      expect(sentEvents(actor, ZookeeperManagerStates.ContinueCheck)).toEqual([
        {
          type: ZookeeperManagerStates.ContinueCheck,
          projectName: 'bracket',
          projectFiles: [],
        },
      ])
    }
  )

  it('waits for confirmation before continuing an interrupted turn', async () => {
    const collectedFiles = deferred<[]>()
    projectFilesMocks.collect.mockReturnValueOnce(collectedFiles.promise)
    const { actor, controller } = createHarness()
    actor.emit('wait-for-continue-check', {
      conversation: interruptedConversation,
    })

    expect(projectFilesMocks.collect).not.toHaveBeenCalled()
    expect(controller.isResumingInterruptedTurn.value).toBe(false)

    controller.resumeInterruptedTurn()
    controller.resumeInterruptedTurn()

    expect(projectFilesMocks.collect).toHaveBeenCalledOnce()
    expect(controller.isResumingInterruptedTurn.value).toBe(true)

    collectedFiles.resolve([])
    await flushPromises()

    await vi.waitFor(() =>
      expect(sentEvents(actor, ZookeeperManagerStates.ContinueCheck)).toEqual([
        expect.objectContaining({
          engineApiCallId: 'engine-call-id',
          projectFiles: [],
          projectName: 'bracket',
        }),
      ])
    )
    await vi.waitFor(() =>
      expect(controller.isResumingInterruptedTurn.value).toBe(false)
    )
  })

  it('invalidates a pending resume after leaving the continue state', async () => {
    const collectedFiles = deferred<[]>()
    projectFilesMocks.collect.mockReturnValueOnce(collectedFiles.promise)
    const { actor, controller } = createHarness()
    actor.emit('wait-for-continue-check', {
      conversation: interruptedConversation,
    })
    controller.resumeInterruptedTurn()
    expect(controller.isResumingInterruptedTurn.value).toBe(true)

    actor.emit('ready', { conversation: interruptedConversation })
    actor.emit('wait-for-continue-check', {
      conversation: interruptedConversation,
    })
    collectedFiles.resolve([])
    await flushPromises()

    expect(controller.isResumingInterruptedTurn.value).toBe(false)
    expect(
      sentEvents(actor, ZookeeperManagerStates.ContinueCheck)
    ).toHaveLength(0)

    controller.resumeInterruptedTurn()
    await flushPromises()

    await vi.waitFor(() =>
      expect(
        sentEvents(actor, ZookeeperManagerStates.ContinueCheck)
      ).toHaveLength(1)
    )
  })

  it('retries a failed conversation save', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failedSave = deferred<undefined>()
    const { actor, conversationStore } = createHarness()
    vi.mocked(conversationStore.saveProjectConversationId)
      .mockReturnValueOnce(failedSave.promise)
      .mockResolvedValue(undefined)

    actor.emit('other', { conversationId: 'conversation-id' })
    failedSave.reject(new Error('save failed'))
    await flushPromises()
    actor.emit('other', { conversationId: 'conversation-id' })

    expect(conversationStore.saveProjectConversationId).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  it('drains pending conversation persistence on dispose', async () => {
    const save = deferred<undefined>()
    const deletion = deferred<undefined>()
    const { actor, controller, conversationStore } = createHarness()
    vi.mocked(conversationStore.saveProjectConversationId).mockReturnValueOnce(
      save.promise
    )
    vi.mocked(
      conversationStore.deleteProjectConversationId
    ).mockReturnValueOnce(deletion.promise)

    actor.emit('other', { conversationId: 'conversation-id' })
    const clear = controller.clearConversation()
    const disposal = controller.dispose()
    let disposed = false
    void disposal.then(() => {
      disposed = true
    })

    save.resolve(undefined)
    await flushPromises()
    expect(disposed).toBe(false)

    deletion.resolve(undefined)
    await Promise.all([clear, disposal])
    expect(disposed).toBe(true)
  })

  it('cancels subscriptions, workers, reconnects, and active billing on dispose', async () => {
    vi.useFakeTimers()
    const { actor, billingSend, controller, conversationStore } =
      createHarness()
    actor.emit('other', {
      abruptlyClosed: true,
      awaitingResponse: true,
      conversationId: 'active-conversation',
    })
    const lookupCount = vi.mocked(conversationStore.getProjectConversationId)
      .mock.calls.length
    actor.send.mockClear()
    billingSend.mockClear()

    const disposal = controller.dispose()
    online = false
    window.dispatchEvent(new Event('offline'))
    vi.advanceTimersByTime(3000)
    actor.emit('other', { awaitingResponse: false })
    controller.updateAuthToken('ignored-after-dispose')
    await disposal

    expect(actor.listenerCount).toBe(0)
    expect(managerMocks.stop).toHaveBeenCalledOnce()
    expect(managerMocks.stop).toHaveBeenCalledWith(actor)
    expect(workerMocks.histories[0].dispose).toHaveBeenCalledOnce()
    expect(workerMocks.processors[0].dispose).toHaveBeenCalledOnce()
    expect(actor.send).not.toHaveBeenCalled()
    expect(conversationStore.getProjectConversationId).toHaveBeenCalledTimes(
      lookupCount
    )
    expect(billingSend.mock.calls.map(([event]) => event)).toEqual([
      { type: BillingTransition.UsageEnded },
      { type: BillingTransition.Update, apiToken: 'initial-token' },
    ])
    expect(zookeeperPromptRunningSignal.value).toBe(false)
  })
})
