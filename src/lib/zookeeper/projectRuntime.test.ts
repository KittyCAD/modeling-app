import { signal } from '@preact/signals-core'
import { attachZookeeperProjectRuntime } from '@src/lib/zookeeper/projectRuntime'
import type { ZookeeperService } from '@src/lib/zookeeper/registry/contract'
import type * as SystemIOUtils from '@src/machines/systemIO/utils'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import type { SystemIORegistryService } from '@src/registry/contracts/systemIO'
import { waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const systemIOSend = vi.fn()
  const watchForNewFileRequestsFromMlEphant = vi.fn()
  const disposeWatchForNewFileRequestsFromMlEphant = vi.fn()
  const zookeeperSubscribe = vi.fn(() => ({ unsubscribe: vi.fn() }))
  const zookeeperActor = {
    getSnapshot: () => ({
      context: {},
    }),
    send: vi.fn(),
    subscribe: zookeeperSubscribe,
  }
  const kclManager = {
    captureEditorHistoryState: vi.fn(() => ({
      doc: { toString: () => 'initial code' },
    })),
    code: 'initial code',
    engineCommandManager: {
      modelingSend: vi.fn(),
    },
    path: '/workspace/demo/main.kcl',
    zookeeperHistoryRecordingInProgress: false,
    addGlobalHistoryEvent: vi.fn(),
    addGlobalHistoryEventWithCodeChange: vi.fn(),
    updateCodeEditor: vi.fn(),
  }

  return {
    disposeWatchForNewFileRequestsFromMlEphant,
    kclManager,
    zookeeperActor,
    zookeeperSubscribe,
    systemIOSend,
    watchForNewFileRequestsFromMlEphant,
    watchCallback: undefined as
      | ((props: {
          toolOutput: unknown
          projectNameCurrentlyOpened: string
          fileFocusedOnInEditor: { name: string; path: string; children: null }
          exchangeId: number
        }) => void)
      | undefined,
  }
})

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    join: (...parts: string[]) =>
      parts
        .reduce((left, right) => (left ? `${left}/${right}` : right), '')
        .replaceAll(/\/+/g, '/'),
    readFile: vi.fn(async () => 'current disk code'),
    relative: (from: string, to: string) =>
      to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to,
    sep: '/',
  },
}))

vi.mock('@src/lib/zookeeper/components/MlEphantConversationPaneHooks', () => ({
  watchForNewFileRequestsFromMlEphant: (
    ...args: [unknown, unknown, NonNullable<typeof mocks.watchCallback>]
  ) => {
    mocks.watchForNewFileRequestsFromMlEphant(...args)
    mocks.watchCallback = args[2]
    return mocks.disposeWatchForNewFileRequestsFromMlEphant
  },
}))

vi.mock('@src/machines/systemIO/utils', async (importOriginal) => {
  const original = await importOriginal<typeof SystemIOUtils>()

  return {
    ...original,
    waitForIdleState: vi.fn(async () => undefined),
  }
})

function createZookeeperService(): ZookeeperService {
  return {
    actor: mocks.zookeeperActor as unknown as ZookeeperService['actor'],
    showManualConnect: signal(false),
    isClearingChat: signal(false),
    bindProject: vi.fn(),
    clearProject: vi.fn(),
    reconnect: vi.fn(),
    handleNetworkOffline: vi.fn(),
    handleNetworkOnline: vi.fn(),
    clearChat: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
}

function createProjectSession(): ProjectSessionService {
  const openedProject = signal({
    projectIORefSignal: signal({
      name: 'demo',
      path: '/workspace/demo',
      default_file: '/workspace/demo/main.kcl',
      children: [],
      kcl_file_count: 1,
      directory_count: 0,
      metadata: null,
      readWriteAccess: true,
    }),
    executingEditor: signal(
      mocks.kclManager as unknown as NonNullable<
        ProjectSessionService['openedProject']['value']
      >['executingEditor']['value']
    ),
    executingFileEntry: signal({
      name: 'main.kcl',
      path: '/workspace/demo/main.kcl',
      children: null,
    }),
  } as unknown as ProjectSessionService['openedProject']['value'])

  return {
    openedProjectHandle: signal(undefined),
    executingEditorHandle: signal(undefined),
    openedProject,
    bindApp: vi.fn(),
    openProject: vi.fn(),
    openEditor: vi.fn(),
    openProjectEditor: vi.fn(),
    closeProject: vi.fn(),
  }
}

function createSettings(): SettingsRegistryService {
  return {
    current: signal({
      meta: {
        id: {
          current: 'project-id',
        },
      },
    }),
    get: vi.fn(),
    send: vi.fn(),
    actor: {} as SettingsRegistryService['actor'],
    useSettings: vi.fn(),
  } as unknown as SettingsRegistryService
}

function attachRuntime() {
  return attachZookeeperProjectRuntime({
    service: createZookeeperService(),
    projectSession: signal(createProjectSession()),
    settings: signal(createSettings()),
    systemIO: signal({
      actor: {
        send: mocks.systemIOSend,
      } as unknown as SystemIORegistryService['actor'],
    }),
  })
}

function patchBackedZookeeperEdit(code: string) {
  return {
    type: 'edit_kcl_code',
    status_code: 201,
    project_name: 'demo',
    outputs: {
      'main.kcl': code,
    },
    zookeeper_edit_patch: {
      run_id: 'run-1',
      changed_files: [
        {
          path: 'main.kcl',
          status: 'created',
          contents: code,
        },
      ],
    },
  }
}

function emitZookeeperFileRequest(code: string) {
  mocks.watchCallback?.({
    toolOutput: patchBackedZookeeperEdit(code),
    projectNameCurrentlyOpened: 'demo',
    fileFocusedOnInEditor: {
      name: 'main.kcl',
      path: '/workspace/demo/main.kcl',
      children: null,
    },
    exchangeId: 0,
  })
}

async function flushQueuedWork() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('attachZookeeperProjectRuntime', () => {
  test('does not start the next patch-backed Zookeeper edit until the previous editor refresh completes', async () => {
    mocks.systemIOSend.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.kclManager.path = '/workspace/demo/main.kcl'
    mocks.watchCallback = undefined
    const dispose = attachRuntime()

    try {
      expect(mocks.watchCallback).toBeDefined()

      emitZookeeperFileRequest('intermediate code')

      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(1))

      const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
      expect(firstRequest.onSuccess).toEqual(expect.any(Function))

      // The filesystem callback completes before the route/editor refresh
      // callback. Starting the next edit here can let the older refresh win.
      firstRequest.onFileSystemSuccess()
      await flushQueuedWork()

      emitZookeeperFileRequest('final code')
      await flushQueuedWork()

      expect(mocks.systemIOSend).toHaveBeenCalledTimes(1)

      // Once the editor refresh has completed, the queued final edit can run.
      firstRequest.onSuccess()

      expect(mocks.kclManager.updateCodeEditor).toHaveBeenCalledWith(
        'intermediate code',
        {
          shouldAddToHistory: false,
          shouldClearHistory: false,
          shouldExecute: true,
          shouldResetCamera: true,
          shouldWriteToDisk: false,
        }
      )

      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))

      const secondRequest = mocks.systemIOSend.mock.calls[1][0].data
      expect(secondRequest.files[0]).toMatchObject({
        requestedFileName: 'main.kcl',
        requestedCode: 'final code',
      })
    } finally {
      dispose()
    }
  })

  test('does not refresh a file that is no longer active or stall later edits', async () => {
    mocks.systemIOSend.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.kclManager.path = '/workspace/demo/main.kcl'
    mocks.watchCallback = undefined
    const dispose = attachRuntime()

    try {
      emitZookeeperFileRequest('intermediate code')
      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(1))

      const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
      firstRequest.onFileSystemSuccess()
      mocks.kclManager.path = '/workspace/demo/other.kcl'
      firstRequest.onSuccess()

      expect(mocks.kclManager.updateCodeEditor).not.toHaveBeenCalled()

      emitZookeeperFileRequest('final code')
      await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
    } finally {
      dispose()
    }
  })
})
