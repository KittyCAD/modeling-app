import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NIL as uuidNIL } from 'uuid'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { createActor } from 'xstate'

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

import { ZookeeperConversationPane } from '@src/lib/zookeeper/components/ZookeeperConversationPane'
import type { ZookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import type {
  Conversation,
  MlCopilotModeId,
  MlCopilotModeOption,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import {
  zookeeperManagerMachine,
  ZookeeperManagerTransitions,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { S } from '@src/machines/utils'

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

type FakeZookeeperSnapshot = {
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

type FakeZookeeperActor = {
  getSnapshot: () => FakeZookeeperSnapshot
  subscribe: (listener?: (next: FakeZookeeperSnapshot) => void) => {
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
} = {}): FakeZookeeperActor => {
  const snapshot: FakeZookeeperSnapshot = {
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
  let snapshot: FakeZookeeperSnapshot = {
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
  const listeners = new Set<(next: FakeZookeeperSnapshot) => void>()

  const actor: FakeZookeeperActor = {
    getSnapshot: () => snapshot,
    subscribe: (listener?: (next: FakeZookeeperSnapshot) => void) => {
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
      if (event.type !== ZookeeperManagerTransitions.ConversationClose) {
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
  let snapshot: FakeZookeeperSnapshot = {
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
  const listeners = new Set<(next: FakeZookeeperSnapshot) => void>()

  const actor = {
    getSnapshot: () => snapshot,
    subscribe: (listener?: (next: FakeZookeeperSnapshot) => void) => {
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
  zookeeperManagerActor?: FakeZookeeperActor
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
  zookeeperManagerActor = createFakeActor(),
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
      <ZookeeperConversationPane
        zookeeperManagerActor={zookeeperManagerActor as any}
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

describe('ZookeeperConversationPane', () => {
  test('shows recovery while offline and reconnects when the browser comes online', async () => {
    vi.useFakeTimers()
    const zookeeperManagerActor = createFakeActor({
      awaitingResponse: false,
    })

    try {
      renderPane({ zookeeperManagerActor })

      act(() => {
        window.dispatchEvent(new Event('offline'))
      })

      expect(zookeeperManagerActor.send).toHaveBeenCalledWith({
        type: ZookeeperManagerTransitions.NetworkOffline,
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

      expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        })
      )

      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      expect(zookeeperManagerActor.send).toHaveBeenCalledWith({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: zookeeperManagerActor.send,
        conversationId: 'conversation-id',
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  test('does not repeatedly request setup while waiting for an API token', async () => {
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'saved-conversation-id']]),
    })
    const zookeeperManagerActor = createActor(zookeeperManagerMachine, {
      input: { apiToken: '' },
    }).start()
    const send = zookeeperManagerActor.send.bind(zookeeperManagerActor)
    let setupRequestCount = 0

    zookeeperManagerActor.send = (event) => {
      if (event.type === ZookeeperManagerTransitions.CacheSetupAndConnect) {
        setupRequestCount += 1
        if (setupRequestCount > 5) {
          return
        }
      }

      send(event)
    }

    try {
      renderPane({
        zookeeperManagerActor: zookeeperManagerActor as any,
        conversationStore,
        settingsMetaId: 'project-id',
        theProject: {
          name: 'sample-project',
          path: '/tmp/sample-project',
        },
      })

      await waitFor(() => {
        expect(
          zookeeperManagerActor.getSnapshot().context.cachedSetup
        ).toBeDefined()
      })

      expect(setupRequestCount).toBe(1)
      expect(zookeeperManagerActor.getSnapshot().matches(S.Await)).toBe(true)
      expect(zookeeperManagerActor.getSnapshot().context.apiToken).toBe('')
    } finally {
      zookeeperManagerActor.stop()
    }
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
    const zookeeperManagerActor = createFakeActor({
      abruptlyClosed: true,
      awaitingResponse: false,
      conversation: undefined,
      includeConversationId: false,
      value: 'await',
    })

    try {
      renderPane({
        zookeeperManagerActor,
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
      zookeeperManagerActor.send.mockClear()

      onlineSpy.mockReturnValue(true)
      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        })
      )

      await act(async () => {
        resolveLookup('saved-conversation-id')
        await pendingLookup
      })

      await waitFor(() => {
        expect(zookeeperManagerActor.send).toHaveBeenCalledTimes(1)
        expect(zookeeperManagerActor.send).toHaveBeenCalledWith({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          refParentSend: zookeeperManagerActor.send,
          conversationId: 'saved-conversation-id',
        })
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
    const zookeeperManagerActor = createFakeActor({
      abruptlyClosed: true,
      awaitingResponse: false,
      conversation: undefined,
      conversationId: 'project-a-conversation',
      value: 'await',
    })

    try {
      const { rerender } = renderPane({
        zookeeperManagerActor,
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
          zookeeperManagerActor,
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
      zookeeperManagerActor.send.mockClear()

      onlineSpy.mockReturnValue(true)
      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(zookeeperManagerActor.send).toHaveBeenCalledTimes(1)
      expect(zookeeperManagerActor.send).toHaveBeenCalledWith({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        refParentSend: zookeeperManagerActor.send,
        conversationId: 'project-b-conversation',
      })
    } finally {
      onlineSpy.mockRestore()
    }
  })

  test('does not automatically reconnect after setup gives up', async () => {
    vi.useFakeTimers()
    const zookeeperManagerActor = createFakeActor({
      abruptlyClosed: true,
      setupFailed: true,
      conversation: undefined,
      value: 'await',
      awaitingResponse: false,
    })

    try {
      renderPane({ zookeeperManagerActor })

      await vi.advanceTimersByTimeAsync(3000)

      expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        })
      )
    } finally {
      vi.useRealTimers()
    }
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
    const zookeeperManagerActor = createStatefulPromptActor(true)
    renderPane({ zookeeperManagerActor })

    fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
      target: { value: 'send this after reconnecting' },
    })
    fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))
    expect(screen.getByText('send this after reconnecting')).toBeInTheDocument()

    act(() => {
      zookeeperManagerActor.setConnectionState('setup', false)
    })

    expect(screen.getByText('send this after reconnecting')).toBeInTheDocument()
    expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: ZookeeperManagerTransitions.MessageSend,
      })
    )
  })

  test('syncs billing when prompt processing finishes', () => {
    const zookeeperManagerActor = createStatefulPromptActor(false)
    const sendBillingUpdate = vi.fn()
    const sendBillingUsageStarted = vi.fn()
    const sendBillingUsageEnded = vi.fn()

    renderPane({
      zookeeperManagerActor,
      sendBillingUpdate,
      sendBillingUsageStarted,
      sendBillingUsageEnded,
    })

    expect(sendBillingUpdate).not.toHaveBeenCalled()
    expect(sendBillingUsageStarted).not.toHaveBeenCalled()
    expect(sendBillingUsageEnded).not.toHaveBeenCalled()

    act(() => {
      zookeeperManagerActor.setAwaitingResponse(true)
    })

    expect(sendBillingUsageStarted).toHaveBeenCalledTimes(1)
    expect(sendBillingUpdate).not.toHaveBeenCalled()
    expect(sendBillingUsageEnded).not.toHaveBeenCalled()

    act(() => {
      zookeeperManagerActor.setAwaitingResponse(false)
    })

    expect(sendBillingUsageEnded).toHaveBeenCalledTimes(1)
    expect(sendBillingUpdate).toHaveBeenCalledTimes(1)
  })

  test('uses the server default mode when no project setting is set', () => {
    renderPane({
      zookeeperManagerActor: createFakeActor({
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
      zookeeperManagerActor: createFakeActor({
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
    const zookeeperManagerActor = createFakeActor({
      awaitingResponse: false,
    })

    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(mainPath, new TextEncoder().encode(diskCode))

    try {
      renderPane({
        zookeeperManagerActor,
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
        expect(zookeeperManagerActor.send).toHaveBeenCalledWith(
          expect.objectContaining({
            type: ZookeeperManagerTransitions.MessageSend,
          })
        )
      })

      const messageSend = zookeeperManagerActor.send.mock.calls
        .map(([event]) => event)
        .find((event) => event.type === ZookeeperManagerTransitions.MessageSend)
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
    const zookeeperManagerActor = createFakeActor({
      conversation: undefined,
      value: 'await',
    })
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'conversation-id']]),
    })

    const { rerender } = renderPane({
      zookeeperManagerActor,
      conversationStore,
      settingsMetaId: 'project-id',
      theProject: undefined,
    })

    expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      })
    )

    rerender(
      <MemoryRouter>
        <ZookeeperConversationPane
          zookeeperManagerActor={zookeeperManagerActor as any}
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
      expect(zookeeperManagerActor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          conversationId: 'conversation-id',
        })
      )
    })
  })

  test('loads saved project conversations from the Zookeeper conversation store', async () => {
    const zookeeperManagerActor = createFakeActor({
      conversation: undefined,
      value: 'await',
    })
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'conversation-id']]),
    })

    renderPane({
      zookeeperManagerActor,
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
      expect(zookeeperManagerActor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          conversationId: 'conversation-id',
        })
      )
    })
  })

  test('clearing chat forgets the saved project conversation before starting a fresh one', async () => {
    const zookeeperManagerActor = createStatefulClearChatActor()
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'old-conversation-id']]),
    })

    renderPane({
      zookeeperManagerActor,
      conversationStore,
      settingsMetaId: 'project-id',
      theProject: {
        name: 'sample-project',
        path: '/tmp/sample-project',
      },
    })
    zookeeperManagerActor.send.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

    await waitFor(() => {
      expect(
        conversationStore.deleteProjectConversationId
      ).toHaveBeenCalledWith('project-id')
      expect(zookeeperManagerActor.send).toHaveBeenCalledWith({
        type: ZookeeperManagerTransitions.ConversationClose,
      })
    })
    await waitFor(() => {
      expect(zookeeperManagerActor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          conversationId: undefined,
        })
      )
    })
    expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        conversationId: 'old-conversation-id',
      })
    )
  })

  test('waits for the saved project conversation delete before starting a fresh one', async () => {
    const zookeeperManagerActor = createStatefulClearChatActor()
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'old-conversation-id']]),
      completeDeletesAutomatically: false,
    })

    renderPane({
      zookeeperManagerActor,
      conversationStore,
      settingsMetaId: 'project-id',
      theProject: {
        name: 'sample-project',
        path: '/tmp/sample-project',
      },
    })
    zookeeperManagerActor.send.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

    await waitFor(() => {
      expect(
        conversationStore.deleteProjectConversationId
      ).toHaveBeenCalledWith('project-id')
    })
    expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith({
      type: ZookeeperManagerTransitions.ConversationClose,
    })
    expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      })
    )

    conversationStore.completeDelete()

    await waitFor(() => {
      expect(zookeeperManagerActor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          conversationId: undefined,
        })
      )
    })
  })

  test('keeps the current chat when deleting its saved mapping fails', async () => {
    const zookeeperManagerActor = createStatefulClearChatActor()
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-id', 'old-conversation-id']]),
    })
    vi.mocked(
      conversationStore.deleteProjectConversationId
    ).mockRejectedValueOnce(new Error('storage unavailable'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      renderPane({
        zookeeperManagerActor,
        conversationStore,
        settingsMetaId: 'project-id',
        theProject: {
          name: 'sample-project',
          path: '/tmp/sample-project',
        },
      })
      zookeeperManagerActor.send.mockClear()

      fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalled()
      })
      expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith({
        type: ZookeeperManagerTransitions.ConversationClose,
      })
      expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
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

  test('does not finish clearing an old project after switching projects', async () => {
    const zookeeperManagerActor = createStatefulClearChatActor()
    const conversationStore = createFakeConversationStore({
      projectConversations: new Map([['project-a', 'old-conversation-id']]),
      completeDeletesAutomatically: false,
    })
    const projectA = {
      name: 'project-a',
      path: '/tmp/project-a',
    }
    const { rerender } = renderPane({
      zookeeperManagerActor,
      conversationStore,
      settingsMetaId: 'project-a',
      theProject: projectA,
    })

    await waitFor(() => {
      expect(conversationStore.getProjectConversationId).toHaveBeenCalledWith(
        'project-a'
      )
    })
    zookeeperManagerActor.send.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))
    await waitFor(() => {
      expect(
        conversationStore.deleteProjectConversationId
      ).toHaveBeenCalledWith('project-a')
    })

    rerender(
      createPaneElement({
        zookeeperManagerActor,
        conversationStore,
        settingsMetaId: 'project-b',
        theProject: undefined,
      })
    )
    zookeeperManagerActor.send.mockClear()

    await act(async () => {
      conversationStore.completeDelete()
      await Promise.resolve()
    })

    expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith({
      type: ZookeeperManagerTransitions.ConversationClose,
    })
    expect(zookeeperManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: ZookeeperManagerTransitions.CacheSetupAndConnect,
        conversationId: undefined,
      })
    )
  })
})
