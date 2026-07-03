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
  useSingletons: () => ({
    kclManager: {
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
  awaitingResponse = true,
}: {
  conversation?: Conversation
  defaultMode?: MlCopilotModeId
  modeOptions?: MlCopilotModeOption[]
  value?: string
  awaitingResponse?: boolean
} = {}): FakeMlEphantActor => {
  const snapshot: FakeMlEphantSnapshot = {
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

const createFakeSystemIOActor = ({
  mlEphantConversations = undefined,
  completeSavesAutomatically = true,
  value = SystemIOMachineStates.idle,
}: {
  mlEphantConversations?: Map<string, string>
  completeSavesAutomatically?: boolean
  value?: SystemIOMachineStates
} = {}) => {
  type SaveConversationEvent = {
    type: SystemIOMachineEvents
    data?: { projectId?: string; conversationId?: string }
  }
  type FakeSystemIOSnapshot = {
    value: SystemIOMachineStates
    context: {
      mlEphantConversations?: Map<string, string>
    }
  }
  let snapshot: FakeSystemIOSnapshot = {
    value,
    context: {
      mlEphantConversations,
    },
  }
  let pendingSaveEvent: SaveConversationEvent | undefined
  const listeners = new Set<(next: typeof snapshot) => void>()
  const notify = () => {
    for (const listener of listeners) {
      listener(snapshot)
    }
  }
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
    setSnapshot: (nextSnapshot: Partial<FakeSystemIOSnapshot>) => {
      snapshot = {
        ...snapshot,
        ...nextSnapshot,
        context: {
          ...snapshot.context,
          ...nextSnapshot.context,
        },
      }
      notify()
    },
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
  }

  return actor
}

const renderPane = ({
  mlEphantManagerActor = createFakeActor(),
  systemIOActor = createFakeSystemIOActor(),
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
  mlEphantManagerActor?: FakeMlEphantActor
  systemIOActor?: ReturnType<typeof createFakeSystemIOActor>
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
      <MlEphantConversationPane
        mlEphantManagerActor={mlEphantManagerActor as any}
        systemIOActor={systemIOActor as any}
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

    expect(mlEphantManagerActor.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MlEphantManagerTransitions.CacheSetupAndConnect,
        conversationId: 'conversation-id',
      })
    )
  })

  test('waits for SystemIO idle before loading saved project conversations', () => {
    const systemIOActor = createFakeSystemIOActor({
      value: SystemIOMachineStates.readingFolders,
    })

    renderPane({
      systemIOActor,
      settingsMetaId: 'project-id',
    })

    expect(systemIOActor.send).not.toHaveBeenCalledWith({
      type: SystemIOMachineEvents.getMlEphantConversations,
    })

    systemIOActor.setSnapshot({
      value: SystemIOMachineStates.idle,
    })

    expect(systemIOActor.send).toHaveBeenCalledWith({
      type: SystemIOMachineEvents.getMlEphantConversations,
    })
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
