import { Popover } from '@headlessui/react'
import type { MarkdownEditorActions } from '@kittycad/ui-components'
import { PublishDialog } from '@src/components/PublishDialog'
import type { CurrentProjectPublicationDetails } from '@src/lib/share'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const category = {
  id: 'robotics',
  display_name: 'Robotics',
  description: 'Robotics projects',
  sort_order: 1,
}

function makePublicationDetails(
  publicationStatus: CurrentProjectPublicationDetails['publicationStatus']
): CurrentProjectPublicationDetails {
  return {
    projectId: 'project-existing',
    publicationStatus,
    title: 'Bracket',
    description: 'A mounting bracket.',
    categoryIds: ['robotics'],
    updatedAt: '2026-04-09T15:00:00Z',
  }
}

describe('PublishDialog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([category]),
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows Aquarium review feedback and republishing guidance', () => {
    render(
      <Popover>
        <PublishDialog
          onSubmit={vi.fn()}
          accountUrl="https://zoo.dev/account"
          projectStatus={{
            publicationStatus: 'changes_requested',
            feedback: 'Add another view.',
          }}
        />
      </Popover>
    )

    const aquariumStatus = screen.getByTestId('publish-dialog-aquarium-status')
    expect(aquariumStatus).toHaveTextContent('Aquarium status')
    expect(aquariumStatus).toHaveTextContent('Changes requested')
    expect(aquariumStatus).toHaveTextContent('Reviewer feedback')
    expect(aquariumStatus).toHaveTextContent('Add another view.')
    expect(aquariumStatus).toHaveTextContent(
      'Republishing will put the project back into the review queue.'
    )
  })

  it.each(['private', 'draft'] as const)(
    'treats a %s cloud project as never submitted',
    (publicationStatus) => {
      render(
        <Popover>
          <PublishDialog
            onSubmit={vi.fn()}
            accountUrl="https://zoo.dev/account"
            publicationDetails={makePublicationDetails(publicationStatus)}
          />
        </Popover>
      )

      expect(
        screen.queryByText(/This project was last submitted for review/)
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Aquarium terms & conditions' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Submit for review' })
      ).toBeInTheDocument()
    }
  )

  it('shows the prior submission details for a submitted project', () => {
    render(
      <Popover>
        <PublishDialog
          onSubmit={vi.fn()}
          accountUrl="https://zoo.dev/account"
          publicationDetails={makePublicationDetails('pending_review')}
        />
      </Popover>
    )

    expect(
      screen.getByText(/This project was last submitted for review/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Update submission' })
    ).toBeInTheDocument()
  })

  it('registers the description editor with the Markdown keymap while focused', async () => {
    const unregisterActions = vi.fn()
    const registerActions = vi.fn((actions: MarkdownEditorActions) => {
      void actions
      return unregisterActions
    })
    const focusScope = {
      onFocus: vi.fn(),
      onBlur: vi.fn(),
    }

    render(
      <Popover>
        <PublishDialog
          onSubmit={vi.fn()}
          accountUrl="https://zoo.dev/account"
          markdownEditorKeymap={{ focusScope, registerActions }}
        />
      </Popover>
    )

    const editor = await screen.findByTestId(
      'publish-project-description-editor'
    )
    fireEvent.focus(editor)

    await waitFor(() => {
      expect(focusScope.onFocus).toHaveBeenCalledTimes(1)
      expect(registerActions).toHaveBeenCalledTimes(1)
    })
    expect(registerActions.mock.calls[0][0]).toMatchObject({
      setLink: expect.any(Function),
    })

    fireEvent.blur(editor)

    await waitFor(() => {
      expect(unregisterActions).toHaveBeenCalledTimes(1)
      expect(focusScope.onBlur).toHaveBeenCalledTimes(1)
    })
  })
})
