import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, vi, describe, test, beforeEach, afterEach } from 'vitest'

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
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
  useSingletons: () => ({
    kclManager: {
      astSignal: { value: null },
    },
  }),
}))

import { MlEphantConversation } from '@src/components/MlEphantConversation'
import type { Conversation } from '@src/machines/mlEphantManagerMachine'
import type { MlCopilotMode } from '@kittycad/lib'
import { DEFAULT_ML_COPILOT_MODE } from '@src/lib/constants'
import toast from 'react-hot-toast'

describe('MlEphantConversation', () => {
  function rendersRequestBubbleThenDisplayResponse(
    mode: MlCopilotMode = DEFAULT_ML_COPILOT_MODE
  ) {
    vi.useFakeTimers()

    let latestConversation: Conversation | undefined = { exchanges: [] }

    const handleProcess = vi.fn(
      (prompt: string, _mode: MlCopilotMode, _files: File[]) => {
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
        needsReconnect={false}
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
        />
      )
    }

    beforeEach(() => {
      vi.clearAllMocks()
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

    test('shows error toast for unsupported file types on drop', () => {
      renderConversation()

      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!

      const unsupportedFile = createMockFile('script.js', 'text/javascript')

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [unsupportedFile],
          types: ['Files'],
        },
      })

      expect(toast.error).toHaveBeenCalledWith(
        'Only PDF, Markdown, and image files are supported.'
      )
    })

    test('shows error toast for unsupported file types on paste', () => {
      renderConversation()

      const textarea = screen.getByTestId('ml-ephant-conversation-input')
      const unsupportedFile = createMockFile('script.js', 'text/javascript')

      fireEvent.paste(textarea, {
        preventDefault: vi.fn(),
        clipboardData: {
          files: [unsupportedFile],
        },
      })

      expect(toast.error).toHaveBeenCalledWith(
        'Only PDF, Markdown, and image files are supported.'
      )
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
        DEFAULT_ML_COPILOT_MODE,
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

    test('accepts multiple supported file types', async () => {
      renderConversation()

      const dropContainer = screen
        .getByTestId('ml-ephant-conversation-input')
        .closest('div')!

      const pngFile = createMockFile('image.png', 'image/png')
      const pdfFile = createMockFile('doc.pdf', 'application/pdf')
      const mdFile = createMockFile('readme.md', 'text/markdown')

      fireEvent.drop(dropContainer, {
        dataTransfer: {
          files: [pngFile, pdfFile, mdFile],
          types: ['Files'],
        },
      })

      expect(await screen.findByText('image.png')).toBeInTheDocument()
      expect(screen.getByText('doc.pdf')).toBeInTheDocument()
      expect(screen.getByText('readme.md')).toBeInTheDocument()
    })
  })
})
