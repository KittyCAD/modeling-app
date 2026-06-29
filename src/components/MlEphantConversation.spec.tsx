import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const bootMockState = vi.hoisted(() => ({
  registry: undefined as unknown,
}))

// Mock modules that access localStorage at import time
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

// Mock useSingletons which requires heavy initialization
vi.mock('@src/lib/boot', () => ({
  useApp: () => {
    if (!bootMockState.registry) {
      throw new Error('Test registry has not been configured')
    }

    return { registry: bootMockState.registry }
  },
  useSingletons: () => ({
    kclManager: {
      astSignal: { value: null },
    },
  }),
}))

vi.mock('@src/lib/screenshot', async (importOriginal) => {
  const original = await importOriginal<typeof ScreenshotModule>()

  return {
    ...original,
    takeViewportScreenshot: vi.fn(),
  }
})

import { Registry } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { MAKEATHON_ANNOUNCEMENT_DISMISSED_STORAGE_KEY } from '@src/components/MakeathonAnnouncement'
import { MlEphantConversation } from '@src/components/MlEphantConversation'
import { takeViewportScreenshot } from '@src/lib/screenshot'
import type * as ScreenshotModule from '@src/lib/screenshot'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type {
  Conversation,
  MlCopilotModeId,
  MlCopilotModeOption,
} from '@src/machines/mlEphantManagerMachine'
import {
  type EngineSceneExtensionContext,
  engineSceneRuntimeExtensionsSlot,
  engineSceneStreamLayersValueSpec,
} from '@src/registry/contracts/engineScene'

const configureTestRegistry = () => {
  const registry = new Registry()
  registry.configure([engineSceneRuntimeExtensionsSlot.of()])
  bootMockState.registry = registry
  return registry
}

const testEngineSceneContext = {
  modelingState: { matches: () => false },
  modelingSend: vi.fn(),
  sketchSolveStreamDimming: 0.8,
  setSketchSolveStreamDimming: vi.fn(),
} as unknown as EngineSceneExtensionContext

const TestEngineSceneStreamLayers = () => {
  useSignals()
  const registry = bootMockState.registry as Registry
  const layers = registry.signal(engineSceneStreamLayersValueSpec).value

  return (
    <>
      {layers.map((layer) => {
        const Component = layer.Component
        return <Component key={layer.id} {...testEngineSceneContext} />
      })}
    </>
  )
}

const SERVER_MODE_OPTIONS: MlCopilotModeOption[] = [
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
]

describe('MlEphantConversation', () => {
  beforeEach(() => {
    configureTestRegistry()
    window.localStorage.removeItem(MAKEATHON_ANNOUNCEMENT_DISMISSED_STORAGE_KEY)
  })

  function rendersRequestBubbleThenDisplayResponse(
    mode: MlCopilotModeId = 'deep'
  ) {
    vi.useFakeTimers()

    let latestConversation: Conversation | undefined = { exchanges: [] }

    const handleProcess = vi.fn(
      (prompt: string, _mode: MlCopilotModeId | undefined, _files: File[]) => {
        latestConversation = {
          exchanges: [
            {
              request: {
                type: 'user',
                content: prompt,
              },
              responses: [],
              deltasAggregated: '',
            },
          ],
        }
      }
    )

    const renderConversation = (
      conversation?: Conversation,
      hasPromptCompleted = true
    ) => {
      return (
        <MlEphantConversation
          isLoading={false}
          conversation={conversation}
          onProcess={handleProcess}
          onClickClearChat={() => {}}
          onReconnect={() => {}}
          onCancel={() => {}}
          needsReconnect={false}
          contexts={[]}
          disabled={false}
          hasPromptCompleted={hasPromptCompleted}
          isProcessing={!hasPromptCompleted}
          queue={[]}
          onRemoveFromQueue={() => {}}
          onSteer={() => {}}
          initialMlCopilotMode="deep"
          modeOptions={SERVER_MODE_OPTIONS}
        />
      )
    }

    const { rerender } = render(renderConversation(latestConversation))

    try {
      const promptText = 'Generate a cube with rounded edges'

      if (mode !== 'deep') {
        fireEvent.click(screen.getByTestId('ml-copilot-efforts-button'))
        fireEvent.click(screen.getByTestId(`ml-copilot-effort-button-${mode}`))
      }

      const promptInput = screen.getByTestId('ml-ephant-conversation-input')

      fireEvent.input(promptInput, { target: { textContent: promptText } })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      expect(handleProcess).toHaveBeenCalledWith(promptText, mode, [])

      act(() => {
        rerender(renderConversation(latestConversation))
      })

      const requestBubble = screen.getByTestId('ml-request-chat-bubble')
      expect(requestBubble).toHaveTextContent(promptText)

      const responseBubble = screen.getByTestId('ml-response-chat-bubble')
      expect(
        within(responseBubble).getByTestId('ml-response-chat-bubble-thinking')
      ).toBeInTheDocument()

      const finalResponse = 'Rounded cube generated successfully.'
      latestConversation = {
        exchanges: [
          {
            request: {
              type: 'user',
              content: promptText,
            },
            responses: [
              {
                end_of_stream: {
                  whole_response: finalResponse,
                },
              },
            ],
            deltasAggregated: finalResponse,
          },
        ],
      }

      act(() => {
        rerender(renderConversation(latestConversation, true))
      })

      expect(
        screen.queryByTestId('ml-response-chat-bubble-thinking')
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('ml-response-chat-bubble')).toHaveTextContent(
        finalResponse
      )
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  }

  test('renders request bubble, shows thinking state, then displays response text after completion', () => {
    rendersRequestBubbleThenDisplayResponse()
  })

  test('renders request bubble, shows thinking state, then displays response text after completion (non-default reasoning effort)', () => {
    rendersRequestBubbleThenDisplayResponse('standard')
  })

  test('shows an attachments loading indicator while attachment processing is in progress', () => {
    render(
      <MlEphantConversation
        isLoading={false}
        isLoadingAttachments={true}
        conversation={{
          exchanges: [
            {
              request: {
                type: 'user',
                content: 'Use these files',
                additional_files: [
                  {
                    name: 'front-view.png',
                    mimetype: 'image/png',
                    data: [],
                  },
                ],
              },
              responses: [],
              deltasAggregated: '',
            },
          ],
        }}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        contexts={[]}
        disabled={false}
        hasPromptCompleted={false}
        isProcessing={true}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    expect(
      screen.getByText('Progressively loading attachments into context...')
    ).toBeInTheDocument()
  })

  test('omits mode while server mode metadata is unavailable', () => {
    const handleProcess = vi.fn()
    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        onProcess={handleProcess}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        initialMlCopilotMode="standard"
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    expect(
      screen.queryByTestId('ml-copilot-efforts-button')
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
      target: { value: 'Generate a cube' },
    })
    fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

    expect(handleProcess).toHaveBeenCalledWith('Generate a cube', undefined, [])
  })

  test('resets a local mode pick when the mode scope changes', () => {
    const handleProcess = vi.fn()
    const renderConversation = (modeScopeKey: string) => (
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        onProcess={handleProcess}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        initialMlCopilotMode="deep"
        modeOptions={SERVER_MODE_OPTIONS}
        modeScopeKey={modeScopeKey}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    const { rerender } = render(renderConversation('project-a'))

    fireEvent.click(screen.getByTestId('ml-copilot-efforts-button'))
    fireEvent.click(screen.getByTestId('ml-copilot-effort-button-standard'))

    expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
      'Standard'
    )

    rerender(renderConversation('project-b'))

    expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
      'Deep'
    )

    fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
      target: { value: 'Generate a cube' },
    })
    fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

    expect(handleProcess).toHaveBeenCalledWith('Generate a cube', 'deep', [])
  })

  test('keeps disabled mode options visible but unelectable with upgrade copy', () => {
    const handleProcess = vi.fn()
    const modeOptions: MlCopilotModeOption[] = [
      { ...SERVER_MODE_OPTIONS[0], disabled: true },
      SERVER_MODE_OPTIONS[1],
    ]

    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        onProcess={handleProcess}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        initialMlCopilotMode="deep"
        modeOptions={modeOptions}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    fireEvent.click(screen.getByTestId('ml-copilot-efforts-button'))

    const disabledMode = screen.getByTestId('ml-copilot-effort-button-standard')
    expect(disabledMode).toBeDisabled()
    expect(disabledMode).toHaveTextContent('Upgrade your plan to use this mode')

    fireEvent.click(disabledMode)

    expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
      'Deep'
    )

    fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
      target: { value: 'Generate a cube' },
    })
    fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

    expect(handleProcess).toHaveBeenCalledWith('Generate a cube', 'deep', [])
  })

  test('falls back to an enabled mode when the initial mode is disabled', async () => {
    const handleProcess = vi.fn()
    const modeOptions: MlCopilotModeOption[] = [
      { ...SERVER_MODE_OPTIONS[0], disabled: true },
      SERVER_MODE_OPTIONS[1],
    ]

    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        onProcess={handleProcess}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        initialMlCopilotMode="standard"
        modeOptions={modeOptions}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('ml-copilot-efforts-button')).toHaveTextContent(
        'Deep'
      )
    })

    fireEvent.change(screen.getByTestId('ml-ephant-conversation-input'), {
      target: { value: 'Generate a cube' },
    })
    fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

    expect(handleProcess).toHaveBeenCalledWith('Generate a cube', 'deep', [])
  })

  test('does not render unknown response types', () => {
    const unknownResponseText = 'this should never be visible'

    const conversation: Conversation = {
      exchanges: [
        {
          request: {
            type: 'user',
            content: 'Render a torus',
          },
          responses: [
            {
              unexpected_response: {
                detail: unknownResponseText,
              },
            } as any, // we must do this because it's a type that doesn't exist.
          ],
          deltasAggregated: '',
        },
      ],
    }

    render(
      <MlEphantConversation
        isLoading={false}
        conversation={conversation}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    const responseBubble = screen.getByTestId('ml-response-chat-bubble')

    expect(
      within(responseBubble).queryByText(unknownResponseText)
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('ml-response-chat-bubble-thinking')
    ).toBeInTheDocument()
  })

  test.each([
    'Manual edits detected since the last Zookeeper state.',
    'Transient model streaming error; retrying.',
  ])(
    'keeps reasoning expanded for non-terminal info notices: %s',
    async (infoText) => {
      const conversation: Conversation = {
        exchanges: [
          {
            request: {
              type: 'user',
              content: 'Render a bracket',
            },
            responses: [
              {
                reasoning: {
                  type: 'text',
                  content: 'Checking the model stream...',
                },
              },
              {
                info: {
                  text: infoText,
                },
              },
            ],
            deltasAggregated: '',
          },
        ],
      }

      render(
        <MlEphantConversation
          isLoading={false}
          conversation={conversation}
          onProcess={vi.fn()}
          onClickClearChat={() => {}}
          onReconnect={() => {}}
          onCancel={() => {}}
          needsReconnect={false}
          disabled={false}
          hasPromptCompleted={false}
          contexts={[]}
          isProcessing={true}
          queue={[]}
          onRemoveFromQueue={() => {}}
          onSteer={() => {}}
        />
      )

      expect(
        screen.getByTestId('ml-response-info-chat-bubble')
      ).toHaveTextContent(infoText)
      expect(
        screen.getByTestId('ml-response-chat-bubble-thinking')
      ).toBeInTheDocument()

      await waitFor(() => {
        expect(
          screen.getByTestId('ml-response-thinking-view')
        ).toBeInTheDocument()
      })
      expect(screen.getByText('Collapse')).toBeInTheDocument()
      expect(screen.queryByText('See reasoning')).not.toBeInTheDocument()
    }
  )

  test('hides the immediate thought when end_of_stream is followed by another response', () => {
    const finalResponse = 'Rendered.'

    const conversation: Conversation = {
      exchanges: [
        {
          request: {
            type: 'user',
            content: 'Render a bracket',
          },
          responses: [
            {
              reasoning: {
                type: 'text',
                content: 'Starting render...',
              },
            },
            {
              end_of_stream: {
                whole_response: finalResponse,
                started_at: '2026-05-18T12:00:00.000Z',
                completed_at: '2026-05-18T12:01:00.000Z',
              },
            },
            {
              reasoning: {
                type: 'text',
                content: 'Checking Constraints...',
              },
            },
          ],
          deltasAggregated: finalResponse,
        },
      ],
    }

    render(
      <MlEphantConversation
        isLoading={false}
        conversation={conversation}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    expect(screen.queryByTestId('thinking-immediate')).not.toBeInTheDocument()
    expect(screen.getByTestId('ml-response-chat-bubble')).toHaveTextContent(
      finalResponse
    )
  })

  test('renders user message additional files as attachments under the prompt', () => {
    const conversation: Conversation = {
      exchanges: [
        {
          request: {
            type: 'user',
            content: 'Use these reference files',
            additional_files: [
              {
                name: 'front-view.png',
                mimetype: 'image/png',
                data: [1, 2, 3],
              },
              {
                name: 'requirements.pdf',
                mimetype: 'application/pdf',
                data: [4, 5, 6],
              },
            ],
          },
          responses: [],
          deltasAggregated: '',
        },
      ],
    }

    render(
      <MlEphantConversation
        isLoading={false}
        conversation={conversation}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    const requestBubble = screen.getByTestId('ml-request-chat-bubble')
    const attachments = screen.getByTestId('ml-request-chat-bubble-attachments')

    expect(
      within(requestBubble).getByText('Use these reference files')
    ).toBeInTheDocument()
    expect(
      within(requestBubble).queryByText('Attachments')
    ).not.toBeInTheDocument()
    expect(within(attachments).getByText('Attachments')).toBeInTheDocument()
    expect(within(attachments).getByText('front-view.png')).toBeInTheDocument()
    expect(
      within(attachments).getByText('requirements.pdf')
    ).toBeInTheDocument()
    expect(within(attachments).queryByText('+ more')).not.toBeInTheDocument()
  })

  test('expands and collapses user message attachments when there are more than two', () => {
    const conversation: Conversation = {
      exchanges: [
        {
          request: {
            type: 'user',
            content: 'Use these reference files',
            additional_files: [
              {
                name: 'front-view.png',
                mimetype: 'image/png',
                data: [1, 2, 3],
              },
              {
                name: 'requirements.pdf',
                mimetype: 'application/pdf',
                data: [4, 5, 6],
              },
              {
                name: 'side-view.jpg',
                mimetype: 'image/jpeg',
                data: [7, 8, 9],
              },
            ],
          },
          responses: [],
          deltasAggregated: '',
        },
      ],
    }

    render(
      <MlEphantConversation
        isLoading={false}
        conversation={conversation}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    const attachments = screen.getByTestId('ml-request-chat-bubble-attachments')

    expect(within(attachments).getByText('front-view.png')).toBeInTheDocument()
    expect(
      within(attachments).getByText('requirements.pdf')
    ).toBeInTheDocument()
    expect(
      within(attachments).queryByText('side-view.jpg')
    ).not.toBeInTheDocument()

    fireEvent.click(within(attachments).getByText('+ more'))

    expect(within(attachments).getByText('side-view.jpg')).toBeInTheDocument()
    expect(within(attachments).getByText('- collapse')).toBeInTheDocument()

    fireEvent.click(within(attachments).getByText('- collapse'))

    expect(
      within(attachments).queryByText('side-view.jpg')
    ).not.toBeInTheDocument()
    expect(within(attachments).getByText('+ more')).toBeInTheDocument()
  })

  test('renders the blocked reason from the API response without extra copy', () => {
    const blockedReason = `You need a payment method to keep using Zookeeper. Go to your [account](${withSiteBaseURL('/account')}) to fix this.`

    render(
      <MlEphantConversation
        isLoading={false}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        blockedReason={blockedReason}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    expect(
      screen.getByText(/You need a payment method to keep using Zookeeper/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'account' })).toHaveAttribute(
      'href',
      withSiteBaseURL('/account')
    )
    expect(screen.queryByText(/The user/i)).not.toBeInTheDocument()
    expect(
      screen.getByTestId('ml-ephant-conversation-input-button')
    ).toBeDisabled()
  })

  test('renders a provided welcome message when the conversation is empty', () => {
    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        welcomeMessage={
          <div data-testid="custom-welcome-message">Welcome content</div>
        }
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    expect(screen.getByTestId('custom-welcome-message')).toBeInTheDocument()
    expect(
      screen.queryByTestId('ml-request-chat-bubble')
    ).not.toBeInTheDocument()
  })

  test('renders a provided welcome message above conversation exchanges', () => {
    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{
          exchanges: [
            {
              request: {
                type: 'user',
                content: 'Render a bracket',
              },
              responses: [
                {
                  end_of_stream: {
                    whole_response: 'Rendered.',
                  },
                },
              ],
              deltasAggregated: 'Rendered.',
            },
          ],
        }}
        welcomeMessage={
          <div data-testid="custom-welcome-message">Welcome content</div>
        }
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
      />
    )

    const welcome = screen.getByTestId('custom-welcome-message')
    const requestBubble = screen.getByTestId('ml-request-chat-bubble')

    expect(
      welcome.compareDocumentPosition(requestBubble) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByTestId('ml-ephant-conversation-welcome-section')
    ).toHaveClass('border-b')
  })

  test('renders the Makeathon announcement in the Zookeeper pane', () => {
    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
        showMakeathonAnnouncement={true}
      />
    )

    const announcement = screen.getByTestId('zookeeper-makeathon-announcement')
    const overlay = screen.getByTestId(
      'zookeeper-makeathon-announcement-overlay'
    )

    expect(announcement).toBeVisible()
    expect(overlay).toBeVisible()
    expect(
      within(announcement).getByRole('link', { name: 'Register now' })
    ).toHaveAttribute('href', withSiteBaseURL('/makeathon'))
  })

  test('does not render the Makeathon announcement when hidden', () => {
    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
        showMakeathonAnnouncement={false}
      />
    )

    expect(
      screen.queryByTestId('zookeeper-makeathon-announcement')
    ).not.toBeInTheDocument()
  })

  test('dismisses the Makeathon announcement and persists the choice', () => {
    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
        showMakeathonAnnouncement={true}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Dismiss Makeathon announcement',
      })
    )

    expect(
      screen.queryByTestId('zookeeper-makeathon-announcement')
    ).not.toBeInTheDocument()
    expect(
      window.localStorage.getItem(MAKEATHON_ANNOUNCEMENT_DISMISSED_STORAGE_KEY)
    ).toBe('true')
  })

  test('does not render the Makeathon announcement after persisted dismissal', () => {
    window.localStorage.setItem(
      MAKEATHON_ANNOUNCEMENT_DISMISSED_STORAGE_KEY,
      'true'
    )

    render(
      <MlEphantConversation
        isLoading={false}
        conversation={{ exchanges: [] }}
        onProcess={vi.fn()}
        onClickClearChat={() => {}}
        onReconnect={() => {}}
        onCancel={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
        isProcessing={false}
        queue={[]}
        onRemoveFromQueue={() => {}}
        onSteer={() => {}}
        showMakeathonAnnouncement={true}
      />
    )

    expect(
      screen.queryByTestId('zookeeper-makeathon-announcement')
    ).not.toBeInTheDocument()
  })

  describe('file attachments', () => {
    const createMockFile = (
      name: string,
      type: string,
      size: number = 1024
    ): File => {
      const content = new Array(size).fill('a').join('')
      return new File([content], name, { type })
    }

    const renderConversation = (handleProcess = vi.fn(), disabled = false) => {
      return render(
        <>
          <MlEphantConversation
            isLoading={false}
            conversation={{ exchanges: [] }}
            onProcess={handleProcess}
            onClickClearChat={() => {}}
            onReconnect={() => {}}
            onCancel={() => {}}
            needsReconnect={false}
            disabled={disabled}
            hasPromptCompleted={true}
            contexts={[]}
            isProcessing={false}
            queue={[]}
            onRemoveFromQueue={() => {}}
            onSteer={() => {}}
          />
          <TestEngineSceneStreamLayers />
        </>
      )
    }

    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(takeViewportScreenshot).mockReturnValue(
        'data:image/png;base64,aGVsbG8='
      )
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    test('displays attachment button', () => {
      renderConversation()
      expect(
        screen.getByTestId('ml-ephant-attachments-button')
      ).toBeInTheDocument()
    })

    test('displays screenshot annotation button', () => {
      renderConversation()
      expect(
        screen.getByTestId('ml-ephant-annotate-screenshot-button')
      ).toBeInTheDocument()
      expect(screen.getByText('Zoodle')).toBeInTheDocument()
    })

    test('adds annotated viewport screenshot as an attachment', async () => {
      const OriginalImage = globalThis.Image
      class MockImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        complete = true
        naturalWidth = 16
        naturalHeight = 16
        width = 16
        height = 16

        set src(_value: string) {
          queueMicrotask(() => this.onload?.())
        }
      }

      const drawImageSpy = vi
        .spyOn(CanvasRenderingContext2D.prototype, 'drawImage')
        .mockImplementation(() => {})
      globalThis.Image = MockImage as typeof Image
      try {
        renderConversation()

        fireEvent.click(
          screen.getByTestId('ml-ephant-annotate-screenshot-button')
        )

        expect(
          screen.getByTestId('viewport-annotation-overlay')
        ).toBeInTheDocument()

        const sendButton = screen.getByTestId('viewport-annotation-send-button')
        await waitFor(() => expect(sendButton).not.toBeDisabled())
        fireEvent.click(sendButton)

        expect(
          await screen.findByText('annotated-viewport-screenshot.png')
        ).toBeInTheDocument()
      } finally {
        drawImageSpy.mockRestore()
        globalThis.Image = OriginalImage
      }
    })

    test('shows attached files when files are added via drag and drop', async () => {
      renderConversation()

      // The drop container is the div that wraps the textarea
      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!

      const pngFile = createMockFile('test-image.png', 'image/png')

      fireEvent.dragEnter(dropContainer, {
        dataTransfer: { types: ['Files'] },
      })
      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [pngFile],
          types: ['Files'],
        },
      })

      expect(await screen.findByText('test-image.png')).toBeInTheDocument()
    })

    test('shows attached files when files are pasted', async () => {
      renderConversation()

      const textarea = screen.getByTestId('ml-ephant-conversation-input')
      const pdfFile = createMockFile('document.pdf', 'application/pdf')

      const pasteEvent = {
        preventDefault: vi.fn(),
        clipboardData: {
          files: [pdfFile],
        },
      }

      fireEvent.paste(textarea, pasteEvent)

      expect(await screen.findByText('document.pdf')).toBeInTheDocument()
    })

    test('allows removing attached files', async () => {
      renderConversation()

      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!

      const pngFile = createMockFile('removable.png', 'image/png')

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [pngFile],
          types: ['Files'],
        },
      })

      expect(await screen.findByText('removable.png')).toBeInTheDocument()

      const removeButton = screen.getByRole('button', {
        name: /Remove removable.png/i,
      })
      fireEvent.click(removeButton)

      expect(screen.queryByText('removable.png')).not.toBeInTheDocument()
    })

    test('sends attachments with prompt on submit', async () => {
      const handleProcess = vi.fn()
      renderConversation(handleProcess)

      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!
      const textarea = screen.getByTestId('ml-ephant-conversation-input')

      const imageFile = createMockFile('attachment.png', 'image/png')

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [imageFile],
          types: ['Files'],
        },
      })

      expect(await screen.findByText('attachment.png')).toBeInTheDocument()

      fireEvent.input(textarea, { target: { textContent: 'Test prompt' } })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      expect(handleProcess).toHaveBeenCalledWith(
        'Test prompt',
        undefined,
        expect.arrayContaining([
          expect.objectContaining({ name: 'attachment.png' }),
        ])
      )
    })

    test('clears attachments after submit', async () => {
      const handleProcess = vi.fn()
      renderConversation(handleProcess)

      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!
      const textarea = screen.getByTestId('ml-ephant-conversation-input')

      const imageFile = createMockFile('will-clear.png', 'image/png')

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [imageFile],
          types: ['Files'],
        },
      })

      expect(await screen.findByText('will-clear.png')).toBeInTheDocument()

      fireEvent.input(textarea, { target: { textContent: 'Test prompt' } })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      expect(screen.queryByText('will-clear.png')).not.toBeInTheDocument()
    })

    test('does not accept files when disabled', () => {
      renderConversation(vi.fn(), true)

      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!

      const pngFile = createMockFile('disabled-test.png', 'image/png')

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [pngFile],
          types: ['Files'],
        },
      })

      expect(screen.queryByText('disabled-test.png')).not.toBeInTheDocument()
    })

    test('does not accept paste when disabled', () => {
      renderConversation(vi.fn(), true)

      const textarea = screen.getByTestId('ml-ephant-conversation-input')
      const pngFile = createMockFile('disabled-paste.png', 'image/png')

      fireEvent.paste(textarea, {
        preventDefault: vi.fn(),
        clipboardData: {
          files: [pngFile],
        },
      })

      expect(screen.queryByText('disabled-paste.png')).not.toBeInTheDocument()
    })

    test('deduplicates files with same name and size', async () => {
      renderConversation()

      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!

      const file1 = createMockFile('duplicate.png', 'image/png', 100)
      const file2 = createMockFile('duplicate.png', 'image/png', 100)

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [file1],
          types: ['Files'],
        },
      })

      expect(await screen.findByText('duplicate.png')).toBeInTheDocument()

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [file2],
          types: ['Files'],
        },
      })

      // Should still only have one instance
      const attachments = screen.getAllByText('duplicate.png')
      expect(attachments).toHaveLength(1)
    })

    test('accepts multiple files at once', async () => {
      renderConversation()

      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!

      const pngFile = createMockFile('image.png', 'image/png')
      const pdfFile = createMockFile('doc.pdf', 'application/pdf')
      const dxfFile = createMockFile('drawing.dxf', 'application/dxf')
      const jsFile = createMockFile('script.js', 'text/javascript')

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [pngFile, pdfFile, dxfFile, jsFile],
          types: ['Files'],
        },
      })

      expect(await screen.findByText('image.png')).toBeInTheDocument()
      expect(screen.getByText('doc.pdf')).toBeInTheDocument()
      expect(screen.getByText('drawing.dxf')).toBeInTheDocument()
      expect(screen.getByText('script.js')).toBeInTheDocument()
    })
  })
})
