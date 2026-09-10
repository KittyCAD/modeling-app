import {
  ZookeeperConversationFeedbackDialog,
  ZookeeperConversationMenu,
} from '@src/lib/zookeeper/components/ZookeeperConversationMenu'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchWithSessionExpiration: vi.fn(),
  successToast: vi.fn(),
  onClose: vi.fn(),
  isOrg: true,
}))

vi.mock('@src/lib/boot', () => ({
  useApp: () => ({
    auth: {
      useToken: () => 'test-token',
    },
    billing: {
      useContext: () => ({ isOrg: mocks.isOrg }),
    },
  }),
}))

vi.mock('@src/lib/browserSaveFile', () => ({
  browserSaveFile: vi.fn(),
}))

vi.mock('@src/lib/kcClient', () => ({
  kcCall: async (fn: () => Promise<unknown>) => {
    try {
      return await fn()
    } catch (error) {
      return error instanceof Error ? error : new Error('Unexpected error')
    }
  },
}))

vi.mock('@src/lib/sessionExpired', () => ({
  fetchWithSessionExpiration: mocks.fetchWithSessionExpiration,
}))

vi.mock('@src/lib/withBaseURL', () => ({
  withAPIBaseURL: (path: string) => `https://api.example.com${path}`,
}))

vi.mock('@src/lib/zookeeper/zookeeperManagerMachine', () => ({
  ZookeeperConversationToMarkdown: () => 'redacted conversation trace',
  ZookeeperManagerReactContext: {
    useActorRef: () => ({
      getSnapshot: () => ({
        context: {
          conversationId: '0c2193c7-36d7-4ae0-905a-f4b83809291c',
          conversation: { exchanges: [] },
        },
      }),
    }),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: mocks.successToast,
  },
}))

describe('ZookeeperConversationFeedbackDialog', () => {
  beforeEach(() => {
    mocks.fetchWithSessionExpiration.mockReset()
    mocks.fetchWithSessionExpiration.mockResolvedValue(
      new Response(undefined, { status: 204 })
    )
    mocks.successToast.mockReset()
    mocks.onClose.mockReset()
  })

  test('opens a support ticket with the feedback and conversation trace', async () => {
    render(<ZookeeperConversationFeedbackDialog onClose={mocks.onClose} />)

    fireEvent.change(screen.getByLabelText('Feedback'), {
      target: { value: 'The agent ignored the selected face.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    await waitFor(() =>
      expect(mocks.fetchWithSessionExpiration).toHaveBeenCalledOnce()
    )
    expect(mocks.fetchWithSessionExpiration).toHaveBeenCalledWith(
      'https://api.example.com/org/zookeeper/conversation-feedback',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          conversation_id: '0c2193c7-36d7-4ae0-905a-f4b83809291c',
          feedback: 'The agent ignored the selected face.',
          conversation_trace: 'redacted conversation trace',
        }),
      }
    )
    expect(mocks.successToast).toHaveBeenCalledWith(
      'Feedback sent to Zoo support.'
    )
    expect(mocks.onClose).toHaveBeenCalledOnce()
  })

  test('keeps the dialog open and shows a support error', async () => {
    mocks.fetchWithSessionExpiration.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Support is unavailable.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    render(<ZookeeperConversationFeedbackDialog onClose={mocks.onClose} />)

    fireEvent.change(screen.getByLabelText('Feedback'), {
      target: { value: 'This needs another look.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Support is unavailable.'
    )
    expect(mocks.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled()
  })
})

describe('ZookeeperConversationMenu', () => {
  test('opens conversation feedback for organization users', async () => {
    mocks.isOrg = true

    const { container } = render(<ZookeeperConversationMenu />)
    const menuButton = container.querySelector('button')
    expect(menuButton).not.toBeNull()
    fireEvent.click(menuButton as HTMLButtonElement)

    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Give feedback on conversation' })
    )

    expect(await screen.findByLabelText('Feedback')).toBeVisible()
  })

  test('does not offer conversation feedback to individual users', () => {
    mocks.isOrg = false

    const { container } = render(<ZookeeperConversationMenu />)
    const menuButton = container.querySelector('button')
    expect(menuButton).not.toBeNull()
    fireEvent.click(menuButton as HTMLButtonElement)

    expect(
      screen.queryByRole('menuitem', {
        name: 'Give feedback on conversation',
      })
    ).not.toBeInTheDocument()
  })
})
