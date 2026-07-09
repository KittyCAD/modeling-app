import { Popover } from '@headlessui/react'
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

  it('submits normalized Markdown descriptions', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    const publicationDetails = {
      projectId: 'project-1',
      publicationStatus: 'draft',
      title: 'Robot arm',
      description:
        'A [safe](zoo.dev/docs) link and an [unsafe](javascript:alert(1)) link.',
      categoryIds: ['robotics'],
      updatedAt: '2026-07-07T00:00:00.000Z',
    } satisfies CurrentProjectPublicationDetails

    render(
      <Popover>
        <PublishDialog
          onSubmit={onSubmit}
          accountUrl="https://zoo.dev/account"
          publicationDetails={publicationDetails}
        />
      </Popover>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Title*')).toHaveValue('Robot arm')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'Robot arm',
        description: 'A [safe](https://zoo.dev/docs) link and an unsafe link.',
        categoryIds: ['robotics'],
      })
    })
  })
})
