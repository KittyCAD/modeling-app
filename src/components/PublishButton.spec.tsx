import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  useProjectStatus: vi.fn(),
}))

vi.mock('@src/hooks/useProjectStatus', () => ({
  useProjectStatus: mockState.useProjectStatus,
}))

import { PublishButton } from '@src/components/PublishButton'
import type { App } from '@src/lib/app'

function createApp() {
  return {
    projectSignal: {
      value: {
        projectIORefSignal: {
          value: {
            cloudProjectId: 'remote-123',
          },
        },
      },
    },
    auth: {
      useAuthState: () => ({ matches: () => false }),
      useToken: () => 'token-123',
      useUser: () => ({ username: 'zoonaut' }),
    },
    singletons: {
      kclManager: {
        astSignal: { value: { body: [] } },
        isAstBodyEmpty: () => false,
        hasErrors: () => false,
        wasmInstancePromise: Promise.resolve({}),
        path: '/projects/example/main.kcl',
        code: '',
      },
    },
    registry: {
      optional: () => undefined,
    },
  } as unknown as App
}

describe('PublishButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.useProjectStatus.mockReturnValue(null)
  })

  test('shows the Aquarium status in the Publish button', () => {
    mockState.useProjectStatus.mockReturnValue({
      publicationStatus: 'published',
    })

    render(<PublishButton app={createApp()} />)

    const publishButton = screen.getByTestId('publish-button')
    expect(
      within(publishButton).getByTestId('publish-aquarium-status-badge')
    ).toHaveTextContent('Published')
    expect(publishButton).toHaveAccessibleName(
      'Publish Aquarium status: Published'
    )
    expect(mockState.useProjectStatus).toHaveBeenCalledWith(
      'remote-123',
      'token-123'
    )
  })

  test('keeps review feedback out of the compact button status', () => {
    mockState.useProjectStatus.mockReturnValue({
      publicationStatus: 'changes_requested',
      feedback: 'Add another view.',
    })

    render(<PublishButton app={createApp()} />)

    expect(
      screen.getByTestId('publish-aquarium-status-badge')
    ).toHaveTextContent('Changes requested')
    expect(screen.getByTestId('publish-button')).toHaveAccessibleName(
      'Publish Aquarium status: Changes requested'
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('hides non-publication Aquarium statuses in Publish', () => {
    mockState.useProjectStatus.mockReturnValue({ publicationStatus: 'draft' })

    render(<PublishButton app={createApp()} />)

    expect(
      screen.queryByTestId('publish-aquarium-status-badge')
    ).not.toBeInTheDocument()
  })
})
