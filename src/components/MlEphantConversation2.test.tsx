import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'

import { MlEphantConversation2 } from '@src/components/MlEphantConversation2'
import type { BillingContext } from '@src/machines/billingMachine'
import type { Conversation } from '@src/machines/mlEphantManagerMachine2'

describe('MlEphantConversation2', () => {
  test('renders request bubble, shows thinking state, then displays response text after completion', () => {
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
          disabled={false}
          hasPromptCompleted={hasPromptCompleted}
        />
      )
    }

    const { rerender } = render(renderConversation(latestConversation))

    try {
      const promptText = 'Generate a cube with rounded edges'

      const promptInput = screen.getByTestId('ml-ephant-conversation-input')

      fireEvent.input(promptInput, { target: { textContent: promptText } })
      fireEvent.click(screen.getByTestId('ml-ephant-conversation-input-button'))

      expect(handleProcess).toHaveBeenCalledWith(promptText)

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
  })
})
