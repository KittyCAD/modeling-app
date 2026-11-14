import {
  clearSessionExpiredNotice,
  notifySessionExpired,
} from '@src/lib/sessionExpired'
import {
  authService,
  provideAuthSessionExpiredListener,
} from '@src/registry/contracts/auth'
import authRegistryItem, {
  createAuthExtension,
} from '@src/registry/extensions/auth'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import {
  type FileOperationsRegistryService,
  fileOperationsService,
} from '@src/registry/contracts/fileOperations'
import { factory, provide, Registry } from 'plankton'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('auth extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
    clearSessionExpiredNotice()
  })

  it('provides auth state, token, and login readiness through the registry', async () => {
    registry = new Registry()
    await registry.configure([authRegistryItem])
    const auth = registry.required(authService)
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
    await registry.configure([
      [
        provideAuthSessionExpiredListener(
          'test-session-expired-listener',
          listener
        ),
      ],
      authRegistryItem,
    ])
    registry.required(authService)
    expect(listener).not.toHaveBeenCalled()

    notifySessionExpired('fetch')

    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('makes the acquired auth export available during construction with its injected file operations', async () => {
    registry = new Registry()
    let captured: Promise<FileOperationsRegistryService> | undefined
    const auth = createAuthExtension(
      factory({
        create: () => ({ exports: { operations: testFileOperations } }),
      })
    )
    const consumer = factory({
      dependencies: { auth },
      create: ({ auth }) => {
        captured = auth.actor.getSnapshot().context.fileOperations
        return {}
      },
    })
    await registry.configure([
      consumer,
      provide(fileOperationsService, { ...testFileOperations }),
    ])
    await expect(captured).resolves.toBe(testFileOperations)
  })
})
