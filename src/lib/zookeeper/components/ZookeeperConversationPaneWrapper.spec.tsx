import { ZookeeperConversationPaneWrapper } from '@src/lib/zookeeper/components/ZookeeperConversationPaneWrapper'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import type * as SystemIOUtils from '@src/machines/systemIO/utils'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const systemIOSend = vi.fn()
  const waitForIdleState = vi.fn<() => Promise<void>>(async () => {})
  const useWatchForNewFileRequestsFromZookeeper = vi.fn()
  const zookeeperSubscribers: Array<(snapshot: any) => void> = []
  const zookeeperSubscribe = vi.fn((subscriber: (snapshot: any) => void) => {
    zookeeperSubscribers.push(subscriber)
    return { unsubscribe: vi.fn() }
  })
  const readFile = vi.fn(async () => 'current disk code')
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
    updateCodeEditor: vi.fn(),
    zookeeperManagerMachineBulkManipulatingFileSystem: false,
  }

  return {
    kclManager,
    readFile,
    zookeeperSubscribe,
    zookeeperSubscribers,
    systemIOSend,
    waitForIdleState,
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
    readFile: mocks.readFile,
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

vi.mock('@src/machines/systemIO/utils', async (importOriginal) => {
  const original = await importOriginal<typeof SystemIOUtils>()

  return {
    ...original,
    waitForIdleState: mocks.waitForIdleState,
  }
})

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

beforeEach(() => {
  mocks.kclManager.zookeeperManagerMachineBulkManipulatingFileSystem = false
  mocks.readFile.mockReset()
  mocks.readFile.mockResolvedValue('current disk code')
  mocks.waitForIdleState.mockReset()
  mocks.waitForIdleState.mockResolvedValue(undefined)
  mocks.zookeeperSubscribers.length = 0
})

describe('ZookeeperConversationPaneWrapper', () => {
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

  test('drops queued file work when its pane session ends', async () => {
    mocks.systemIOSend.mockClear()
    mocks.watchCallback = undefined

    let releaseIdleWait: (() => void) | undefined
    mocks.waitForIdleState.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseIdleWait = resolve
        })
    )

    const { unmount } = render(
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
    emitZookeeperFileRequest('late edit from the previous project')

    await waitFor(() => expect(mocks.waitForIdleState).toHaveBeenCalledOnce())

    unmount()
    mocks.kclManager.zookeeperManagerMachineBulkManipulatingFileSystem = true
    releaseIdleWait?.()
    await flushQueuedWork()

    expect(mocks.systemIOSend).not.toHaveBeenCalled()
    expect(
      mocks.kclManager.zookeeperManagerMachineBulkManipulatingFileSystem
    ).toBe(true)
  })

  test('marks dispatched file work stale when its pane session ends', async () => {
    mocks.systemIOSend.mockClear()
    mocks.watchCallback = undefined

    const { unmount } = render(
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
    emitZookeeperFileRequest('edit dispatched for the previous project')

    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data
    expect(request.isRequestCurrent()).toBe(true)

    unmount()

    expect(request.isRequestCurrent()).toBe(false)
    request.onFileSystemSuccess()
    expect(
      mocks.kclManager.zookeeperManagerMachineBulkManipulatingFileSystem
    ).toBe(false)
  })

  test('does not restore pending history after its pane session ends', async () => {
    mocks.systemIOSend.mockClear()
    mocks.kclManager.addGlobalHistoryEvent.mockClear()
    mocks.kclManager.addGlobalHistoryEventWithCodeChange.mockClear()
    mocks.watchCallback = undefined

    const { unmount } = render(
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
    emitZookeeperFileRequest('edit whose history snapshot is still loading')

    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledOnce())
    const request = mocks.systemIOSend.mock.calls[0][0].data
    let releaseSnapshotRead: ((contents: string) => void) | undefined
    mocks.readFile.mockReset()
    mocks.readFile.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseSnapshotRead = resolve
        })
    )
    request.onFileSystemSuccess()
    await waitFor(() => expect(mocks.readFile).toHaveBeenCalledOnce())

    for (const subscriber of mocks.zookeeperSubscribers) {
      subscriber({
        context: {
          awaitingResponse: false,
          conversation: { exchanges: [{}] },
          lastMessageId: 1,
          lastMessageType: 'end_of_stream',
        },
      })
    }
    unmount()
    releaseSnapshotRead?.('written code')
    await flushQueuedWork()

    expect(mocks.kclManager.addGlobalHistoryEvent).not.toHaveBeenCalled()
    expect(
      mocks.kclManager.addGlobalHistoryEventWithCodeChange
    ).not.toHaveBeenCalled()
    expect(mocks.kclManager.zookeeperHistoryRecordingInProgress).toBe(false)
  })
})
