import { Registry, defineRegistryItem } from '@kittycad/registry'
import {
  clearSessionExpiredNotice,
  notifySessionExpired,
} from '@src/lib/sessionExpired'
import {
  authService,
  provideAuthSessionExpiredListener,
} from '@src/registry/contracts/auth'
import authRegistryItem, {
  zooConnectedIdentityFromUser,
} from '@src/registry/extensions/auth'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('auth extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    clearSessionExpiredNotice()
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

  it('projects Zoo users into connected identities', () => {
    expect(
      zooConnectedIdentityFromUser({
        id: '8675309',
        name: 'Test User',
        email: 'kittycad.sidebar.test@example.com',
        image: '',
        is_onboarded: false,
        created_at: 'yesteryear',
        updated_at: 'today',
        company: 'Test Company',
        discord: 'Test User#1234',
        github: 'testuser',
        phone: '555-555-5555',
        first_name: 'Test',
        last_name: 'User',
        can_train_on_data: false,
        is_service_account: false,
        deletion_scheduled: false,
      })
    ).toEqual({
      id: 'zoo:8675309',
      provider: 'zoo',
      label: 'Test User',
      handle: 'kittycad.sidebar.test@example.com',
      capabilities: ['zoo:auth', 'projects:read', 'projects:write'],
      status: 'connected',
    })
  })
})
