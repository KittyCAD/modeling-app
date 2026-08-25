import type { UserResponse } from '@kittycad/lib'
import { Registry, defineRegistryItem } from '@kittycad/registry'
import type * as DesktopModule from '@src/lib/desktop'
import {
  clearSessionExpiredNotice,
  notifySessionExpired,
} from '@src/lib/sessionExpired'
import {
  authService,
  provideAuthSessionExpiredListener,
} from '@src/registry/contracts/auth'
import authRegistryItem from '@src/registry/extensions/auth'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/desktop', async (importOriginal) => {
  const original = await importOriginal<typeof DesktopModule>()
  return {
    ...original,
    readEnvironmentFile: vi.fn().mockResolvedValue(''),
    readEnvironmentConfigurationKittycadWebSocketUrl: vi
      .fn()
      .mockResolvedValue(''),
    readEnvironmentConfigurationZookeeperWebSocketUrl: vi
      .fn()
      .mockResolvedValue(''),
  }
})

describe('auth extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    clearSessionExpiredNotice()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('provides auth state, token, and login readiness through the registry', async () => {
    registry = new Registry()
    registry.configure([authRegistryItem])

    const auth = registry.get(authService)

    await vi.waitFor(() => {
      expect(auth.state.value.matches('checkIfLoggedIn')).toBe(false)
    })

    expect(auth.token.value).toBe(auth.actor.getSnapshot().context.token)
    expect(auth.isLoggedIn.value).toBe(false)
    expect(auth.user.value).toBeUndefined()

    const send = vi.spyOn(auth.actor, 'send')
    auth.send({ type: 'Log out' })

    expect(send).toHaveBeenCalledWith({ type: 'Log out' })
  })

  it('ignores stale session-expired notices emitted before the extension starts', async () => {
    const listener = vi.fn()
    notifySessionExpired('fetch')

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-session-expired-listener',
        provides: [
          provideAuthSessionExpiredListener(
            'test-session-expired-listener',
            listener
          ),
        ],
      }),
      authRegistryItem,
    ])
    registry.get(authService)

    expect(listener).not.toHaveBeenCalled()

    notifySessionExpired('fetch')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not let a stale refresh overwrite a newer login session', async () => {
    vi.stubEnv('VITE_ZOO_API_BASE_URL', 'https://api.zoo.dev')
    const userFor = (id: string): UserResponse => ({
      id,
      name: id,
      email: `${id}@example.com`,
      image: '',
      created_at: '2026-08-25T00:00:00.000Z',
      updated_at: '2026-08-25T00:00:00.000Z',
      can_train_on_data: false,
      is_onboarded: true,
      is_service_account: false,
      deletion_scheduled: false,
    })
    const originalUser = userFor('original-user')
    const staleUser = userFor('stale-user')
    const currentUser = userFor('current-user')
    let resolveRefresh: (response: Response) => void = () => {}
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    registry = new Registry()
    registry.configure([authRegistryItem])
    const auth = registry.get(authService)

    await vi.waitFor(() => {
      expect(auth.state.value.matches('loggedOut')).toBe(true)
    })

    let userRequestCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(input.toString())
        if (url.pathname !== '/user') {
          throw new Error(`Unexpected request to ${url.pathname}`)
        }

        userRequestCount += 1
        if (userRequestCount === 1) {
          return Promise.resolve(Response.json(originalUser))
        }
        if (userRequestCount === 2) {
          return refreshResponse
        }
        return Promise.resolve(Response.json(currentUser))
      })
    )
    auth.send({ type: 'Log in', token: 'original-token' })
    await vi.waitFor(() => {
      expect(userRequestCount).toBe(1)
    })
    await vi.waitFor(() => {
      expect(auth.state.value.value).toBe('loggedIn')
    })
    expect(auth.user.value).toEqual(originalUser)

    const refreshing = auth.refreshUser()
    await vi.waitFor(() => {
      expect(userRequestCount).toBe(2)
    })

    auth.send({ type: 'Session expired' })
    auth.send({ type: 'Log in', token: 'current-token' })
    await vi.waitFor(() => {
      expect(userRequestCount).toBe(3)
      expect(auth.state.value.matches('loggedIn')).toBe(true)
    })
    expect(auth.token.value).toBe('current-token')
    expect(auth.user.value).toEqual(currentUser)

    resolveRefresh(Response.json(staleUser))

    await expect(refreshing).resolves.toBeUndefined()
    expect(auth.token.value).toBe('current-token')
    expect(auth.user.value).toEqual(currentUser)
  })
})
