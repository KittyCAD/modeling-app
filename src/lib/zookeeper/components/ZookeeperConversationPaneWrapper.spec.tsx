import { ZookeeperConversationPaneWrapper } from '@src/lib/zookeeper/components/ZookeeperConversationPaneWrapper'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import type * as SystemIOUtils from '@src/machines/systemIO/utils'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  type ZookeeperSnapshot = {
    context: {
      awaitingResponse?: boolean
      conversation?: { exchanges: unknown[] }
      lastMessageId?: number
      lastMessageType?: string
    }
  }
  const systemIOSend = vi.fn()
  const useWatchForNewFileRequestsFromZookeeper = vi.fn()
  const zookeeperSubscribers: Array<(snapshot: ZookeeperSnapshot) => void> = []
  const zookeeperSubscribe = vi.fn(
    (subscriber: (snapshot: ZookeeperSnapshot) => void) => {
      zookeeperSubscribers.push(subscriber)
      return { unsubscribe: vi.fn() }
    }
  )
  const toastSuccess = vi.fn()
  const filesOnDisk = new Map([['/workspace/demo/main.kcl', 'initial code']])
  const kclManager = {
    captureEditorHistoryState: vi.fn(() => ({
      doc: { toString: () => 'initial code' },
    })),
    code: 'initial code',
    engineCommandManager: {},
    path: '/workspace/demo/main.kcl',
    restoreEditorHistoryState: vi.fn(),
    zookeeperHistoryRecordingInProgress: false,
    addGlobalHistoryEvent: vi.fn(),
    addGlobalHistoryEventWithCodeChange: vi.fn(),
    updateCodeEditor: vi.fn(),
  }

  return {
    filesOnDisk,
    kclManager,
    toastSuccess,
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
    readFile: vi.fn(async (path: string) => {
      const contents = mocks.filesOnDisk.get(path)
      return contents === undefined ? Promise.reject('ENOENT') : contents
    }),
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
    waitForIdleState: vi.fn(async () => undefined),
  }
})

vi.mock('@src/routes/utils', () => ({
  IS_STAGING_OR_DEBUG: false,
}))

vi.mock('react-hot-toast', () => ({
  default: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    success: mocks.toastSuccess,
  },
}))

function patchBackedZookeeperEdit(code: string, path = 'main.kcl') {
  return patchBackedZookeeperFiles({ [path]: code })
}

function patchBackedZookeeperFiles(
  outputs: Record<string, string>,
  changedFiles = outputs
) {
  return {
    ...zookeeperFiles(outputs),
    zookeeper_edit_patch: {
      run_id: 'run-1',
      changed_files: Object.entries(changedFiles).map(([path, contents]) => ({
        path,
        status: 'created',
        contents,
      })),
    },
  }
}

function zookeeperFiles(outputs: Record<string, string>) {
  return {
    type: 'edit_kcl_code',
    status_code: 201,
    project_name: 'demo',
    outputs,
  }
}

function emitZookeeperFileRequest(code: string, path = 'main.kcl') {
  emitZookeeperFileRequestOutput(patchBackedZookeeperEdit(code, path))
}

function emitZookeeperFileRequestOutput(toolOutput: unknown, exchangeId = 0) {
  mocks.watchCallback?.({
    toolOutput,
    projectNameCurrentlyOpened: 'demo',
    fileFocusedOnInEditor: {
      name: 'main.kcl',
      path: '/workspace/demo/main.kcl',
      children: null,
    },
    exchangeId,
  })
}

function emitEndOfStream(exchangeId = 0) {
  for (const subscriber of mocks.zookeeperSubscribers) {
    subscriber({
      context: {
        awaitingResponse: false,
        conversation: {
          exchanges: Array.from({ length: exchangeId + 1 }, () => ({
            responses: [],
            deltasAggregated: '',
          })),
        },
        lastMessageId: 999 + exchangeId,
        lastMessageType: 'end_of_stream',
      },
    })
  }
}

function renderWrapper() {
  mocks.systemIOSend.mockClear()
  mocks.kclManager.updateCodeEditor.mockClear()
  mocks.kclManager.path = '/workspace/demo/main.kcl'
  mocks.kclManager.code = 'initial code'
  mocks.toastSuccess.mockClear()
  mocks.filesOnDisk.clear()
  mocks.filesOnDisk.set('/workspace/demo/main.kcl', 'initial code')
  mocks.zookeeperSubscribers.length = 0
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
}

async function flushQueuedWork() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

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

  test('reports one file for a cube, then two when moving it to a new file', async () => {
    renderWrapper()

    const firstCode = 'cube = true'
    const firstOutputs = {
      'main.kcl': firstCode,
      'project.toml': 'updated metadata',
    }
    emitZookeeperFileRequestOutput(patchBackedZookeeperFiles(firstOutputs), 0)
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(1))
    emitEndOfStream(0)

    const firstRequest = mocks.systemIOSend.mock.calls[0][0].data
    expect(firstRequest.files).toHaveLength(2)
    expect(firstRequest.showSuccessToast).toBe(false)
    for (const [path, contents] of Object.entries(firstOutputs)) {
      mocks.filesOnDisk.set(`/workspace/demo/${path}`, contents)
    }
    firstRequest.onFileSystemSuccess()
    firstRequest.onSuccess()

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Successfully updated 1 file',
        { id: 'zookeeper-file-write-toast' }
      )
    )
    mocks.toastSuccess.mockClear()
    mocks.kclManager.code = firstCode

    const secondOutputs = {
      'main.kcl': 'import cube from "cube.kcl"',
      'cube.kcl': 'cube = true',
      'project.toml': 'newer metadata',
      'unchanged-1.kcl': 'unchanged 1',
      'unchanged-2.kcl': 'unchanged 2',
    }
    for (const [path, contents] of Object.entries(secondOutputs).slice(3)) {
      mocks.filesOnDisk.set(`/workspace/demo/${path}`, contents)
    }
    emitZookeeperFileRequestOutput(
      patchBackedZookeeperFiles(secondOutputs, {
        'main.kcl': secondOutputs['main.kcl'],
        'cube.kcl': secondOutputs['cube.kcl'],
        'project.toml': secondOutputs['project.toml'],
      }),
      1
    )
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(2))
    emitEndOfStream(1)
    expect(mocks.toastSuccess).not.toHaveBeenCalled()

    const secondRequest = mocks.systemIOSend.mock.calls[1][0].data
    expect(secondRequest.files).toHaveLength(5)
    expect(secondRequest.showSuccessToast).toBe(false)
    for (const [path, contents] of Object.entries(secondOutputs)) {
      mocks.filesOnDisk.set(`/workspace/demo/${path}`, contents)
    }
    secondRequest.onFileSystemSuccess()
    secondRequest.onSuccess()

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Successfully updated 2 files',
        { id: 'zookeeper-file-write-toast' }
      )
    )
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
  })

  test('does not replace a file-write error with a late success toast', async () => {
    renderWrapper()

    emitZookeeperFileRequest('main = 2')
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(1))
    emitEndOfStream()

    const request = mocks.systemIOSend.mock.calls[0][0].data
    request.onFileSystemError()
    await flushQueuedWork()

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
