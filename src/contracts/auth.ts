import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'

export type AuthStatus =
  /** Resolving a stored token on startup. */
  | 'checking'
  | 'signedOut'
  | 'signedIn'
  /** A token existed but could not be verified. */
  | 'error'

/**
 * The org an account belongs to.
 *
 * Separate from the user rather than flattened onto it, because an org is a
 * billing and permissions subject in its own right: credits are drawn from its
 * pool, not the member's.
 */
export interface AuthOrg {
  id: string
  name: string
  /** The member's role in it, verbatim from the API. */
  role: string
}

/** The parts of the account this app actually shows. */
export interface AuthUser {
  id: string
  name: string
  email: string
  imageUrl?: string
  /**
   * The org this account belongs to, or null.
   *
   * Null does not mean "not a member" on its own — read `orgError` too.
   */
  org: AuthOrg | null
  /**
   * Why the org is unknown, when it is.
   *
   * Null in both the cases that are answers: there is an org, or the endpoint
   * said 404, which for `/user/org` means "not a member". Non-null only when the
   * request failed for some other reason, and then the org is genuinely
   * undetermined.
   *
   * The distinction exists because collapsing it was a real bug: the lookup
   * caught every error and returned null, so the account panel told somebody
   * they were not in an org while their admin dashboard said they were. "I could
   * not tell" and "you are not a member" are different sentences and only one of
   * them was ever true.
   */
  orgError: string | null
}

export interface AuthService {
  readonly status: ReadonlySignal<AuthStatus>
  readonly token: ReadonlySignal<string | null>
  readonly user: ReadonlySignal<AuthUser | null>
  readonly error: ReadonlySignal<string | null>
  /** Where the current token came from, for debugging a rejected request. */
  readonly source: ReadonlySignal<string | null>

  /**
   * Whether the sign-in screen should be showing.
   *
   * Separate from `status` because being signed out is not by itself a reason to
   * demand a sign-in: local projects, editing, and KCL diagnostics all work
   * without an account. Only the parts that need the network ask for one.
   */
  readonly signInRequested: ReadonlySignal<boolean>
  requestSignIn(reason?: string): void
  dismissSignIn(): void
  /** Why sign-in was asked for, shown on the screen. */
  readonly signInReason: ReadonlySignal<string | null>

  /** Adopt a token and verify it. Resolves true when it was accepted. */
  signIn(token: string, source?: string): Promise<boolean>
  signOut(): void
  /** Re-verify the current token. */
  refresh(): Promise<void>
}

/**
 * One way to sign in.
 *
 * Contributed rather than hard-coded, because the available methods differ by
 * platform — a device flow needs a desktop shell, a redirect needs a browser —
 * and the sign-in screen should not be the place that knows which.
 */
export interface SignInFlow {
  id: string
  /** Lower sorts earlier; the first available flow is the primary one. */
  order?: number
  title: string
  description: string
  /** False on platforms where this flow cannot work. */
  available: ReadonlySignal<boolean>
  render: (props: { onSignedIn: () => void }) => ComponentChildren
}

export const authContract = defineContract({
  authService: defineService<AuthService>('auth.service'),
  signInFlowsValueSpec: appendValueSpec<SignInFlow>('auth.signInFlows'),
})

export const { authService, signInFlowsValueSpec } = authContract
