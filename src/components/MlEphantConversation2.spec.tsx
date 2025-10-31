import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'

import { MlEphantConversation2 } from '@src/components/MlEphantConversation2'
import type { BillingContext } from '@src/machines/billingMachine'
import type { Conversation } from '@src/machines/mlEphantManagerMachine2'
import type {
  MlCopilotSupportedModels,
  MlReasoningEffort,
} from '@kittycad/lib/dist/types/src'
import {
  DEFAULT_ML_COPILOT_MODEL,
  DEFAULT_ML_COPILOT_REASONING_EFFORT,
} from '@src/lib/constants'

describe('MlEphantConversation2', () => {
  function rendersRequestBubbleShowsThinkingStateThenDisplaysResponseTextAfterCompletion(
    model: MlCopilotSupportedModels = DEFAULT_ML_COPILOT_MODEL,
    reasoningEffort: MlReasoningEffort = DEFAULT_ML_COPILOT_REASONING_EFFORT
  ) {
    vi.useFakeTimers()

    const billingContext: BillingContext = {
      credits: 10,
      allowance: 100,
      error: undefined,
      urlUserService: () => '',
      lastFetch: undefined,
    }

    let latestConversation: Conversation | undefined = { exchanges: [] }

    const handleProcess = vi.fn((prompt: string) => {
      latestConversation = {
        exchanges: [
          {
            request: {
              type: 'user',
              content: prompt,
            },
            responses: [],
          },
        ],
      }
    })

    const renderConversation = (
      conversation?: Conversation,
      hasPromptCompleted = false
    ) => {
      return (
        <MlEphantConversation2
          isLoading={false}
          conversation={conversation}
          billingContext={billingContext}
          onProcess={handleProcess}
          contexts={[]}
          disabled={false}
          hasPromptCompleted={hasPromptCompleted}
        />
      )
    }

    const { rerender } = render(renderConversation(latestConversation))

    try {
      const promptText = 'Generate a cube with rounded edges'

      if (model !== DEFAULT_ML_COPILOT_MODEL) {
        fireEvent.click(screen.getByTestId('ml-copilot-models-button'))
        fireEvent.click(screen.getByTestId(`ml-copilot-model-button-${model}`))
      }

      if (reasoningEffort !== DEFAULT_ML_COPILOT_REASONING_EFFORT) {
        fireEvent.click(screen.getByTestId('ml-copilot-efforts-button'))
        fireEvent.click(
          screen.getByTestId(`ml-copilot-effort-button-${reasoningEffort}`)
        )
      }

      const promptInput = screen.getByTestId('ml-ephant-conversation-input')

      fireEvent.input(promptInput, { target: { textContent: promptText } })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      expect(handleProcess).toHaveBeenCalledWith(
        promptText,
        model,
        reasoningEffort,
        expect.any(Set)
      )

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
                delta: {
                  delta: finalResponse,
                },
              },
              {
                end_of_stream: {
                  whole_response: finalResponse,
                },
              },
            ],
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
    rendersRequestBubbleShowsThinkingStateThenDisplaysResponseTextAfterCompletion()
  })

  test('renders request bubble, shows thinking state, then displays response text after completion (non-default reasoning effort)', () => {
    rendersRequestBubbleShowsThinkingStateThenDisplaysResponseTextAfterCompletion(
      'o3'
    )
  })

  test('renders request bubble, shows thinking state, then displays response text after completion (non-default reasoning effort)', () => {
    rendersRequestBubbleShowsThinkingStateThenDisplaysResponseTextAfterCompletion(
      DEFAULT_ML_COPILOT_MODEL,
      'high'
    )
  })

  test('does not render unknown response types', () => {
    const billingContext: BillingContext = {
      credits: 10,
      allowance: 100,
      error: undefined,
      urlUserService: () => '',
      lastFetch: undefined,
    }

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
        },
      ],
    }

    render(
      <MlEphantConversation2
        isLoading={false}
        conversation={conversation}
        billingContext={billingContext}
        onProcess={vi.fn()}
        disabled={false}
        hasPromptCompleted={true}
        contexts={[]}
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
})
