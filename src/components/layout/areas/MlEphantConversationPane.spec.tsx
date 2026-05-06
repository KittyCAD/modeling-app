import { fireEvent, render, screen } from '@testing-library/react'
import { expect, vi, describe, test } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { NIL as uuidNIL } from 'uuid'

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
  MlCopilotModeOption,
} from '@src/machines/mlEphantManagerMachine'
import { MlEphantManagerTransitions } from '@src/machines/mlEphantManagerMachine'

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
        } as any,
      ],
      deltasAggregated: 'Done.',
    },
  ],
}

const createFakeActor = ({
  conversation = completedConversation,
  defaultMode = undefined,
  modeOptions = undefined,
  value = 'ready',
}: {
  conversation?: Conversation
  defaultMode?: 'fast' | 'thoughtful'
  modeOptions?: MlCopilotModeOption[]
  value?: string
} = {}) => {
  const snapshot = {
    value,
    context: {
      abruptlyClosed: false,
      awaitingResponse: true,
      conversation,
      conversationId: 'conversation-id',
      defaultMode,
      modeOptions,
    },
    matches: (state: string) => state === value,
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
}: {
  mlEphantConversations?: Map<string, string>
} = {}) => ({
  getSnapshot: () => ({
    value: 'idle',
    context: {
      mlEphantConversations,
    },
  }),
  subscribe: () => ({
    unsubscribe: vi.fn(),
  }),
  send: vi.fn(),
})

const renderPane = ({
  mlEphantManagerActor = createFakeActor(),
  systemIOActor = createFakeSystemIOActor(),
  theProject = undefined,
  settingsMetaId = uuidNIL,
}: {
  mlEphantManagerActor?: ReturnType<typeof createFakeActor>
  systemIOActor?: ReturnType<typeof createFakeSystemIOActor>
  theProject?: any
  settingsMetaId?: string
} = {}) => {
  return render(
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
                current: 'fast',
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
        defaultMode: 'thoughtful',
        modeOptions: [
          {
            id: 'fast',
            label: 'Standard',
            description: 'Faster reasoning.',
            icon: 'stopwatch',
          },
          {
            id: 'thoughtful',
            label: 'Thoughtful',
            description: 'More thorough reasoning.',
            icon: 'brain',
          },
        ],
      }),
    })

    expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
      'Thoughtful'
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
                  current: 'fast',
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
})
