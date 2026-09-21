import { users } from '@kittycad/lib'
import { signal } from '@preact/signals-core'
import { updateEnvironment } from '@src/env'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import {
  clearSessionExpiredNotice,
  fetchWithSessionExpiration,
  initializeAuthSessionTracking,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ desktop: true }))
vi.mock('@src/lib/isDesktop', () => ({ isDesktop: () => runtime.desktop }))

const API_URL = 'https://api.zoo.example'
type AuthState = AuthRegistryService['state']['value']
function authSnapshot(loggedIn: boolean, token = 'restored-token'): AuthState {
  return {
    matches: (value: string) =>
      value === (loggedIn ? 'loggedIn' : 'checkIfLoggedIn'),
    context: { token },
  } as AuthState
}

describe.each(['SDK', 'fetch'] as const)(
  '%s session expiration',
  (transport) => {
    const authState = signal(authSnapshot(false, ''))
    let stopTracking: () => void
    let respond: (response: Response) => void
    let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

    function request(token?: string, baseUrl = API_URL) {
      if (transport === 'SDK') {
        return kcCall(() =>
          users.get_user_self({ client: createKCClient(token, baseUrl) })
        )
      }
      return fetchWithSessionExpiration(`${baseUrl}/user`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: 'include',
      })
    }

    beforeEach(() => {
      runtime.desktop = true
      vi.stubEnv('VITE_ZOO_API_BASE_URL', API_URL)
      authState.value = authSnapshot(false, '')
      stopTracking = initializeAuthSessionTracking(authState)
      fetchMock = vi.fn<typeof fetch>(
        () =>
          new Promise((resolve) => {
            respond = resolve
          })
      )
      vi.stubGlobal('fetch', fetchMock)
      clearSessionExpiredNotice()
    })

    afterEach(() => {
      stopTracking()
      clearSessionExpiredNotice()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      updateEnvironment(null)
    })

    function unauthorized() {
      respond(
        new Response(
          JSON.stringify({ message: 'credentials missing or invalid' }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
    }

    it('ignores a pre-auth 401 arriving after token restoration', async () => {
      const pending = request()
      expect(
        new Headers(fetchMock.mock.calls[0][1]?.headers).has('Authorization')
      ).toBe(false)
      authState.value = authSnapshot(true)
      unauthorized()
      await pending
      expect(sessionExpiredNotice.value).toBeUndefined()
    })

    it('ignores a pre-auth 401 arriving before login completes', async () => {
      const pending = request()
      unauthorized()
      await pending
      authState.value = authSnapshot(true)
      expect(sessionExpiredNotice.value).toBeUndefined()
    })

    it('still expires the current session when its authenticated request gets a 401', async () => {
      authState.value = authSnapshot(true)
      const pending = request('restored-token')
      unauthorized()
      await pending
      expect(sessionExpiredNotice.value?.source).toBe('fetch')
    })

    it('ignores a previous login response even when the token is reused', async () => {
      authState.value = authSnapshot(true)
      const pending = request('restored-token')
      authState.value = authSnapshot(false)
      authState.value = authSnapshot(true)
      unauthorized()
      await pending
      expect(sessionExpiredNotice.value).toBeUndefined()
    })

    it('ignores requests using another token or API environment', async () => {
      authState.value = authSnapshot(true)
      const wrongToken = request('old-token')
      unauthorized()
      await wrongToken
      const wrongEnvironment = request(
        'restored-token',
        'https://api.other.example'
      )
      unauthorized()
      await wrongEnvironment
      expect(sessionExpiredNotice.value).toBeUndefined()
    })

    it('invalidates pending responses across environment changes, including a switch back', async () => {
      authState.value = authSnapshot(true)
      const pending = request('restored-token')
      vi.stubEnv('VITE_ZOO_API_BASE_URL', 'https://api.other.example')
      updateEnvironment('other.example')
      vi.stubEnv('VITE_ZOO_API_BASE_URL', API_URL)
      updateEnvironment('zoo.example')
      unauthorized()
      await pending
      expect(sessionExpiredNotice.value).toBeUndefined()
    })

    it('supports browser cookie authentication without a bearer token', async () => {
      runtime.desktop = false
      authState.value = authSnapshot(true, '')
      const pending = request()
      expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include')
      unauthorized()
      await pending
      expect(sessionExpiredNotice.value?.source).toBe('fetch')
    })

    it('ignores an unauthenticated desktop request even while logged in', async () => {
      authState.value = authSnapshot(true)
      const pending = request()
      unauthorized()
      await pending
      expect(sessionExpiredNotice.value).toBeUndefined()
    })

    it('ignores successful responses from the current session', async () => {
      authState.value = authSnapshot(true)
      const pending = request('restored-token')
      respond(new Response('{}', { status: 200 }))
      await pending
      expect(sessionExpiredNotice.value).toBeUndefined()
    })
  }
)
