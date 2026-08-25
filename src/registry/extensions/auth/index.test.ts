import { Registry, defineRegistryItem } from '@kittycad/registry'
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
})
