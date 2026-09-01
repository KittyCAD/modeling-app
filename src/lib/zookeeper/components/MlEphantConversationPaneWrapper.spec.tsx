import { MlEphantConversationPaneWrapper } from '@src/lib/zookeeper/components/MlEphantConversationPaneWrapper'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import type * as SystemIOUtils from '@src/machines/systemIO/utils'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const systemIOSend = vi.fn()
  const notifyProjectEdited = vi.fn()
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
    managerProviderMounts: 0,
    mlEphantSubscribe,
    notifyProjectEdited,
    projectPath: '/workspace/demo',
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

vi.mock('@src/components/UndoRedoButtons', () => ({
  UndoRedoButtons: (props: { 'data-testid'?: string }) => (
    <div data-testid={props['data-testid']}>Undo and redo</div>
  ),
}))

vi.mock('@src/lib/zookeeper/components/MlEphantConversationPane', () => ({
  MlEphantConversationPane: () => <textarea aria-label="Zookeeper prompt" />,
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
      path: mocks.projectPath,
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

vi.mock('@src/lib/aiFirstCad/context', () => ({
  useAiFirstCad: () => ({
    mode: 'ai',
    notifyProjectEdited: mocks.notifyProjectEdited,
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

vi.mock('@src/lib/zookeeper/mlEphantManagerMachine', async () => {
  const { useState } = await import('react')

  return {
    MlEphantConversationToMarkdown: vi.fn(() => ''),
    MlEphantManagerReactContext: {
      Provider: ({ children }: { children: React.ReactNode }) => {
        const [instanceId] = useState(() => ++mocks.managerProviderMounts)
        return (
          <div data-instance-id={instanceId} data-testid="manager-provider">
            {children}
          </div>
        )
      },
      useActorRef: () => ({
        getSnapshot: () => ({
          context: {},
        }),
        send: vi.fn(),
        subscribe: mocks.mlEphantSubscribe,
      }),
    },
  }
})

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
  beforeEach(() => {
    mocks.managerProviderMounts = 0
    mocks.projectPath = '/workspace/demo'
  })

  test('mounts the existing Zookeeper prompt inside the pane', () => {
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

    expect(
      screen.getByRole('textbox', { name: 'Zookeeper prompt' })
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeVisible()
    expect(screen.getByTestId('chat-header-undo-redo')).toBeVisible()
  })

  test('remounts the conversation manager when the project changes', () => {
    const props = {
      areaConfig: { hide: () => false },
      layout: {
        areaType: AreaType.TTC,
        id: 'zookeeper',
        label: 'Zookeeper',
        type: LayoutType.Simple as const,
      },
      onClose: vi.fn(),
    }
    const { rerender } = render(<MlEphantConversationPaneWrapper {...props} />)
    const initialInstanceId = screen
      .getByTestId('manager-provider')
      .getAttribute('data-instance-id')

    mocks.projectPath = '/workspace/other-project'
    rerender(<MlEphantConversationPaneWrapper {...props} />)

    expect(
      screen.getByTestId('manager-provider').getAttribute('data-instance-id')
    ).not.toBe(initialInstanceId)
  })

  test('notifies the AI project grid after a successful edit fully settles', async () => {
    mocks.notifyProjectEdited.mockClear()
    mocks.systemIOSend.mockClear()
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

    emitZookeeperFileRequest('new code')
    await waitFor(() => expect(mocks.systemIOSend).toHaveBeenCalledTimes(1))

    const request = mocks.systemIOSend.mock.calls[0][0].data
    request.onFileSystemSuccess()
    expect(mocks.notifyProjectEdited).not.toHaveBeenCalled()

    request.onSuccess()
    await waitFor(() =>
      expect(mocks.notifyProjectEdited).toHaveBeenCalledTimes(1)
    )
  })

  test('does not start the next patch-backed Zookeeper edit until the previous editor refresh completes', async () => {
    mocks.systemIOSend.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.kclManager.path = '/workspace/demo/main.kcl'
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

  test('does not refresh a file that is no longer active or stall later edits', async () => {
    mocks.systemIOSend.mockClear()
    mocks.kclManager.updateCodeEditor.mockClear()
    mocks.kclManager.path = '/workspace/demo/main.kcl'
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
