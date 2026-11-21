import {
  createPublicationWorkflow,
  type PublicationTarget,
} from '@src/lib/publishing/workflow'
import { expect, it, vi } from 'vitest'

const submission = {
  title: 'Bracket',
  description: 'A bracket',
  categoryIds: ['hardware'],
}

it('does not publish when preparing the target fails', async () => {
  const failure = new Error('Saving failed')
  const workflow = createPublicationWorkflow({
    loadDetails: async () => null,
    prepare: async () => failure,
  })
  expect(await workflow.submit(submission)).toBe(failure)
})

it('does not refresh details when publishing fails', async () => {
  const loadDetails = vi.fn(async () => null)
  const workflow = createPublicationWorkflow({
    loadDetails,
    prepare: async () => ({ publish: async () => false, loadDetails }),
  })
  expect(await workflow.submit(submission)).toBe(false)
  expect(loadDetails).not.toHaveBeenCalled()
})

it('retains successful publication when refreshing details fails', async () => {
  const failure = new Error('Metadata unavailable')
  const workflow = createPublicationWorkflow({
    loadDetails: async () => null,
    prepare: async () => ({
      publish: async () => ({ remoteProjectId: 'bracket' }),
      loadDetails: async () => {
        throw failure
      },
    }),
  })
  expect(await workflow.submit(submission)).toEqual({
    published: { remoteProjectId: 'bracket' },
    details: failure,
  })
})

it('refreshes the prepared project after another project becomes current', async () => {
  const pending = Promise.withResolvers<{ remoteProjectId: string }>()
  const original: PublicationTarget = {
    publish: () => pending.promise,
    loadDetails: vi.fn(async () => null),
  }
  const other: PublicationTarget = {
    publish: vi.fn(async (): Promise<false> => false),
    loadDetails: vi.fn(async () => null),
  }
  let current = original
  const workflow = createPublicationWorkflow({
    loadDetails: async () => null,
    prepare: async () => current,
  })
  const result = workflow.submit(submission)
  current = other
  pending.resolve({ remoteProjectId: 'original' })
  expect(await result).toEqual({
    published: { remoteProjectId: 'original' },
    details: null,
  })
  expect(original.loadDetails).toHaveBeenCalledWith('original')
  expect(other.publish).not.toHaveBeenCalled()
  expect(other.loadDetails).not.toHaveBeenCalled()
})
