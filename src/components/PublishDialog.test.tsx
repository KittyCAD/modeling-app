import { Popover } from '@headlessui/react'
import type { MarkdownEditorActions } from '@kittycad/ui-components'
import { PublishDialog } from '@src/components/PublishDialog'
import type { CurrentProjectPublicationDetails } from '@src/lib/share'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const category = {
  id: 'robotics',
  slug: 'robotics',
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

  it('discloses when publishing will move the project to Personal Cloud', () => {
    render(
      <Popover>
        <PublishDialog
          onSubmit={vi.fn()}
          accountUrl="https://zoo.dev/account"
          willMoveProjectToCloud={true}
        />
      </Popover>
    )

    const cloudMoveWarning = screen.getByText(
      /Publishing will also move this project from its current folder to your Personal Cloud library/
    )
    expect(cloudMoveWarning).toBeInTheDocument()
    expect(cloudMoveWarning).toHaveClass(
      'w-full',
      'border-destroy-40',
      'text-destroy-80'
    )
    expect(
      screen.getByText(/This will also be used as the project title/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Projects API/)).not.toBeInTheDocument()
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

  it('shows every active category and hides inactive categories', async () => {
    const categories = Array.from({ length: 18 }, (_, index) => ({
      ...category,
      id: `category-${index}`,
      slug: `category-${index}`,
      display_name: `Category ${index}`,
      sort_order: index,
      is_active: true,
    }))
    categories.push({
      ...category,
      id: 'inactive-makeathon',
      slug: 'makeathon',
      display_name: 'Inactive Makeathon',
      sort_order: 19,
      is_active: false,
    })
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(categories),
    } as unknown as Response)

    render(
      <Popover>
        <PublishDialog
          onSubmit={vi.fn()}
          accountUrl="https://zoo.dev/account"
        />
      </Popover>
    )

    expect(await screen.findByText('Category 17')).toBeVisible()
    expect(screen.getAllByRole('checkbox')).toHaveLength(18)
    expect(screen.queryByText('Inactive Makeathon')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(expect.any(String), {
      cache: 'no-cache',
      signal: expect.any(AbortSignal),
    })
  })

  it('keeps Makeathon available only when it is already assigned', async () => {
    render(
      <Popover>
        <PublishDialog
          onSubmit={vi.fn()}
          accountUrl="https://zoo.dev/account"
          publicationDetails={{
            projectId: 'project-id',
            publicationStatus: 'published',
            title: 'Makeathon project',
            description: 'An existing entry.',
            categoryIds: ['3bd6fb75-c6f6-413e-83f6-e93b6076ae0c'],
            updatedAt: '2026-04-30T00:00:00Z',
          }}
        />
      </Popover>
    )

    expect(await screen.findByText('Makeathon')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /Makeathon/ })).toBeChecked()
  })

  it('allows an existing Makeathon category to be removed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(
      <Popover>
        <PublishDialog
          onSubmit={onSubmit}
          accountUrl="https://zoo.dev/account"
          publicationDetails={{
            projectId: 'project-id',
            publicationStatus: 'published',
            title: 'Makeathon project',
            description: 'An existing entry.',
            categoryIds: ['3bd6fb75-c6f6-413e-83f6-e93b6076ae0c', category.id],
            updatedAt: '2026-04-30T00:00:00Z',
          }}
        />
      </Popover>
    )

    await screen.findByText('Robotics')
    fireEvent.click(screen.getByRole('checkbox', { name: /Makeathon/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Update submission' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Makeathon project',
        description: 'An existing entry.',
        categoryIds: [category.id],
      })
    })
  })

  it('does not resubmit inactive categories from an existing project', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    render(
      <Popover>
        <PublishDialog
          onSubmit={onSubmit}
          accountUrl="https://zoo.dev/account"
          publicationDetails={{
            projectId: 'project-id',
            publicationStatus: 'published',
            title: 'Existing project',
            description: 'Existing description.',
            categoryIds: ['retired-category', category.id],
            updatedAt: '2026-04-30T00:00:00Z',
          }}
        />
      </Popover>
    )

    await screen.findByText('Robotics')
    fireEvent.click(screen.getByRole('button', { name: 'Update submission' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Existing project',
        description: 'Existing description.',
        categoryIds: [category.id],
      })
    })
  })
})
