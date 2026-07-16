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

import { ZookeeperConversationPane } from '@src/lib/zookeeper/components/ZookeeperConversationPane'
import type { ZookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import type {
  Conversation,
  MlCopilotModeId,
  MlCopilotModeOption,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { ZookeeperManagerTransitions } from '@src/lib/zookeeper/zookeeperManagerMachine'

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
}: {
  conversation?: Conversation
  defaultMode?: MlCopilotModeId
  modeOptions?: MlCopilotModeOption[]
  value?: string
  awaitingResponse?: boolean
} = {}): FakeZookeeperActor => {
  const snapshot: FakeZookeeperSnapshot = {
    value,
    context: {
      abruptlyClosed: false,
      awaitingResponse,
      attachmentsLoadedForCurrentPrompt: true,
      conversation,
      conversationId: 'conversation-id',
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
  }

  return actor
}

const renderPane = ({
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
}: {
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
} = {}) => {
  return render(
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

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('ZookeeperConversationPane', () => {
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

    expect(conversationStore.deleteProjectConversationId).toHaveBeenCalledWith(
      'project-id'
    )
    expect(zookeeperManagerActor.send).toHaveBeenCalledWith({
      type: ZookeeperManagerTransitions.ConversationClose,
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

    expect(conversationStore.deleteProjectConversationId).toHaveBeenCalledWith(
      'project-id'
    )
    expect(zookeeperManagerActor.send).toHaveBeenCalledWith({
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
})
