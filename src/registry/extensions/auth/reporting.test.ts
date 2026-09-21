import { type UserResponse, users } from '@kittycad/lib'
import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { clearSessionExpiredNotice } from '@src/lib/sessionExpired'
import type * as AuthMachineModule from '@src/machines/authMachine'
import { authService } from '@src/registry/contracts/auth'
import {
  fileOperationsService,
  type FileOperationsRegistryService,
} from '@src/registry/contracts/fileOperations'
import authRegistryItem from '@src/registry/extensions/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  getUser:
    vi.fn<
      () => Promise<
        | { token: string; user: undefined }
        | { token: string; user: UserResponse }
      >
    >(),
}))

// Keep the real auth machine transitions and registry wiring, but control when
// reading the saved credentials and validating /user completes.
vi.mock('@src/machines/authMachine', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthMachineModule>()
  const { fromPromise } = await import('xstate')
  return {
    ...actual,
    authMachine: actual.authMachine.provide({
      actors: {
        getUser: fromPromise(
          async ({
            input,
          }: {
            input: {
              fileOperations: Promise<FileOperationsRegistryService>
              token?: string
            }
          }) => {
            await input.fileOperations
            return mockState.getUser()
          }
        ),
      },
    }),
  }
})

const API_URL = 'https://api.zoo.example'
let registry: Registry | undefined
let restoreToken: () => void

beforeEach(() => {
  vi.stubEnv('VITE_ZOO_API_BASE_URL', API_URL)
  mockState.getUser.mockClear()
  mockState.getUser.mockImplementation(
    () =>
      new Promise((resolve) => {
        restoreToken = () =>
          resolve({ token: 'restored-token', user: undefined })
      })
  )
})

afterEach(() => {
  registry?.[Symbol.dispose]()
  registry = undefined
  clearSessionExpiredNotice()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function startAuth() {
  registry = new Registry()
  registry.configure([
    defineRegistryItem({
      id: 'test-file-operations',
      providesServices: [
        provideService(
          fileOperationsService,
          {} as FileOperationsRegistryService
        ),
      ],
    }),
    authRegistryItem,
  ])
  const auth = registry.get(authService)
  await vi.waitFor(() => expect(mockState.getUser).toHaveBeenCalledOnce())
  return auth
}

describe('startup error reporting and authentication', () => {
  it('defers a startup filesystem report until the restored session is ready', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    // Reports can be captured before the auth service itself exists.
    await reportClientError({ message: 'early startup report' })
    const auth = await startAuth()
    expect(auth.state.value.matches('checkIfLoggedIn')).toBe(true)

    await reportClientError({
      code: ClientErrorCode.FileOperationsError,
      errorName: 'FileNotFound',
      message: 'FileOperations operation failed during read-file.',
    })
    expect(fetchMock).not.toHaveBeenCalled()

    restoreToken()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(auth.isLoggedIn.value).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API_URL}/user/client-errors`)
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer restored-token'
    )
  })

  it('does not expire restored auth for a delayed pre-auth 401, but does for a current-session 401', async () => {
    let respond!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        () =>
          new Promise((resolve) => {
            respond = resolve
          })
      )
    )
    const auth = await startAuth()
    const staleRequest = kcCall(() =>
      users.report_user_client_error({
        client: createKCClient(),
        body: {
          client: 'zoo-modeling-app',
          release: 'test',
          message: 'pre-auth report',
        },
      })
    )

    restoreToken()
    await vi.waitFor(() => expect(auth.isLoggedIn.value).toBe(true))
    respond(new Response('{}', { status: 401 }))
    await staleRequest
    expect(auth.isLoggedIn.value).toBe(true)
    expect(auth.token.value).toBe('restored-token')

    const currentRequest = kcCall(() =>
      users.get_user_self({ client: createKCClient('restored-token') })
    )
    respond(new Response('{}', { status: 401 }))
    await currentRequest
    expect(auth.state.value.matches('sessionExpired')).toBe(true)
    expect(auth.token.value).toBe('')
  })
})
