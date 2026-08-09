import { ZookeeperConversationPaneWrapper } from '@src/lib/zookeeper/components/ZookeeperConversationPaneWrapper'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import type * as ProjectFiles from '@src/lib/projectFiles'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const applyFilePatch = vi.fn(
    async (_input: { files: { path: string; contents: string | null }[] }) =>
      undefined
  )
  const navigate = vi.fn()
  const openFile = vi.fn(async () => ({}))
  const useWatchForNewFileRequestsFromZookeeper = vi.fn()
  const zookeeperSubscribe = vi.fn(() => ({ unsubscribe: vi.fn() }))
  const project = {
    name: 'demo',
    path: '/workspace/demo',
    executingPath: '/workspace/demo/other.kcl',
    executingFileEntry: { value: { name: 'main.kcl' } },
  }
  const projectSession = {
    project: { value: project },
    getProject: () => project,
    applyFilePatch,
    openFile,
    navigate,
  }
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
  }

  return {
    applyFilePatch,
    kclManager,
    zookeeperSubscribe,
    navigate,
    openFile,
    project,
    projectSession,
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
    registry: {
      get: vi.fn(() => mocks.projectSession),
    },
    singletons: {
      kclManager: mocks.kclManager,
    },
    settings: {
      actor: { send: vi.fn() },
      useSettings: () => ({ meta: { id: { current: 'project-id' } } }),
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
    resolve: (path: string) => path.replaceAll(/\/+/g, '/'),
    sep: '/',
  },
}))

vi.mock('@src/lib/zookeeper/zookeeperManagerMachine', () => ({
  ZookeeperConversationToMarkdown: vi.fn(() => ''),
  ZookeeperManagerTransitions: {
    AuthTokenChanged: 'auth-token-changed',
  },
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

vi.mock('@src/lib/projectFiles', async (importOriginal) =>
  importOriginal<typeof ProjectFiles>()
)

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

describe('ZookeeperConversationPaneWrapper', () => {
  test('does not start the next patch-backed Zookeeper edit until the previous editor refresh completes', async () => {
    mocks.applyFilePatch.mockClear()
    mocks.navigate.mockClear()
    mocks.openFile.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.kclManager.path = '/workspace/demo/main.kcl'
    mocks.project.executingPath = '/workspace/demo/other.kcl'
    mocks.watchCallback = undefined
    let finishOpenFile: (() => void) | undefined
    mocks.openFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOpenFile = () => resolve({})
        })
    )

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

    await waitFor(() => expect(mocks.applyFilePatch).toHaveBeenCalledTimes(1))

    // The filesystem patch completes before the open-file refresh completes.
    // Starting the next edit here can let the older refresh win and leave stale
    // intermediate KCL visible in the editor.
    await flushQueuedWork()

    emitZookeeperFileRequest('final code')
    await flushQueuedWork()

    expect(mocks.applyFilePatch).toHaveBeenCalledTimes(1)

    // Once the file open has completed, the queued final edit can run.
    finishOpenFile?.()

    await waitFor(() => {
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
    })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled())

    await waitFor(() => expect(mocks.applyFilePatch).toHaveBeenCalledTimes(2))

    const secondPatch = mocks.applyFilePatch.mock.calls[1][0]
    expect(secondPatch.files[0]).toMatchObject({
      path: '/workspace/demo/main.kcl',
      contents: 'final code',
    })
  })

  test('does not refresh a file that is no longer active or stall later edits', async () => {
    mocks.applyFilePatch.mockClear()
    mocks.navigate.mockClear()
    mocks.openFile.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.kclManager.path = '/workspace/demo/main.kcl'
    mocks.project.executingPath = '/workspace/demo/other.kcl'
    mocks.watchCallback = undefined
    let finishOpenFile: (() => void) | undefined
    mocks.openFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOpenFile = () => resolve({})
        })
    )

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
    await waitFor(() => expect(mocks.applyFilePatch).toHaveBeenCalledTimes(1))

    mocks.kclManager.path = '/workspace/demo/other.kcl'
    finishOpenFile?.()
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))

    expect(mocks.kclManager.updateCodeEditor).not.toHaveBeenCalled()

    emitZookeeperFileRequest('final code')
    await waitFor(() => expect(mocks.applyFilePatch).toHaveBeenCalledTimes(2))
  })
})
