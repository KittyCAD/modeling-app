import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NIL as uuidNIL } from 'uuid'
import { describe, expect, test, vi } from 'vitest'

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
  useExecutingEditor: () => ({
    executingEditor: {
      astSignal: { value: null },
    },
  }),
}))

import { MlEphantConversationPane } from '@src/components/layout/areas/MlEphantConversationPane'
import type {
  Conversation,
  MlCopilotModeId,
  MlCopilotModeOption,
} from '@src/machines/mlEphantManagerMachine'
import { MlEphantManagerTransitions } from '@src/machines/mlEphantManagerMachine'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'

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
}: {
  conversation?: Conversation
  defaultMode?: MlCopilotModeId
  modeOptions?: MlCopilotModeOption[]
  value?: string
} = {}): FakeMlEphantActor => {
  const snapshot: FakeMlEphantSnapshot = {
    value,
    context: {
      abruptlyClosed: false,
      awaitingResponse: true,
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

const createFakeSystemIOActor = ({
  mlEphantConversations = undefined,
  completeSavesAutomatically = true,
}: {
  mlEphantConversations?: Map<string, string>
  completeSavesAutomatically?: boolean
} = {}) => {
  type SaveConversationEvent = {
    type: SystemIOMachineEvents
    data?: { projectId?: string; conversationId?: string }
  }
  let snapshot = {
    value: SystemIOMachineStates.idle,
    context: {
      mlEphantConversations,
    },
  }
  let pendingSaveEvent: SaveConversationEvent | undefined
  const listeners = new Set<(next: typeof snapshot) => void>()
  const notify = () => listeners.forEach((listener) => listener(snapshot))
  const completeSave = () => {
    if (pendingSaveEvent === undefined) {
      return
    }

    const nextConversations = new Map(snapshot.context.mlEphantConversations)
    const projectId = pendingSaveEvent.data?.projectId
    if (projectId !== undefined) {
      if (
        pendingSaveEvent.type ===
        SystemIOMachineEvents.deleteMlEphantConversation
      ) {
        nextConversations.delete(projectId)
      } else if (pendingSaveEvent.data?.conversationId !== undefined) {
        nextConversations.set(projectId, pendingSaveEvent.data.conversationId)
      }
    }
    pendingSaveEvent = undefined
    snapshot = {
      value: SystemIOMachineStates.idle,
      context: {
        mlEphantConversations: nextConversations,
      },
    }
    notify()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener?: (next: typeof snapshot) => void) => {
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
    completeSave,
    send: vi.fn((event: SaveConversationEvent) => {
      if (
        event.type !== SystemIOMachineEvents.saveMlEphantConversations &&
        event.type !== SystemIOMachineEvents.deleteMlEphantConversation
      ) {
        return
      }

      snapshot = {
        ...snapshot,
        value: SystemIOMachineStates.savingMlEphantConversations,
      }
      notify()
      pendingSaveEvent = event
      if (completeSavesAutomatically) {
        completeSave()
      }
    }),
  }
}

const createStatefulClearChatActor = () => {
  let snapshot: FakeMlEphantSnapshot = {
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
      listeners.forEach((listener) => listener(snapshot))
    }),
  }

  return actor
}

const renderPane = ({
  mlEphantManagerActor = createFakeActor(),
  systemIOActor = createFakeSystemIOActor(),
  theProject = undefined,
  settingsMetaId = uuidNIL,
  zookeeperMode = {},
}: {
  mlEphantManagerActor?: ReturnType<typeof createFakeActor>
  systemIOActor?: ReturnType<typeof createFakeSystemIOActor>
  theProject?: any
  settingsMetaId?: string
  zookeeperMode?: {
    current?: MlCopilotModeId
    project?: MlCopilotModeId
    user?: MlCopilotModeId
  }
} = {}) => {
  return render(
    <MemoryRouter>
      <MlEphantConversationPane
        mlEphantManagerActor={mlEphantManagerActor as any}
        systemIOActor={systemIOActor as any}
        executingEditor={
          {
            code: '',
            execState: {
              filenames: [],
            },
            artifactGraph: {},
          } as any
        }
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
        sendBillingUpdate={vi.fn()}
        loaderFile={undefined}
        settings={
          {
            meta: {
              id: {
                current: settingsMetaId,
              },
            },
            app: {
              projectDirectory: {
                current: '',
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
      />
    </MemoryRouter>
  )
}

describe('MlEphantConversationPane', () => {
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

  test('retries cache setup when the project becomes available after settings load', () => {
    const mlEphantManagerActor = createFakeActor({
      conversation: undefined,
      value: 'await',
    })
    const systemIOActor = createFakeSystemIOActor({
      mlEphantConversations: new Map([['project-id', 'conversation-id']]),
    })

    const { rerender } = renderPane({
      mlEphantManagerActor,
      systemIOActor,
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
          systemIOActor={systemIOActor as any}
          executingEditor={
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

    expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: 'conversation-id',
      })
    )
  })

  test('clearing chat forgets the saved project conversation before starting a fresh one', () => {
    const mlEphantManagerActor = createStatefulClearChatActor()
    const systemIOActor = createFakeSystemIOActor({
      mlEphantConversations: new Map([['project-id', 'old-conversation-id']]),
    })

    renderPane({
      mlEphantManagerActor,
      systemIOActor,
      settingsMetaId: 'project-id',
      theProject: {
        name: 'sample-project',
        path: '/tmp/sample-project',
      },
    })
    mlEphantManagerActor.send.mockClear()
    systemIOActor.send.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

    expect(systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.deleteMlEphantConversation,
      data: {
        projectId: 'project-id',
      },
    })
    expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
      type: MlEphantManagerTransitions.ConversationClose,
    })
    expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: undefined,
      })
    )
    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: 'old-conversation-id',
      })
    )
  })

  test('waits for the saved project conversation delete before starting a fresh one', () => {
    const mlEphantManagerActor = createStatefulClearChatActor()
    const systemIOActor = createFakeSystemIOActor({
      mlEphantConversations: new Map([['project-id', 'old-conversation-id']]),
      completeSavesAutomatically: false,
    })

    renderPane({
      mlEphantManagerActor,
      systemIOActor,
      settingsMetaId: 'project-id',
      theProject: {
        name: 'sample-project',
        path: '/tmp/sample-project',
      },
    })
    mlEphantManagerActor.send.mockClear()
    systemIOActor.send.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /Clear chat/ }))

    expect(systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.deleteMlEphantConversation,
      data: {
        projectId: 'project-id',
      },
    })
    expect(mlEphantManagerActor.send).toHaveBeenCalledWith({
      type: MlEphantManagerTransitions.ConversationClose,
    })
    expect(mlEphantManagerActor.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
      })
    )

    systemIOActor.completeSave()

    expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: undefined,
      })
    )
  })
})
