import { MlEphantConversationPaneWrapper } from '@src/components/layout/areas/MlEphantConversationPaneWrapper'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const systemIORequest = vi.fn(async (_request: any) => ({
    shouldNavigate: false,
  }))
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
  }

  return {
    kclManager,
    mlEphantSubscribe,
    systemIORequest,
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

vi.mock('@src/components/layout/areas/MlEphantConversationPane', () => ({
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
    systemIO: {
      request: mocks.systemIORequest,
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

vi.mock('@src/machines/mlEphantManagerMachine', () => ({
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

vi.mock('@src/components/layout/areas/MlEphantConversationPaneHooks', () => ({
  useProjectIdToConversationId: vi.fn(),
  useWatchForNewFileRequestsFromMlEphant: (
    ...args: [unknown, unknown, NonNullable<typeof mocks.watchCallback>]
  ) => {
    mocks.useWatchForNewFileRequestsFromMlEphant(...args)
    mocks.watchCallback = args[2]
  },
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

describe('MlEphantConversationPaneWrapper', () => {
  test('does not start the next patch-backed Zookeeper edit until the previous editor refresh completes', async () => {
    let resolveFirstRequest: (() => void) | undefined
    mocks.systemIORequest.mockClear()
    mocks.systemIORequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstRequest = () => resolve({ shouldNavigate: false })
        })
    )
    mocks.watchCallback = undefined

    render(
      <MemoryRouter>
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
      </MemoryRouter>
    )

    expect(mocks.watchCallback).toBeDefined()

    emitZookeeperFileRequest('intermediate code')

    await waitFor(() => expect(mocks.systemIORequest).toHaveBeenCalledTimes(1))

    emitZookeeperFileRequest('final code')
    await flushQueuedWork()

    expect(mocks.systemIORequest).toHaveBeenCalledTimes(1)

    resolveFirstRequest?.()

    await waitFor(() => expect(mocks.systemIORequest).toHaveBeenCalledTimes(2))

    const secondRequest = mocks.systemIORequest.mock.calls[1][0]
    expect(secondRequest.files[0]).toMatchObject({
      requestedFileName: 'main.kcl',
      requestedCode: 'final code',
    })
  })
})
