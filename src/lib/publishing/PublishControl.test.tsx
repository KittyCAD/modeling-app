import type { ComponentProps } from 'react'
import {
  PublishControl,
  type PublishControlProps,
} from '@src/lib/publishing/PublishControl'
import type { PublishDialog } from '@src/components/PublishDialog'
import type { CurrentProjectPublicationDetails } from '@src/lib/publishing/publication'
import type {
  PublicationResult,
  PublicationWorkflow,
} from '@src/lib/publishing/workflow'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@src/components/PublishDialog', () => ({
  PublishDialog: (props: ComponentProps<typeof PublishDialog>) => (
    <section role="dialog">
      <span>{props.publicationDetails?.title ?? 'No publication details'}</span>
      <span>
        {props.isLoadingPublicationDetails ? 'Loading details' : 'Ready'}
      </span>
      <button
        onClick={() => {
          void props.onSubmit({
            title: 'Bracket',
            description: '',
            categoryIds: ['hardware'],
          })
        }}
      >
        Submit
      </button>
    </section>
  ),
}))
afterEach(cleanup)
const details: CurrentProjectPublicationDetails = {
  projectId: 'bracket',
  publicationStatus: 'pending_review',
  title: 'Submitted bracket',
  description: '',
  categoryIds: ['hardware'],
  updatedAt: '2026-11-21T00:00:00Z',
}
function props(workflow: PublicationWorkflow): PublishControlProps {
  return {
    workflow,
    disabled: false,
    isCheckingUser: false,
    publishRequiresUsername: false,
    willCloneProjectToCloud: false,
    accountUrl: '/account',
    projectStatus: null,
  }
}

it('publishes through its injected workflow and keeps fresh submission details', async () => {
  const initial =
    Promise.withResolvers<CurrentProjectPublicationDetails | null>()
  const submit = vi.fn(async () => ({
    published: { remoteProjectId: 'bracket' },
    details,
  }))
  render(
    <PublishControl
      {...props({ loadDetails: () => initial.promise, submit })}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  expect(
    await screen.findByRole('button', { name: 'Pending Review' })
  ).toBeInTheDocument()
  await act(async () => {
    initial.resolve({
      ...details,
      title: 'Old title',
      publicationStatus: 'draft',
    })
  })
  expect(screen.getByText('Submitted bracket')).toBeInTheDocument()
  expect(screen.queryByText('Old title')).not.toBeInTheDocument()
  expect(submit).toHaveBeenCalledWith({
    title: 'Bracket',
    description: '',
    categoryIds: ['hardware'],
  })
})

it('ignores submission results after switching publication sources', async () => {
  const pending = Promise.withResolvers<PublicationResult>()
  const first = props({
    loadDetails: async () => null,
    submit: () => pending.promise,
  })
  const second = props({
    loadDetails: async () => ({
      ...details,
      title: 'Second project',
      publicationStatus: 'draft',
    }),
    submit: async () => false,
  })
  const view = render(<PublishControl {...first} />)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  view.rerender(<PublishControl {...second} />)
  expect(await screen.findByText('Second project')).toBeInTheDocument()
  await act(async () => {
    pending.resolve({ published: { remoteProjectId: 'bracket' }, details })
  })
  expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  expect(screen.getByText('Second project')).toBeInTheDocument()
  expect(screen.queryByText('Submitted bracket')).not.toBeInTheDocument()
})

it('updates the source status when its dialog closes during publication', async () => {
  const pending = Promise.withResolvers<PublicationResult>()
  render(
    <PublishControl
      {...props({
        loadDetails: async () => null,
        submit: () => pending.promise,
      })}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => {
    pending.resolve({ published: { remoteProjectId: 'bracket' }, details })
  })
  expect(
    screen.getByRole('button', { name: 'Pending Review' })
  ).toBeInTheDocument()
})
