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
import type { Conversation } from '@src/machines/mlEphantManagerMachine'

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

const createFakeActor = (conversation = completedConversation) => {
  const snapshot = {
    value: 'ready',
    context: {
      abruptlyClosed: false,
      awaitingResponse: true,
      conversation,
      conversationId: 'conversation-id',
    },
    matches: () => false,
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: () => ({
      unsubscribe: vi.fn(),
    }),
    send: vi.fn(),
  }
}

const createFakeSystemIOActor = () => ({
  getSnapshot: () => ({
    value: 'idle',
    context: {
      mlEphantConversations: undefined,
    },
  }),
  subscribe: () => ({
    unsubscribe: vi.fn(),
  }),
  send: vi.fn(),
})

const renderPane = () => {
  return render(
    <MemoryRouter>
      <MlEphantConversationPane
        mlEphantManagerActor={createFakeActor() as any}
        systemIOActor={createFakeSystemIOActor() as any}
        kclManager={
          {
            code: '',
            execState: {
              filenames: [],
            },
            artifactGraph: {},
          } as any
        }
        theProject={undefined}
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
                current: uuidNIL,
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
})
