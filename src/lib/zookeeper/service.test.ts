import type { KclManager } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'
import type { MlEphantManagerActor } from '@src/lib/zookeeper/mlEphantManagerMachine'
import {
  MlEphantManagerStates,
  MlEphantManagerTransitions,
} from '@src/lib/zookeeper/mlEphantManagerMachine'
import { createZookeeperService } from '@src/lib/zookeeper/service'
import type { ZookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import { BillingTransition } from '@src/machines/billingMachine'
import { S } from '@src/machines/utils'
import type { BillingRegistryService } from '@src/registry/contracts/billing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeSnapshot = ReturnType<MlEphantManagerActor['getSnapshot']>

function createProject(name: string): Project {
  return {
    name,
    path: `/tmp/${name}`,
    default_file: `/tmp/${name}/main.kcl`,
    children: [],
    kcl_file_count: 0,
    directory_count: 0,
    metadata: null,
    readWriteAccess: true,
  }
}

function createKclManager(path = '/tmp/project-a/main.kcl') {
  return {
    code: 'box = 1',
    path,
    execState: {
      filenames: {},
    },
  } as unknown as KclManager
}

function createConversationStore(
  conversations = new Map<string, string | undefined>()
) {
  return {
    getProjectConversationId: vi.fn(async (projectId: string) =>
      conversations.get(projectId)
    ),
    saveProjectConversationId: vi.fn(
      async ({
        projectId,
        conversationId,
      }: {
        projectId: string
        conversationId: string
      }) => {
        conversations.set(projectId, conversationId)
      }
    ),
    deleteProjectConversationId: vi.fn(async (projectId: string) => {
      conversations.delete(projectId)
    }),
  } satisfies ZookeeperConversationStore
}

function createBillingService() {
  return {
    actor: {} as BillingRegistryService['actor'],
    send: vi.fn(),
  } satisfies BillingRegistryService
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createFakeActor() {
  let snapshot = createSnapshot()
  const listeners = new Set<(next: FakeSnapshot) => void>()

  const actor = {
    getSnapshot: () => snapshot,
    send: vi.fn(
      (event: { type: string; conversationId?: string; apiToken?: string }) => {
        if (event.type === MlEphantManagerTransitions.ConversationClose) {
          snapshot = createSnapshot()
          emit(snapshot)
        }
        if (event.type === MlEphantManagerTransitions.CacheSetupAndConnect) {
          snapshot = createSnapshot({
            value: MlEphantManagerStates.Setup,
            context: {
              conversationId: event.conversationId,
            },
          })
          emit(snapshot)
        }
      }
    ),
    subscribe: (listener: (next: FakeSnapshot) => void) => {
      listeners.add(listener)
      return {
        unsubscribe: () => listeners.delete(listener),
      }
    },
    stop: vi.fn(),
    emit: (next: PartialSnapshot) => {
      snapshot = createSnapshot(next)
      emit(snapshot)
    },
  }

  const emit = (next: FakeSnapshot) => {
    for (const listener of listeners) {
      listener(next)
    }
  }

  return actor as unknown as MlEphantManagerActor & {
    emit: (next: PartialSnapshot) => void
    send: ReturnType<typeof vi.fn>
  }
}

type PartialSnapshot = {
  value?: unknown
  context?: Partial<FakeSnapshot['context']>
}

function createSnapshot({
  value = S.Await,
  context = {},
}: PartialSnapshot = {}) {
  const snapshot = {
    value,
    context: {
      apiToken: '',
      ws: undefined,
      abruptlyClosed: false,
      setupFailed: false,
      setupAttempt: 0,
      setupFailureReason: undefined,
      closeReason: undefined,
      conversation: undefined,
      conversationId: undefined,
      lastMessageId: undefined,
      lastMessageType: undefined,
      fileFocusedOnInEditor: undefined,
      projectNameCurrentlyOpened: undefined,
      awaitingResponse: false,
      attachmentsLoadedForCurrentPrompt: true,
      pendingBackendShutdown: false,
      defaultMode: undefined,
      modeOptions: undefined,
      cachedSetup: undefined,
      ...context,
    },
    matches: (state: unknown) => {
      if (typeof state === 'string') {
        return value === state
      }
      if (
        typeof state === 'object' &&
        state !== null &&
        MlEphantManagerStates.Ready in state
      ) {
        return value === MlEphantManagerStates.Ready
      }
      return false
    },
  }

  return snapshot as unknown as FakeSnapshot
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createZookeeperService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('syncs billing usage with the actor lifecycle', () => {
    const actor = createFakeActor()
    const billing = createBillingService()
    const service = createZookeeperService({
      actor,
      getApiToken: () => 'token',
      getBilling: () => billing,
    })

    actor.emit({
      context: {
        awaitingResponse: true,
      },
    })
    actor.emit({
      context: {
        awaitingResponse: true,
      },
    })

    expect(billing.send).toHaveBeenCalledTimes(1)
    expect(billing.send).toHaveBeenCalledWith({
      type: BillingTransition.UsageStarted,
    })

    actor.emit({
      context: {
        awaitingResponse: false,
      },
    })

    expect(billing.send).toHaveBeenCalledTimes(3)
    expect(billing.send).toHaveBeenCalledWith({
      type: BillingTransition.UsageEnded,
    })
    expect(billing.send).toHaveBeenCalledWith({
      type: BillingTransition.Update,
      apiToken: 'token',
    })

    service.dispose()
  })

  it('loads the saved conversation for the bound project before connecting', async () => {
    const actor = createFakeActor()
    const conversationStore = createConversationStore(
      new Map([['project-a-id', 'project-a-conversation']])
    )
    const service = createZookeeperService({
      actor,
      conversationStore,
      getApiToken: () => 'token',
    })

    service.bindProject({
      project: createProject('project-a'),
      projectId: 'project-a-id',
      loaderFile: undefined,
      kclManager: createKclManager(),
    })

    await flushPromises()

    expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
      'project-a-id'
    )
    expect(actor.send).toHaveBeenCalledWith({
      type: MlEphantManagerTransitions.CacheSetupAndConnect,
      refParentSend: actor.send,
      conversationId: 'project-a-conversation',
    })

    service.dispose()
  })

  it('does not connect while the API token is missing', async () => {
    const actor = createFakeActor()
    const conversationStore = createConversationStore(
      new Map([['project-a-id', 'project-a-conversation']])
    )
    const service = createZookeeperService({
      actor,
      conversationStore,
      getApiToken: () => '',
    })

    service.bindProject({
      project: createProject('project-a'),
      projectId: 'project-a-id',
      loaderFile: undefined,
      kclManager: createKclManager(),
    })

    await flushPromises()

    expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
      'project-a-id'
    )
    expect(actor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
      })
    )

    service.dispose()
  })

  it('ignores a stale saved conversation lookup after switching projects', async () => {
    const actor = createFakeActor()
    const projectALookup = createDeferred<string | undefined>()
    const projectBLookup = createDeferred<string | undefined>()
    const conversationStore = createConversationStore()
    vi.mocked(conversationStore.getProjectConversationId).mockImplementation(
      async (projectId) => {
        if (projectId === 'project-a-id') {
          return projectALookup.promise
        }
        if (projectId === 'project-b-id') {
          return projectBLookup.promise
        }
        return undefined
      }
    )
    const service = createZookeeperService({
      actor,
      conversationStore,
      getApiToken: () => 'token',
    })

    service.bindProject({
      project: createProject('project-a'),
      projectId: 'project-a-id',
      loaderFile: undefined,
      kclManager: createKclManager(),
    })
    service.bindProject({
      project: createProject('project-b'),
      projectId: 'project-b-id',
      loaderFile: undefined,
      kclManager: createKclManager('/tmp/project-b/main.kcl'),
    })

    projectALookup.resolve('project-a-conversation')
    await flushPromises()
    expect(actor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: 'project-a-conversation',
      })
    )

    projectBLookup.resolve('project-b-conversation')
    await flushPromises()
    expect(actor.send).toHaveBeenCalledWith({
      type: MlEphantManagerTransitions.CacheSetupAndConnect,
      refParentSend: actor.send,
      conversationId: 'project-b-conversation',
    })

    service.dispose()
  })

  it('does not save a late old-project conversation id under the new project', async () => {
    const actor = createFakeActor()
    const conversationStore = createConversationStore()
    const service = createZookeeperService({
      actor,
      conversationStore,
      getApiToken: () => 'token',
    })

    service.bindProject({
      project: createProject('project-a'),
      projectId: 'project-a-id',
      loaderFile: undefined,
      kclManager: createKclManager(),
    })
    await flushPromises()

    actor.emit({
      context: {
        conversationId: 'project-a-new-conversation',
      },
    })
    await flushPromises()

    expect(conversationStore.saveProjectConversationId).toHaveBeenCalledWith({
      projectId: 'project-a-id',
      conversationId: 'project-a-new-conversation',
    })
    vi.mocked(conversationStore.saveProjectConversationId).mockClear()

    service.bindProject({
      project: createProject('project-b'),
      projectId: 'project-b-id',
      loaderFile: undefined,
      kclManager: createKclManager('/tmp/project-b/main.kcl'),
    })
    actor.emit({
      context: {
        conversationId: 'late-project-a-conversation',
      },
    })
    await flushPromises()

    expect(conversationStore.saveProjectConversationId).not.toHaveBeenCalled()

    service.dispose()
  })

  it('does not finish clearing an old project after the project changes', async () => {
    const actor = createFakeActor()
    const deleteProjectA = createDeferred<undefined>()
    const conversationStore = createConversationStore(
      new Map([
        ['project-a-id', 'project-a-conversation'],
        ['project-b-id', 'project-b-conversation'],
      ])
    )
    vi.mocked(conversationStore.deleteProjectConversationId).mockImplementation(
      async (projectId) => {
        if (projectId === 'project-a-id') {
          return deleteProjectA.promise
        }
      }
    )
    const service = createZookeeperService({
      actor,
      conversationStore,
      getApiToken: () => 'token',
    })

    service.bindProject({
      project: createProject('project-a'),
      projectId: 'project-a-id',
      loaderFile: undefined,
      kclManager: createKclManager(),
    })
    await flushPromises()
    vi.mocked(actor.send).mockClear()

    const clearChat = service.clearChat()
    await flushPromises()

    expect(conversationStore.deleteProjectConversationId).toHaveBeenCalledWith(
      'project-a-id'
    )
    expect(actor.send).not.toHaveBeenCalledWith({
      type: MlEphantManagerTransitions.ConversationClose,
    })

    service.bindProject({
      project: createProject('project-b'),
      projectId: 'project-b-id',
      loaderFile: undefined,
      kclManager: createKclManager('/tmp/project-b/main.kcl'),
    })
    vi.mocked(actor.send).mockClear()
    deleteProjectA.resolve(undefined)
    await clearChat
    await flushPromises()

    expect(actor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: undefined,
      })
    )

    service.dispose()
  })
})
