import { AreaType, LayoutType } from '@src/lib/layout/types'
import { ZookeeperConversationPaneWrapper } from '@src/lib/zookeeper/components/ZookeeperConversationPaneWrapper'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const systemIOSend = vi.fn()
  const useWatchForNewFileRequestsFromZookeeper = vi.fn()
  type ZookeeperSnapshot = {
    context: {
      awaitingResponse?: boolean
      conversation?: { exchanges: unknown[] }
      lastMessageId?: number
      lastMessageType?: string
    }
  }
  const zookeeperSubscribers: ((snapshot: ZookeeperSnapshot) => void)[] = []
  const zookeeperSubscribe = vi.fn(
    (subscriber: (snapshot: ZookeeperSnapshot) => void) => {
      zookeeperSubscribers.push(subscriber)
      return {
        unsubscribe: vi.fn(() => {
          const index = zookeeperSubscribers.indexOf(subscriber)
          if (index >= 0) {
            zookeeperSubscribers.splice(index, 1)
          }
        }),
      }
    }
  )
  const cloudSyncBatchReleases: ReturnType<typeof vi.fn>[] = []
  const beginCloudSyncProjectMutationBatch = vi.fn(() => {
    const release = vi.fn()
    cloudSyncBatchReleases.push(release)
    return release
  })
  const kclManager = {
    captureEditorHistoryState: vi.fn(() => ({
      doc: { toString: () => 'initial code' },
    })),
    code: 'initial code',
    engineCommandManager: {},
    path: '/workspace/demo/main.kcl',
    zookeeperHistoryRecordingInProgress: false,
    addGlobalHistoryEvent: vi.fn(),
    addGlobalHistoryEventWithCodeChange: vi.fn(),
    restoreEditorHistoryState: vi.fn(),
    updateCodeEditor: vi.fn(),
  }

  return {
    kclManager,
    beginCloudSyncProjectMutationBatch,
    cloudSyncBatchReleases,
    zookeeperSubscribe,
    zookeeperSubscribers,
    systemIOSend,
    useWatchForNewFileRequestsFromZookeeper,
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

vi.mock('@src/components/layout/Panel', () => ({
  LayoutPanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  LayoutPanelHeader: () => null,
}))

vi.mock('@src/lib/cloudSync', () => ({
  beginCloudSyncProjectMutationBatch: mocks.beginCloudSyncProjectMutationBatch,
}))

vi.mock('@src/components/layout/Panel/HeaderMenu', () => ({
  HeaderMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@src/lib/zookeeper/components/ZookeeperConversationPane', () => ({
  ZookeeperConversationPane: () => null,
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    context: {},
    send: vi.fn(),
    theProject: { current: undefined },
  }),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    auth: {
      useToken: () => 'token',
      useUser: () => undefined,
    },
    billing: { send: vi.fn() },
    debug: {},
    project: {
      name: 'demo',
      path: '/workspace/demo',
      executingPath: '/workspace/demo/main.kcl',
      executingFileEntry: { value: { name: 'main.kcl' } },
    },
    settings: {
      actor: { send: vi.fn() },
      useSettings: () => ({ meta: { id: { current: 'project-id' } } }),
    },
    systemIOActor: {
      send: mocks.systemIOSend,
    },
  }),
  useSingletons: () => ({
    kclManager: mocks.kclManager,
  }),
}))

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

vi.mock('@src/lib/zookeeper/zookeeperManagerMachine', () => ({
  ZookeeperConversationToMarkdown: vi.fn(() => ''),
  ZookeeperManagerReactContext: {
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useActorRef: () => ({
      getSnapshot: () => ({
        context: {},
      }),
      send: vi.fn(),
      subscribe: mocks.zookeeperSubscribe,
    }),
  },
}))

vi.mock('@src/lib/zookeeper/components/ZookeeperConversationPaneHooks', () => ({
  useProjectIdToConversationId: vi.fn(),
  useWatchForNewFileRequestsFromZookeeper: (
    ...args: [unknown, unknown, NonNullable<typeof mocks.watchCallback>]
  ) => {
    mocks.useWatchForNewFileRequestsFromZookeeper(...args)
    mocks.watchCallback = args[2]
  },
}))

vi.mock('@src/machines/systemIO/utils', () => ({
  normalizeKCLFileDeletePath: (path: string) =>
    path.replaceAll('\\', '/').replace(/^\.\//, ''),
  prepareZookeeperNewFileRequest: ({
    toolOutput,
  }: {
    toolOutput: {
      outputs?: Record<string, string>
      project_name?: string
      zookeeper_edit_patch?: unknown
    }
  }) => ({
    files: Object.entries(toolOutput.outputs ?? {}).map(
      ([requestedFileName, requestedCode]) => ({
        requestedFileName,
        requestedCode,
      })
    ),
    filesToDelete: [],
    requestedFileNameWithExtension: 'main.kcl',
    requestedProjectName: toolOutput.project_name,
    zookeeperEditPatch: toolOutput.zookeeper_edit_patch,
  }),
  SystemIOMachineEvents: {
    bulkCreateAndDeleteKCLFilesAndNavigateToFile: 'bulkCreateAndDelete',
  },
  waitForIdleState: vi.fn(async () => undefined),
}))

vi.mock('@src/routes/utils', () => ({
  IS_STAGING_OR_DEBUG: false,
}))

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

function finishZookeeperExchange() {
  for (const subscriber of mocks.zookeeperSubscribers) {
    subscriber({
      context: {
        awaitingResponse: false,
        conversation: { exchanges: [{}] },
        lastMessageId: 2,
        lastMessageType: 'end_of_stream',
      },
    })
  }
}

describe('ZookeeperConversationPaneWrapper', () => {
  test('releases one cloud sync checkpoint only after the exchange and queued writes finish', async () => {
    mocks.systemIOSend.mockClear()
    mocks.beginCloudSyncProjectMutationBatch.mockClear()
    mocks.cloudSyncBatchReleases.length = 0
    mocks.watchCallback = undefined

    render(
      <ZookeeperConversationPaneWrapper
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: AreaType.Zookeeper,
          id: 'zookeeper',
          label: 'Zookeeper',
          type: LayoutType.Simple,
        }}
        onClose={vi.fn()}
      />
    )

    emitZookeeperFileRequest('coherent final code')
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(1))

    expect(mocks.beginCloudSyncProjectMutationBatch).toHaveBeenCalledWith(
      '/workspace/demo'
    )
    expect(mocks.cloudSyncBatchReleases).toHaveLength(1)

    finishZookeeperExchange()
    expect(mocks.cloudSyncBatchReleases[0]).not.toHaveBeenCalled()

    const request = mocks.systemIOSend.mock.calls[0][0].data
    request.onFileSystemSuccess()
    request.onSuccess()
    await flushQueuedWork()

    expect(mocks.cloudSyncBatchReleases[0]).toHaveBeenCalledTimes(1)
  })

  test('does not start the next patch-backed Zookeeper edit until the previous editor refresh completes', async () => {
    mocks.systemIOSend.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.kclManager.path = '/workspace/demo/main.kcl'
    mocks.watchCallback = undefined

    render(
      <ZookeeperConversationPaneWrapper
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: AreaType.Zookeeper,
          id: 'zookeeper',
          label: 'Zookeeper',
          type: LayoutType.Simple,
        }}
        onClose={vi.fn()}
      />
    )

    expect(mocks.watchCallback).toBeDefined()

    emitZookeeperFileRequest('intermediate code')

    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(1))

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    expect(firstRequest.onSuccess).toEqual(expect.any(Function))

    // The filesystem callback completes before the route/editor refresh callback.
    // Starting the next edit here can let the older refresh win and leave stale
    // intermediate KCL visible in the editor.
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
  })

  test('does not refresh a file that is no longer active or stall later edits', async () => {
    mocks.systemIOSend.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.kclManager.path = '/workspace/demo/main.kcl'
    mocks.watchCallback = undefined

    render(
      <ZookeeperConversationPaneWrapper
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: AreaType.Zookeeper,
          id: 'zookeeper',
          label: 'Zookeeper',
          type: LayoutType.Simple,
        }}
        onClose={vi.fn()}
      />
    )

    emitZookeeperFileRequest('intermediate code')
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(1))

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    firstRequest.onFileSystemSuccess()
    mocks.kclManager.path = '/workspace/demo/other.kcl'
    firstRequest.onSuccess()

    expect(mocks.kclManager.updateCodeEditor).not.toHaveBeenCalled()

    emitZookeeperFileRequest('final code')
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
  })
})
