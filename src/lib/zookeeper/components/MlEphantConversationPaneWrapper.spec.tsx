import { MlEphantConversationPaneWrapper } from '@src/lib/zookeeper/components/MlEphantConversationPaneWrapper'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import type * as SystemIOUtils from '@src/machines/systemIO/utils'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const systemIOSend = vi.fn()
  const useWatchForNewFileRequestsFromMlEphant = vi.fn()
  const mlEphantSubscribe = vi.fn(() => ({ unsubscribe: vi.fn() }))
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
    kclManager,
    mlEphantSubscribe,
    systemIOSend,
    useWatchForNewFileRequestsFromMlEphant,
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

vi.mock('@src/lib/zookeeper/components/MlEphantConversationPane', () => ({
  MlEphantConversationPane: () => null,
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

vi.mock('@src/lib/zookeeper/mlEphantManagerMachine', () => ({
  MlEphantConversationToMarkdown: vi.fn(() => ''),
  MlEphantManagerReactContext: {
    Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useActorRef: () => ({
      getSnapshot: () => ({
        context: {},
      }),
      send: vi.fn(),
      subscribe: mocks.mlEphantSubscribe,
    }),
  },
}))

vi.mock('@src/lib/zookeeper/components/MlEphantConversationPaneHooks', () => ({
  useProjectIdToConversationId: vi.fn(),
  useWatchForNewFileRequestsFromMlEphant: (
    ...args: [unknown, unknown, NonNullable<typeof mocks.watchCallback>]
  ) => {
    mocks.useWatchForNewFileRequestsFromMlEphant(...args)
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

describe('MlEphantConversationPaneWrapper', () => {
  test('does not start the next patch-backed Zookeeper edit until the previous editor refresh completes', async () => {
    mocks.systemIOSend.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.watchCallback = undefined

    render(
      <MlEphantConversationPaneWrapper
        areaConfig={{ hide: () => false }}
        layout={{
          areaType: AreaType.TTC,
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
})
