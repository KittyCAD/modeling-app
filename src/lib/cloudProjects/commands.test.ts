import { createCloudProjectCommands } from '@src/lib/cloudProjects/commands'
import { createRemoteProjectLibrary } from '@src/lib/cloudProjects/runtime/api'
import toast from 'react-hot-toast'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn() } }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('offers organization ownership to members and lets the API authorize creation', async () => {
  const createLibrary = vi.fn(async () => {})
  const [command] = createCloudProjectCommands({
    enabled: () => true,
    organization: () => ({ name: 'Design team' }),
    createLibrary,
  })
  const scope = command.args?.scope
  if (scope?.inputType !== 'options' || typeof scope.options !== 'function')
    throw new Error('Expected library owner options')
  expect(
    scope.options({ argumentsToSubmit: {} }).map((option) => option.value)
  ).toEqual(['personal', 'organization'])
  await command.onSubmit({ name: '  Designs  ', scope: 'organization' })
  expect(createLibrary).toHaveBeenCalledWith('Designs', 'organization')
})

it.each([
  'Only organization admins can create organization libraries.',
  'An active organization is required to create an organization library.',
])(
  'returns the API denial for the Command Bar to display: %s',
  async (message) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ error_code: 'Forbidden', message }, { status: 403 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const [command] = createCloudProjectCommands({
      enabled: () => true,
      organization: () => ({ name: 'Design team' }),
      createLibrary: (name, scope) =>
        createRemoteProjectLibrary(
          { enabled: true, baseUrl: 'https://api.test' },
          name,
          scope
        ),
    })
    const result = await command.onSubmit({
      name: 'Designs',
      scope: 'organization',
    })
    expect(result).toBeInstanceOf(Error)
    expect(result).toMatchObject({ status: 403, message })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(toast.success).not.toHaveBeenCalled()
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
