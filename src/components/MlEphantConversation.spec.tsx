import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, vi, describe, test } from 'vitest'

import { MlEphantConversation } from '@src/components/MlEphantConversation'
import type { Conversation } from '@src/machines/mlEphantManagerMachine'
import type { MlCopilotMode } from '@kittycad/lib'
import { DEFAULT_ML_COPILOT_MODE } from '@src/lib/constants'

describe('MlEphantConversation', () => {
  function rendersRequestBubbleThenDisplayResponse(
    mode: MlCopilotMode = DEFAULT_ML_COPILOT_MODE
  ) {
    vi.useFakeTimers()

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
            deltasAggregated: '',
          },
        ],
      }
    })

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
          onInterrupt={() => {}}
          needsReconnect={false}
          contexts={[]}
          disabled={false}
          hasPromptCompleted={hasPromptCompleted}
          isInterrupted={false}
        />
      )
    }

    const { rerender } = render(renderConversation(latestConversation))

    try {
      const promptText = 'Generate a cube with rounded edges'

      if (mode !== DEFAULT_ML_COPILOT_MODE) {
        fireEvent.click(screen.getByTestId('ml-copilot-efforts-button'))
        fireEvent.click(screen.getByTestId(`ml-copilot-effort-button-${mode}`))
      }

      const promptInput = screen.getByTestId('ml-ephant-conversation-input')

      fireEvent.input(promptInput, { target: { textContent: promptText } })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      expect(handleProcess).toHaveBeenCalledWith(promptText, mode)

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
    rendersRequestBubbleThenDisplayResponse('thoughtful')
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
        onInterrupt={() => {}}
        needsReconnect={false}
        disabled={false}
        hasPromptCompleted={true}
        isInterrupted={false}
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
