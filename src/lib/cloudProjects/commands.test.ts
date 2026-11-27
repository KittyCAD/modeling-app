import { createCloudLibraryCommand } from '@src/lib/cloudProjects/commands'
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
  const command = createCloudLibraryCommand({
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
  expect(scope.valueSummary?.('organization')).toBe('Design team')
  await command.onSubmit({ name: '  Designs  ', scope: 'organization' })
  expect(createLibrary).toHaveBeenCalledWith('Designs', 'organization')
})

it.each([
  {
    status: 403,
    error_code: 'Forbidden',
    message: 'Only organization admins can create organization libraries.',
  },
  {
    status: 409,
    error_code: 'Conflict',
    message: 'A library with this name already exists for this owner.',
  },
])(
  'returns the API error for the Command Bar to display ($status)',
  async ({ status, error_code, message }) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ error_code, message }, { status })
    )
    vi.stubGlobal('fetch', fetchMock)
    const command = createCloudLibraryCommand({
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
    expect(result).toMatchObject({ status, message })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(toast.success).not.toHaveBeenCalled()
  }
)

it('creates personal libraries without an organization and rejects blank names', async () => {
  const createLibrary = vi.fn(async () => {})
  const command = createCloudLibraryCommand({
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
