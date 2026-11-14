import { inputs, observeService, observe } from '@src/registry/inputs'
import type { UserResponse } from '@kittycad/lib'
import type { ReadonlySignal } from '@preact/signals-core'
import type { SessionExpiredNotice } from '@src/lib/sessionExpired'
import type { authMachine } from '@src/machines/authMachine'
import { contract, contribute, Facet, service } from 'plankton'
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
  useAuthState: () => SnapshotFrom<typeof authMachine>
  useToken: () => string
  useUser: () => UserResponse | undefined
}
export const authContract = contract({
  authService: service<AuthRegistryService>('auth.service'),
  /**
   * Ordered hooks called by the auth extension after a session-expired notice is
   * detected. The default listener moves auth into the session-expired state;
   * other subsystems can contribute listeners for local cleanup or more specific
   * user warnings while keeping detection centralized.
   */
  authSessionExpiredListenersFacet: new Facet<
    AuthSessionExpiredListener,
    readonly AuthSessionExpiredListener[]
  >('auth.session-expired-listeners', (inputs) => inputs),
})
export const { authService, authSessionExpiredListenersFacet } = authContract
export function provideAuthSessionExpiredListener(
  key: string,
  listener: AuthSessionExpiredListener
) {
  return contribute(authSessionExpiredListenersFacet, () => listener, { key })
}

export const observations = inputs({
  authService: observeService(authService),
  authSessionExpiredListenersFacet: observe(authSessionExpiredListenersFacet),
})
