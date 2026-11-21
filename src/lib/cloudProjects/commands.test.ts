import { createCloudProjectCommands } from '@src/lib/cloudProjects/commands'
import { expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn() } }))

it.each(['member', 'admin'] as const)(
  'offers organization libraries only to admins (%s)',
  async (role) => {
    const createLibrary = vi.fn(async () => {})
    const [command] = createCloudProjectCommands({
      enabled: () => true,
      organization: () => ({ role, name: 'Design team' }),
      createLibrary,
    })
    const scope = command.args?.scope
    if (scope?.inputType !== 'options' || typeof scope.options !== 'function')
      throw new Error('Expected library owner options')
    expect(
      scope.options({ argumentsToSubmit: {} }).map((option) => option.value)
    ).toEqual(role === 'admin' ? ['personal', 'organization'] : ['personal'])
    if (role === 'member') {
      await expect(
        command.onSubmit({ name: 'Designs', scope: 'organization' })
      ).rejects.toThrow('Only organization admins')
      expect(createLibrary).not.toHaveBeenCalled()
    } else {
      await command.onSubmit({ name: '  Designs  ', scope: 'organization' })
      expect(createLibrary).toHaveBeenCalledWith('Designs', 'organization')
    }
  }
)

it('creates personal libraries without an organization and rejects blank names', async () => {
  const createLibrary = vi.fn(async () => {})
  const [command] = createCloudProjectCommands({
    enabled: () => true,
    organization: () => undefined,
    createLibrary,
  })
  await expect(command.onSubmit({ name: '   ' })).rejects.toThrow(
    'valid library name'
  )
  expect(createLibrary).not.toHaveBeenCalled()
  await command.onSubmit({ name: 'Personal designs' })
  expect(createLibrary).toHaveBeenCalledWith('Personal designs', 'personal')
})
