import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NIL as uuidNIL } from 'uuid'
import { beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('@src/routes/utils', () => ({
  getAppVersion: () => 'test',
  isPlaywrightTestEnv: false,
}))

vi.mock('@src/lib/desktop', () => ({
  getDesktopAppInfo: () => null,
  isDesktop: () => false,
  openExternalBrowserIfDesktop: vi.fn(),
  DESKTOP_OS_INFO: null,
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    registry: {
      reconfigure: vi.fn(),
    },
  }),
  useSingletons: () => ({
    kclManager: {
      astSignal: { value: null },
    },
  }),
}))

import { MlEphantConversationPane } from '@src/lib/zookeeper/components/MlEphantConversationPane'
import type { ZookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import type {
  Conversation,
  MlCopilotModeId,
  MlCopilotModeOption,
} from '@src/lib/zookeeper/mlEphantManagerMachine'
import { MlEphantManagerTransitions } from '@src/lib/zookeeper/mlEphantManagerMachine'

const completedConversation: Conversation = {
  exchanges: [
    {
      request: {
        type: 'user',
        content: 'make a cube 10mm',
      },
      responses: [
        {
          end_of_stream: {
            whole_response: 'Done.',
          },
        },
      ],
      deltasAggregated: 'Done.',
    },
  ],
}

type FakeMlEphantSnapshot = {
  value: string
  context: {
    abruptlyClosed: boolean
    setupFailed?: boolean
    setupAttempt?: number
    closeReason?: string
    awaitingResponse: boolean
    attachmentsLoadedForCurrentPrompt: boolean
    conversation?: Conversation
    conversationId?: string
    defaultMode?: MlCopilotModeId
    modeOptions?: MlCopilotModeOption[]
  }
  matches: (state: unknown) => boolean
}

type FakeMlEphantActor = {
  getSnapshot: () => FakeMlEphantSnapshot
  subscribe: (listener?: (next: FakeMlEphantSnapshot) => void) => {
    unsubscribe: () => void
  }
  send: ReturnType<typeof vi.fn>
}

const createFakeActor = ({
  conversation = completedConversation,
  defaultMode = undefined,
  modeOptions = undefined,
  value = 'ready',
  awaitingResponse = true,
  abruptlyClosed = false,
  setupFailed = false,
  setupAttempt = 0,
  includeConversationId = true,
  conversationId = 'conversation-id',
}: {
  conversation?: Conversation
  defaultMode?: MlCopilotModeId
  modeOptions?: MlCopilotModeOption[]
  value?: string
  awaitingResponse?: boolean
  abruptlyClosed?: boolean
  setupFailed?: boolean
  setupAttempt?: number
  includeConversationId?: boolean
  conversationId?: string
} = {}): FakeMlEphantActor => {
  const snapshot: FakeMlEphantSnapshot = {
    value,
    context: {
      abruptlyClosed,
      setupFailed,
      setupAttempt,
      awaitingResponse,
      attachmentsLoadedForCurrentPrompt: true,
      conversation,
      conversationId: includeConversationId ? conversationId : undefined,
      defaultMode,
      modeOptions,
    },
    matches: (state: unknown) => state === value,
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: () => ({
      unsubscribe: vi.fn(),
    }),
    send: vi.fn(),
  }
}

type FakeConversationStore = ZookeeperConversationStore & {
  completeDelete: () => void
}

const createFakeConversationStore = ({
  projectConversations = new Map<string, string>(),
  completeDeletesAutomatically = true,
}: {
  projectConversations?: Map<string, string>
  completeDeletesAutomatically?: boolean
} = {}): FakeConversationStore => {
  const conversations = new Map(projectConversations)
  let pendingDelete: (() => void) | undefined

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
    deleteProjectConversationId: vi.fn(
      (projectId: string) =>
        new Promise<void>((resolve) => {
          const completeDelete = () => {
            conversations.delete(projectId)
            resolve()
          }

          if (completeDeletesAutomatically) {
            completeDelete()
            return
          }

          pendingDelete = completeDelete
        })
    ),
    completeDelete: () => {
      pendingDelete?.()
      pendingDelete = undefined
    },
  }
}

const createStatefulClearChatActor = () => {
  let snapshot: FakeMlEphantSnapshot = {
    value: 'ready',
    context: {
      abruptlyClosed: false,
      setupFailed: false,
      setupAttempt: 0,
      awaitingResponse: false,
      attachmentsLoadedForCurrentPrompt: true,
      conversation: completedConversation,
      conversationId: 'old-conversation-id',
      defaultMode: undefined,
      modeOptions: undefined,
    },
    matches: (state: unknown) => state === snapshot.value,
  }
  const listeners = new Set<(next: FakeMlEphantSnapshot) => void>()

  const actor: FakeMlEphantActor = {
    getSnapshot: () => snapshot,
    subscribe: (listener?: (next: FakeMlEphantSnapshot) => void) => {
      if (listener !== undefined) {
        listeners.add(listener)
      }
      return {
        unsubscribe: () => {
          if (listener !== undefined) {
            listeners.delete(listener)
          }
        },
      }
    },
    send: vi.fn((event: { type: string }) => {
      if (event.type !== MlEphantManagerTransitions.ConversationClose) {
        return
      }

      snapshot = {
        ...snapshot,
        value: 'await',
        context: {
          ...snapshot.context,
          awaitingResponse: false,
          conversation: undefined,
          conversationId: undefined,
        },
      }
      for (const listener of listeners) {
        listener(snapshot)
      }
    }),
  }

  return actor
}

const createStatefulPromptActor = (awaitingResponse = false) => {
  let snapshot: FakeMlEphantSnapshot = {
    value: 'ready',
    context: {
      abruptlyClosed: false,
      setupFailed: false,
      setupAttempt: 0,
      awaitingResponse,
      attachmentsLoadedForCurrentPrompt: true,
      conversation: completedConversation,
      conversationId: 'conversation-id',
      defaultMode: undefined,
      modeOptions: undefined,
    },
    matches: (state: unknown) => state === snapshot.value,
  }
  const listeners = new Set<(next: FakeMlEphantSnapshot) => void>()

  const actor = {
    getSnapshot: () => snapshot,
    subscribe: (listener?: (next: FakeMlEphantSnapshot) => void) => {
      if (listener !== undefined) {
        listeners.add(listener)
      }
      return {
        unsubscribe: () => {
          if (listener !== undefined) {
            listeners.delete(listener)
          }
        },
      }
    },
    send: vi.fn(),
    setAwaitingResponse: (nextAwaitingResponse: boolean) => {
      snapshot = {
        ...snapshot,
        context: {
          ...snapshot.context,
          awaitingResponse: nextAwaitingResponse,
        },
      }
      for (const listener of listeners) {
        listener(snapshot)
      }
    },
    setConnectionState: (value: string, nextAwaitingResponse: boolean) => {
      snapshot = {
        ...snapshot,
        value,
        context: {
          ...snapshot.context,
          awaitingResponse: nextAwaitingResponse,
        },
      }
      for (const listener of listeners) {
        listener(snapshot)
      }
    },
  }

  return actor
}

type RenderPaneOptions = {
  mlEphantManagerActor?: FakeMlEphantActor
  conversationStore?: FakeConversationStore
  theProject?: any
  settingsMetaId?: string
  settingsProjectDirectory?: string
  zookeeperMode?: {
    current?: MlCopilotModeId
    project?: MlCopilotModeId
    user?: MlCopilotModeId
  }
  kclManager?: any
  loaderFile?: any
  sendBillingUpdate?: () => void
  sendBillingUsageStarted?: () => void
  sendBillingUsageEnded?: () => void
}

const createPaneElement = ({
  mlEphantManagerActor = createFakeActor(),
  conversationStore = createFakeConversationStore(),
  theProject = undefined,
  settingsMetaId = uuidNIL,
  settingsProjectDirectory = '',
  zookeeperMode = {},
  kclManager = {
    code: '',
    execState: {
      filenames: [],
    },
    artifactGraph: {},
  },
  loaderFile = undefined,
  sendBillingUpdate = vi.fn(),
  sendBillingUsageStarted = vi.fn(),
  sendBillingUsageEnded = vi.fn(),
}: RenderPaneOptions = {}) => {
  return (
    <MemoryRouter>
      <MlEphantConversationPane
        mlEphantManagerActor={mlEphantManagerActor as any}
        conversationStore={conversationStore}
        kclManager={kclManager}
        theProject={theProject}
        contextModeling={
          {
            selectionRanges: {
              graphSelections: [],
              otherSelections: [],
            },
          } as any
        }
        sendModeling={vi.fn() as any}
        sendBillingUpdate={sendBillingUpdate}
        sendBillingUsageStarted={sendBillingUsageStarted}
        sendBillingUsageEnded={sendBillingUsageEnded}
        settings={
          {
            meta: {
              id: {
                current: settingsMetaId,
              },
            },
            app: {
              projectDirectory: {
                current: settingsProjectDirectory,
              },
              zookeeperMode: {
                current: zookeeperMode.current,
                project: zookeeperMode.project,
                user: zookeeperMode.user,
              },
            },
            modeling: {
              useSketchSolveMode: {
                current: false,
              },
            },
          } as any
        }
        loaderFile={loaderFile}
      />
    </MemoryRouter>
  )
}

const renderPane = (options: RenderPaneOptions = {}) =>
  render(createPaneElement(options))

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('MlEphantConversationPane', () => {
  test('shows recovery immediately when mounted while the browser is already offline', () => {
    const onlineSpy = vi
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false)
    const mlEphantManagerActor = createFakeActor({
      awaitingResponse: false,
    })

    try {
      renderPane({ mlEphantManagerActor })

      expect(screen.getByRole('alert')).toHaveTextContent(
        'No internet connection.'
      )
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Check your network connection, then click below to try again.'
      )
      const recovery = screen.getByTestId('connection-recovery')
      expect(recovery).toHaveClass('h-full')
      expect(recovery.parentElement).toHaveClass('h-full')
      expect(
        screen.queryByRole('button', { name: /clear chat/i })
      ).not.toBeInTheDocument()
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
        type: MlEphantManagerTransitions.NetworkOffline,
      })
    } finally {
      onlineSpy.mockRestore()
    }
  })

  test('shows recovery immediately and does not retry while the browser is offline', async () => {
    vi.useFakeTimers()
    const mlEphantManagerActor = createFakeActor({
      awaitingResponse: false,
    })

    try {
      renderPane({ mlEphantManagerActor })

      act(() => {
        window.dispatchEvent(new Event('offline'))
      })

      expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
        type: MlEphantManagerTransitions.NetworkOffline,
      })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No internet connection.'
      )
      expect(screen.getByTestId('connection-recovery')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /reconnect/i })).toBeEnabled()
      expect(
        screen.queryByRole('button', { name: /Clear chat/ })
      ).not.toBeInTheDocument()
      expect(
        screen.getByTestId('ml-ephant-conversation-input-button')
      ).toBeDisabled()
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
        })
      )

      fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: mlEphantManagerActor.send,
        conversationId: 'conversation-id',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('reconnects immediately when the browser comes back online', () => {
    const mlEphantManagerActor = createFakeActor({
      awaitingResponse: false,
    })
    renderPane({ mlEphantManagerActor })

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No internet connection.'
    )

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
      type: MlEphantManagerTransitions.CacheSetupAndConnect,
      refParentSend: mlEphantManagerActor.send,
      conversationId: 'conversation-id',
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('waits for the saved conversation lookup before reconnecting an initially offline project', async () => {
    let resolveLookup!: (conversationId: string | undefined) => void
    const pendingLookup = new Promise<string | undefined>((resolve) => {
      resolveLookup = resolve
    })
    const conversationStore = createFakeConversationStore()
    vi.mocked(conversationStore.getProjectConversationId).mockReturnValue(
      pendingLookup
    )
    const onlineSpy = vi
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false)
    const mlEphantManagerActor = createFakeActor({
      abruptlyClosed: true,
      awaitingResponse: false,
      conversation: undefined,
      includeConversationId: false,
      value: 'await',
    })

    try {
      renderPane({
        mlEphantManagerActor,
        conversationStore,
        settingsMetaId: 'project-id',
        theProject: {
          name: 'sample-project',
          path: '/tmp/sample-project',
        },
      })

      await waitFor(() => {
        expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
          'project-id'
        )
      })
      mlEphantManagerActor.send.mockClear()

      onlineSpy.mockReturnValue(true)
      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
        })
      )

      await act(async () => {
        resolveLookup('saved-conversation-id')
        await pendingLookup
      })

      await waitFor(() => {
        expect(mlEphantManagerActor.send).toHaveBeenCalledTimes(1)
        expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
          refParentSend: mlEphantManagerActor.send,
          conversationId: 'saved-conversation-id',
        })
      })
    } finally {
      onlineSpy.mockRestore()
    }
  })

  test('reconnects an initially offline project after its saved conversation lookup has finished', async () => {
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'saved-conversation-id']]),
    })
    const onlineSpy = vi
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false)
    const mlEphantManagerActor = createFakeActor({
      abruptlyClosed: true,
      awaitingResponse: false,
      conversation: undefined,
      includeConversationId: false,
      value: 'await',
    })

    try {
      renderPane({
        mlEphantManagerActor,
        conversationStore,
        settingsMetaId: 'project-id',
        theProject: {
          name: 'sample-project',
          path: '/tmp/sample-project',
        },
      })

      await waitFor(() => {
        expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
          'project-id'
        )
      })
      await waitFor(() => {
        expect(conversationStore.getProjectConversationId).toHaveResolvedWith(
          'saved-conversation-id'
        )
      })
      mlEphantManagerActor.send.mockClear()

      onlineSpy.mockReturnValue(true)
      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(mlEphantManagerActor.send).toHaveBeenCalledTimes(1)
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: mlEphantManagerActor.send,
        conversationId: 'saved-conversation-id',
      })
    } finally {
      onlineSpy.mockRestore()
    }
  })

  test('uses the current project conversation when reconnecting after an offline project switch', async () => {
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([
        ['project-a-id', 'project-a-conversation'],
        ['project-b-id', 'project-b-conversation'],
      ]),
    })
    const onlineSpy = vi
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false)
    const mlEphantManagerActor = createFakeActor({
      abruptlyClosed: true,
      awaitingResponse: false,
      conversation: undefined,
      conversationId: 'project-a-conversation',
      value: 'await',
    })

    try {
      const { rerender } = renderPane({
        mlEphantManagerActor,
        conversationStore,
        settingsMetaId: 'project-a-id',
        theProject: {
          name: 'project-a',
          path: '/tmp/project-a',
        },
      })

      await waitFor(() => {
        expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
          'project-a-id'
        )
      })

      rerender(
        createPaneElement({
          mlEphantManagerActor,
          conversationStore,
          settingsMetaId: 'project-b-id',
          theProject: {
            name: 'project-b',
            path: '/tmp/project-b',
          },
        })
      )

      await waitFor(() => {
        expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
          'project-b-id'
        )
      })
      mlEphantManagerActor.send.mockClear()

      onlineSpy.mockReturnValue(true)
      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(mlEphantManagerActor.send).toHaveBeenCalledTimes(1)
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: mlEphantManagerActor.send,
        conversationId: 'project-b-conversation',
      })
    } finally {
      onlineSpy.mockRestore()
    }
  })

  test('does not defer reconnecting a project without a saved project id', () => {
    const onlineSpy = vi
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false)
    const mlEphantManagerActor = createFakeActor({
      abruptlyClosed: true,
      awaitingResponse: false,
      conversation: undefined,
      includeConversationId: false,
      value: 'await',
    })

    try {
      renderPane({ mlEphantManagerActor })
      mlEphantManagerActor.send.mockClear()

      onlineSpy.mockReturnValue(true)
      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(mlEphantManagerActor.send).toHaveBeenCalledTimes(1)
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        refParentSend: mlEphantManagerActor.send,
        conversationId: undefined,
      })
    } finally {
      onlineSpy.mockRestore()
    }
  })

  test('does not automatically reconnect after setup gives up', async () => {
    vi.useFakeTimers()
    const mlEphantManagerActor = createFakeActor({
      abruptlyClosed: true,
      setupFailed: true,
      conversation: undefined,
      value: 'await',
      awaitingResponse: false,
    })

    try {
      renderPane({ mlEphantManagerActor })

      await vi.advanceTimersByTimeAsync(3000)

      expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  test('does not offer Clear chat after a fresh conversation fails', () => {
    const mlEphantManagerActor = createFakeActor({
      abruptlyClosed: true,
      setupFailed: true,
      conversation: undefined,
      includeConversationId: false,
      value: 'await',
      awaitingResponse: false,
    })

    renderPane({ mlEphantManagerActor })

    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: /Clear chat/ })
    ).not.toBeInTheDocument()
  })

  test('keeps the cancel button visible while the actor is still awaiting a response', () => {
    renderPane()

    expect(
      screen.getByTestId('ml-ephant-conversation-cancel-button')
    ).toBeInTheDocument()
  })

  test('queues follow-up input while the actor is still awaiting a response', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      renderPane()

      fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
        target: { value: 'make a cube 20mm' },
      })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      expect(screen.getByText('Queued')).toBeInTheDocument()
      expect(screen.getByText('make a cube 20mm')).toBeInTheDocument()
    } finally {
      warnSpy.mockRestore()
    }
  })

  test('keeps queued prompts while reconnecting instead of sending them during setup', () => {
    const mlEphantManagerActor = createStatefulPromptActor(true)
    renderPane({ mlEphantManagerActor })

    fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
      target: { value: 'send this after reconnecting' },
    })
    fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))
    expect(screen.getByText('send this after reconnecting')).toBeInTheDocument()

    act(() => {
      mlEphantManagerActor.setConnectionState('setup', false)
    })

    expect(screen.getByText('send this after reconnecting')).toBeInTheDocument()
    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.MessageSend,
      })
    )
  })

  test('syncs billing when prompt processing finishes', () => {
    const mlEphantManagerActor = createStatefulPromptActor(false)
    const sendBillingUpdate = vi.fn()
    const sendBillingUsageStarted = vi.fn()
    const sendBillingUsageEnded = vi.fn()

    renderPane({
      mlEphantManagerActor,
      sendBillingUpdate,
      sendBillingUsageStarted,
      sendBillingUsageEnded,
    })

    expect(sendBillingUpdate).not.toHaveBeenCalled()
    expect(sendBillingUsageStarted).not.toHaveBeenCalled()
    expect(sendBillingUsageEnded).not.toHaveBeenCalled()

    act(() => {
      mlEphantManagerActor.setAwaitingResponse(true)
    })

    expect(sendBillingUsageStarted).toHaveBeenCalledTimes(1)
    expect(sendBillingUpdate).not.toHaveBeenCalled()
    expect(sendBillingUsageEnded).not.toHaveBeenCalled()

    act(() => {
      mlEphantManagerActor.setAwaitingResponse(false)
    })

    expect(sendBillingUsageEnded).toHaveBeenCalledTimes(1)
    expect(sendBillingUpdate).toHaveBeenCalledTimes(1)
  })

  test('uses the server default mode when no project setting is set', () => {
    renderPane({
      mlEphantManagerActor: createFakeActor({
        defaultMode: 'deep',
        modeOptions: [
          {
            id: 'standard',
            label: 'Standard',
            description: 'Faster reasoning.',
            icon: 'stopwatch',
            disabled: false,
          },
          {
            id: 'deep',
            label: 'Deep',
            description: 'More thorough reasoning.',
            icon: 'brain',
            disabled: false,
          },
        ],
      }),
    })

    expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
      'Deep'
    )
  })

  test('uses a stored project mode over the server default', () => {
    renderPane({
      zookeeperMode: { project: 'standard' },
      mlEphantManagerActor: createFakeActor({
        defaultMode: 'deep',
        modeOptions: [
          {
            id: 'standard',
            label: 'Standard',
            description: 'Faster reasoning.',
            icon: 'stopwatch',
            disabled: false,
          },
          {
            id: 'deep',
            label: 'Deep',
            description: 'More thorough reasoning.',
            icon: 'brain',
            disabled: false,
          },
        ],
      }),
    })

    expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
      'Standard'
    )
  })

  test('sends the live editor contents for the active file when starting a prompt', async () => {
    const projectRoot = fsZds.join(
      '/tmp',
      `zookeeper-current-file-${Date.now()}`
    )
    const projectPath = fsZds.join(projectRoot, 'demo-project')
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const diskCode = 'boxHeight = 50mm\n'
    const editorCode = 'boxHeight = 500mm\n'
    const mlEphantManagerActor = createFakeActor({
      awaitingResponse: false,
    })

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(mainPath, new TextEncoder().encode(diskCode))

    try {
      renderPane({
        mlEphantManagerActor,
        settingsProjectDirectory: projectRoot,
        theProject: {
          name: 'demo-project',
          path: projectPath,
        },
        loaderFile: {
          name: 'main.kcl',
          path: mainPath,
          children: null,
        },
        kclManager: {
          code: editorCode,
          path: mainPath,
          execState: {
            filenames: {
              0: {
                type: 'Local',
                value: mainPath,
                original_import_path: null,
              },
            },
          },
          artifactGraph: {},
        },
      })

      fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
        target: { value: 'change the height to 5000' },
      })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      await waitFor(() => {
        expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
          expect.objectContaining({
            type: MlEphantManagerTransitions.MessageSend,
          })
        )
      })

      const messageSend = mlEphantManagerActor.send.mock.calls
        .map(([event]) => event)
        .find((event) => event.type === MlEphantManagerTransitions.MessageSend)
      const activeProjectFile = messageSend?.projectFiles.find(
        (file: { relPath: string }) => file.relPath === 'main.kcl'
      )

      expect(messageSend?.fileSelectedDuringPrompting.content).toBe(editorCode)
      expect(activeProjectFile?.fileContents).toBe(editorCode)
    } finally {
      await fsZds.rm(projectRoot, { recursive: true, force: true })
    }
  })

  test('retries cache setup when the project becomes available after settings load', async () => {
    const mlEphantManagerActor = createFakeActor({
      conversation: undefined,
      value: 'await',
    })
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'conversation-id']]),
    })

    const { rerender } = renderPane({
      mlEphantManagerActor,
      conversationStore,
      settingsMetaId: 'project-id',
      theProject: undefined,
    })

    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
      })
    )

    rerender(
      <MemoryRouter>
        <MlEphantConversationPane
          mlEphantManagerActor={mlEphantManagerActor as any}
          conversationStore={conversationStore}
          kclManager={
            {
              code: '',
              execState: {
                filenames: [],
              },
              artifactGraph: {},
            } as any
          }
          theProject={
            {
              name: 'sample-project',
              path: '/tmp/sample-project',
            } as any
          }
          contextModeling={
            {
              selectionRanges: {
                graphSelections: [],
                otherSelections: [],
              },
            } as any
          }
          sendModeling={vi.fn() as any}
          sendBillingUpdate={vi.fn()}
          sendBillingUsageStarted={vi.fn()}
          sendBillingUsageEnded={vi.fn()}
          loaderFile={undefined}
          settings={
            {
              meta: {
                id: {
                  current: 'project-id',
                },
              },
              app: {
                projectDirectory: {
                  current: '',
                },
                zookeeperMode: {
                  current: undefined,
                  project: undefined,
                  user: undefined,
                },
              },
              modeling: {
                useSketchSolveMode: {
                  current: false,
                },
              },
            } as any
          }
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
          conversationId: 'conversation-id',
        })
      )
    })
  })

  test('loads saved project conversations from the Zookeeper conversation store', async () => {
    const mlEphantManagerActor = createFakeActor({
      conversation: undefined,
      value: 'await',
    })
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'conversation-id']]),
    })

    renderPane({
      mlEphantManagerActor,
      conversationStore,
      settingsMetaId: 'project-id',
      theProject: {
        name: 'sample-project',
        path: '/tmp/sample-project',
      },
    })

    await waitFor(() => {
      expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
        'project-id'
      )
    })

    await waitFor(() => {
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
          conversationId: 'conversation-id',
        })
      )
    })
  })

  test('clearing chat forgets the saved project conversation before starting a fresh one', async () => {
    const mlEphantManagerActor = createStatefulClearChatActor()
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'old-conversation-id']]),
    })

    renderPane({
      mlEphantManagerActor,
      conversationStore,
      settingsMetaId: 'project-id',
      theProject: {
        name: 'sample-project',
        path: '/tmp/sample-project',
      },
    })
    mlEphantManagerActor.send.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

    await waitFor(() => {
      expect(
        conversationStore.deleteProjectConversationId
      ).toHaveBeenCalledWith('project-id')
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
        type: MlEphantManagerTransitions.ConversationClose,
      })
    })
    await waitFor(() => {
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
          conversationId: undefined,
        })
      )
    })
    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: 'old-conversation-id',
      })
    )
  })

  test('waits for the saved project conversation delete before starting a fresh one', async () => {
    const mlEphantManagerActor = createStatefulClearChatActor()
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'old-conversation-id']]),
      completeDeletesAutomatically: false,
    })

    renderPane({
      mlEphantManagerActor,
      conversationStore,
      settingsMetaId: 'project-id',
      theProject: {
        name: 'sample-project',
        path: '/tmp/sample-project',
      },
    })
    mlEphantManagerActor.send.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

    await waitFor(() => {
      expect(
        conversationStore.deleteProjectConversationId
      ).toHaveBeenCalledWith('project-id')
    })
    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith({
      type: MlEphantManagerTransitions.ConversationClose,
    })
    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
      })
    )

    conversationStore.completeDelete()

    await waitFor(() => {
      expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
          conversationId: undefined,
        })
      )
    })
  })

  test('keeps the current chat when deleting its saved mapping fails', async () => {
    const mlEphantManagerActor = createStatefulClearChatActor()
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'old-conversation-id']]),
    })
    vi.mocked(
      conversationStore.deleteProjectConversationId
    ).mockRejectedValueOnce(new Error('storage unavailable'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      renderPane({
        mlEphantManagerActor,
        conversationStore,
        settingsMetaId: 'project-id',
        theProject: {
          name: 'sample-project',
          path: '/tmp/sample-project',
        },
      })
      mlEphantManagerActor.send.mockClear()

      fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalled()
      })
      expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith({
        type: MlEphantManagerTransitions.ConversationClose,
      })
      expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: MlEphantManagerTransitions.CacheSetupAndConnect,
          conversationId: undefined,
        })
      )
      expect(
        await conversationStore.getProjectConversationId('project-id')
      ).toBe('old-conversation-id')
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('disables recovery actions while clearing a saved chat', async () => {
    const mlEphantManagerActor = createFakeActor({
      abruptlyClosed: true,
      setupFailed: true,
      conversation: undefined,
      value: 'await',
      awaitingResponse: false,
    })
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'conversation-id']]),
      completeDeletesAutomatically: false,
    })

    renderPane({
      mlEphantManagerActor,
      conversationStore,
      settingsMetaId: 'project-id',
    })

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

    await waitFor(() => {
      expect(
        conversationStore.deleteProjectConversationId
      ).toHaveBeenCalledWith('project-id')
    })
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clearing...' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
      })
    )
  })

  test('does not finish clearing an old project after switching projects', async () => {
    const mlEphantManagerActor = createStatefulClearChatActor()
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-a', 'old-conversation-id']]),
      completeDeletesAutomatically: false,
    })
    const projectA = {
      name: 'project-a',
      path: '/tmp/project-a',
    }
    const { rerender } = renderPane({
      mlEphantManagerActor,
      conversationStore,
      settingsMetaId: 'project-a',
      theProject: projectA,
    })

    await waitFor(() => {
      expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
        'project-a'
      )
    })
    mlEphantManagerActor.send.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))
    await waitFor(() => {
      expect(
        conversationStore.deleteProjectConversationId
      ).toHaveBeenCalledWith('project-a')
    })

    rerender(
      createPaneElement({
        mlEphantManagerActor,
        conversationStore,
        settingsMetaId: 'project-b',
        theProject: undefined,
      })
    )
    mlEphantManagerActor.send.mockClear()

    await act(async () => {
      conversationStore.completeDelete()
      await Promise.resolve()
    })

    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith({
      type: MlEphantManagerTransitions.ConversationClose,
    })
    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: undefined,
      })
    )
  })
})
