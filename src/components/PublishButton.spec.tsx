import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  useProjectStatus: vi.fn(),
}))

vi.mock('@src/hooks/useProjectStatus', () => ({
  useProjectStatus: mockState.useProjectStatus,
}))

import { PublishButton } from '@src/components/PublishButton'
import type { App } from '@src/lib/app'
import { projectSession } from '@src/registry/contracts/projectSession'

function createApp() {
  const projectSessionValue = {
    project: {
      value: {
        projectIORefSignal: {
          value: {
            cloudProjectId: 'remote-123',
          },
        },
      },
    },
  }

  return {
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
      get: (service: unknown) =>
        service === projectSession ? projectSessionValue : undefined,
      optional: () => undefined,
    },
  } as unknown as App
}

describe('PublishButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.useProjectStatus.mockReturnValue(null)
  })

  test.each([
    ['pending_review', 'Pending Review', 'eyeOpen'],
    ['published', 'Published', 'checkmark'],
    ['rejected', 'Rejected', 'close'],
  ] as const)(
    'replaces Publish with the neutral %s status',
    (publicationStatus, label, icon) => {
      mockState.useProjectStatus.mockReturnValue({ publicationStatus })

      render(<PublishButton app={createApp()} />)

      const publishButton = screen.getByTestId('publish-button')
      expect(publishButton).toHaveAccessibleName(label)
      expect(screen.getByTestId('publish-button-icon')).toHaveAttribute(
        'data-icon',
        icon
      )
      expect(publishButton).not.toHaveClass('bg-warn-10/60')
      expect(mockState.useProjectStatus).toHaveBeenCalledWith(
        'remote-123',
        'token-123'
      )
    }
  )

  test('highlights changes requested without putting feedback in the button', () => {
    mockState.useProjectStatus.mockReturnValue({
      publicationStatus: 'changes_requested',
      feedback: 'Add another view.',
    })

    render(<PublishButton app={createApp()} />)

    const publishButton = screen.getByTestId('publish-button')
    expect(publishButton).toHaveAccessibleName('Changes requested')
    expect(publishButton).toHaveClass('bg-warn-10/60')
    expect(publishButton).toHaveClass('border-warn-80')
    expect(screen.getByTestId('publish-button-icon')).toHaveAttribute(
      'data-icon',
      'triangleExclamation'
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('uses the default Publish action for non-publication statuses', () => {
    mockState.useProjectStatus.mockReturnValue({ publicationStatus: 'draft' })

    render(<PublishButton app={createApp()} />)

    const publishButton = screen.getByTestId('publish-button')
    expect(publishButton).toHaveAccessibleName('Publish')
    expect(screen.getByTestId('publish-button-icon')).toHaveAttribute(
      'data-icon',
      'share'
    )
  })
})
