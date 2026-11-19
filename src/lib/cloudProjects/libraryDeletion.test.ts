import {
  createCloudLibraryDeleteCommand,
  type RemoteProjectLibrary,
} from '@src/lib/cloudProjects/libraryDeletion'
import type { RemoteProjectSummary } from '@src/lib/cloudProjects/runtime/types'
import { expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn() } }))

const library: RemoteProjectLibrary = {
  id: 'library',
  name: 'Designs',
  source: 'zds',
  can_manage: true,
  revision: 'library-revision',
}

it('offers only empty manageable libraries and reviews deletion using the library revision', async () => {
  const deleteLibrary = vi.fn(async () => {})
  const command = createCloudLibraryDeleteCommand({
    enabled: () => true,
    libraries: () => [library, { ...library, id: 'full' }],
    projects: () => [{ id: 'project', library_id: 'full' }],
    deleteLibrary,
  })
  expect(command.disabled).toBe(false)
  expect(command.needsReview).toBe(true)
  const argument = command.args?.library
  if (
    argument?.inputType !== 'options' ||
    typeof argument.options !== 'function'
  )
    throw new Error('Expected library options')
  expect(argument.options({ argumentsToSubmit: {} })).toEqual([
    { name: 'Designs', value: 'library', isCurrent: false },
  ])
  await command.onSubmit({ library: 'library' })
  expect(deleteLibrary).toHaveBeenCalledExactlyOnceWith(
    'library',
    'library-revision'
  )
})

it.each([
  { reason: 'no permission', library: { ...library, can_manage: false } },
  { reason: 'missing revision', library: { ...library, revision: undefined } },
  { reason: 'dataset-managed', library: { ...library, source: 'org_dataset' } },
  {
    reason: 'hidden factory library',
    library: { ...library, source: 'factory_portal' },
  },
] as const)('does not delete a library with $reason', async ({ library }) => {
  const deleteLibrary = vi.fn(async () => {})
  const command = createCloudLibraryDeleteCommand({
    enabled: () => true,
    libraries: () => [library],
    projects: () => [],
    deleteLibrary,
  })
  expect(command.disabled).toBe(true)
  await expect(command.onSubmit({ library: library.id })).rejects.toThrow(
    'Only empty cloud libraries'
  )
  expect(deleteLibrary).not.toHaveBeenCalled()
})

it('rechecks project membership and readiness when the reviewed command is submitted', async () => {
  const deleteLibrary = vi.fn(async () => {})
  let projects: RemoteProjectSummary[] = []
  let enabled = true
  const command = createCloudLibraryDeleteCommand({
    enabled: () => enabled,
    libraries: () => [library],
    projects: () => projects,
    deleteLibrary,
  })
  projects = [{ id: 'new-project', library_id: library.id }]
  await expect(command.onSubmit({ library: library.id })).rejects.toThrow(
    'Only empty cloud libraries'
  )
  projects = []
  enabled = false
  await expect(command.onSubmit({ library: library.id })).rejects.toThrow(
    'Only empty cloud libraries'
  )
  expect(deleteLibrary).not.toHaveBeenCalled()
})
