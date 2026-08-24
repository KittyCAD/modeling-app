import type { UserResponse } from '@kittycad/lib'
import {
  appendValueSpec,
  defineContract,
  defineService,
  provide,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { SessionExpiredNotice } from '@src/lib/sessionExpired'
import type { authMachine } from '@src/machines/authMachine'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'

/**
 * Registry contribution called when auth detects an expired session.
 * Subsystems can contribute listeners for cleanup, warning, or routing work
 * without importing the auth extension implementation.
 */
export type AuthSessionExpiredListener = (context: {
  auth: AuthRegistryService
  notice: SessionExpiredNotice
}) => void

export type AuthRegistryService = {
  actor: ActorRefFrom<typeof authMachine>
  send: ActorRefFrom<typeof authMachine>['send']
  state: ReadonlySignal<SnapshotFrom<typeof authMachine>>
  token: ReadonlySignal<string>
  user: ReadonlySignal<UserResponse | undefined>
  isLoggedIn: ReadonlySignal<boolean>
  sessionExpiredNotice: ReadonlySignal<SessionExpiredNotice | undefined>
  clearSessionExpiredNotice: () => void
  refreshUser: () => Promise<UserResponse | undefined>
  useAuthState: () => SnapshotFrom<typeof authMachine>
  useToken: () => string
  useUser: () => UserResponse | undefined
}

export const authContract = defineContract({
  authService: defineService<AuthRegistryService>('auth.service'),
  /**
   * Ordered hooks called by the auth extension after a session-expired notice is
   * detected. The default listener moves auth into the session-expired state;
   * other subsystems can contribute listeners for local cleanup or more specific
   * user warnings while keeping detection centralized.
   */
  authSessionExpiredListenersValueSpec:
    appendValueSpec<AuthSessionExpiredListener>(
      'auth.session-expired-listeners'
    ),
})

export const { authService, authSessionExpiredListenersValueSpec } =
  authContract

export function provideAuthSessionExpiredListener(
  key: string,
  listener: AuthSessionExpiredListener
) {
  return provide(authSessionExpiredListenersValueSpec, listener, { key })
}
