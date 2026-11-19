import { createOrganizationSharingCommand } from '@src/lib/cloudProjects/organizationSharing'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import { expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn() } }))

const project: HomeProjectEntry = {
  id: 'cloud:existing-project',
  name: 'Bracket',
  title: 'Bracket',
  source: 'remote',
  status: 'cloud-only',
  remoteProjectId: 'existing-project',
  readWriteAccess: true,
  canShareWithOrganization: true,
}

it('reviews the ownership transfer and shares the existing project ID', async () => {
  const shareProject = vi.fn(async () => {})
  const command = createOrganizationSharingCommand({
    enabled: () => true,
    organization: () => ({ name: 'Design team' }),
    projects: () => [
      project,
      { ...project, id: 'other', canShareWithOrganization: false },
    ],
    shareProject,
  })
  expect(command.disabled).toBe(false)
  expect(command.needsReview).toBe(true)
  const argument = command.args?.project
  if (
    argument?.inputType !== 'options' ||
    typeof argument.options !== 'function'
  )
    throw new Error('Expected project options')
  expect(argument.options({ argumentsToSubmit: {} })).toEqual([
    { name: 'Bracket', value: project.id, isCurrent: false },
  ])
  await command.onSubmit({ project: project.id })
  expect(shareProject).toHaveBeenCalledExactlyOnceWith('existing-project')
})

it.each(['offline', 'no organization', 'no permission'])(
  'rejects sharing when there is %s',
  async (reason) => {
    const shareProject = vi.fn(async () => {})
    const command = createOrganizationSharingCommand({
      enabled: () => reason !== 'offline',
      organization: () =>
        reason === 'no organization' ? undefined : { name: 'Design team' },
      projects: () => [
        { ...project, canShareWithOrganization: reason !== 'no permission' },
      ],
      shareProject,
    })
    expect(command.disabled).toBe(true)
    await expect(command.onSubmit({ project: project.id })).rejects.toThrow(
      'cannot be shared'
    )
    expect(shareProject).not.toHaveBeenCalled()
  }
)
