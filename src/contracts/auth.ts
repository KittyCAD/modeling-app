import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

export type AuthStatus = 'unauthenticated' | 'authenticated'

export interface AuthService {
  readonly status: ReadonlySignal<AuthStatus>
  /**
   * The bearer token for API and engine calls, or null.
   *
   * Deliberately the only thing exposed. Nothing in the app should be reading a
   * token out of the environment or storage on its own, because then there is no
   * single place to change when a real sign-in flow arrives.
   */
  readonly token: ReadonlySignal<string | null>
  /** Where the token came from, for the status bar and for support. */
  readonly source: ReadonlySignal<string | null>
}

export const authContract = defineContract({
  authService: defineService<AuthService>('auth.service'),
})

export const { authService } = authContract
