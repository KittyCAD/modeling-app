import { computed, signal } from '@preact/signals'
import type { AuthService, AuthStatus, AuthUser } from '@src/contracts/auth'
import {
  clearStoredToken,
  readEnvironmentToken,
  readStoredToken,
  writeStoredToken,
} from '@src/features/auth/tokenStore'

export interface AuthDependencies {
  /** Injected so tests do not need the network. */
  fetchUser: (token: string) => Promise<AuthUser>
}

/**
 * Who is signed in.
 *
 * Two states that are easy to conflate and are kept apart here:
 *
 * `status` is a fact — is there a verified token. `signInRequested` is an
 * intent — has something asked the user to sign in. Being signed out is not by
 * itself a reason to demand credentials: local projects, editing, and KCL
 * diagnostics all work without an account, so only the parts that need the
 * network ask. That separation is what keeps "is the app gated?" a single
 * predicate instead of a routing concern.
 */
export function createAuthService(
  dependencies: AuthDependencies
): AuthService & { dispose: () => void } {
  const status = signal<AuthStatus>('checking')
  const token = signal<string | null>(null)
  const source = signal<string | null>(null)
  const user = signal<AuthUser | null>(null)
  const error = signal<string | null>(null)
  const signInRequested = signal(false)
  const signInReason = signal<string | null>(null)

  /** Guards against an older verification landing after a newer one. */
  let verification = 0

  async function verify(
    candidate: string,
    candidateSource: string,
    options: { persist: boolean }
  ): Promise<boolean> {
    verification += 1
    const attempt = verification

    status.value = 'checking'
    error.value = null

    try {
      const profile = await dependencies.fetchUser(candidate)
      // A newer sign-in or sign-out happened while this was in flight.
      if (attempt !== verification) return false

      token.value = candidate
      source.value = candidateSource
      user.value = profile
      status.value = 'signedIn'
      signInRequested.value = false
      signInReason.value = null

      if (options.persist) {
        writeStoredToken({ token: candidate, source: candidateSource })
      }
      return true
    } catch (caught) {
      if (attempt !== verification) return false

      token.value = null
      user.value = null
      source.value = null
      status.value = 'error'
      error.value = messageFor(caught)
      // A token that does not verify is worse than no token: it makes every
      // later request fail in a confusing way.
      clearStoredToken()
      return false
    }
  }

  /**
   * Resolve whatever token is already available.
   *
   * Stored first, then the environment. Environment tokens are a development
   * convenience, so they must not override a real sign-in — and must not come
   * back the moment someone signs out.
   */
  async function restore() {
    const existing = readStoredToken() ?? readEnvironmentToken()
    if (!existing) {
      status.value = 'signedOut'
      return
    }

    await verify(existing.token, existing.source, {
      // An environment token is already persistent by definition.
      persist: existing.source === 'stored',
    })
  }

  void restore()

  return {
    status: computed(() => status.value),
    token: computed(() => token.value),
    user: computed(() => user.value),
    error: computed(() => error.value),
    source: computed(() => source.value),
    signInRequested: computed(() => signInRequested.value),
    signInReason: computed(() => signInReason.value),

    requestSignIn(reason) {
      // Already signed in: whatever asked has what it needs.
      if (status.peek() === 'signedIn') return
      signInReason.value = reason ?? null
      signInRequested.value = true
    },

    dismissSignIn() {
      signInRequested.value = false
      signInReason.value = null
      // Dismissing clears a stale failure, so returning to the screen does not
      // show an error about an attempt the user has moved on from.
      if (status.peek() === 'error') {
        status.value = 'signedOut'
        error.value = null
      }
    },

    signIn(candidate, candidateSource = 'manual') {
      const trimmed = candidate.trim()
      if (!trimmed) {
        error.value = 'Enter a token to sign in.'
        status.value = 'signedOut'
        return Promise.resolve(false)
      }
      return verify(trimmed, candidateSource, { persist: true })
    },

    signOut() {
      // Bumped so an in-flight verification cannot sign the user back in.
      verification += 1
      clearStoredToken()
      token.value = null
      user.value = null
      source.value = null
      error.value = null
      status.value = 'signedOut'
    },

    async refresh() {
      const current = token.peek()
      if (!current) {
        await restore()
        return
      }
      await verify(current, source.peek() ?? 'stored', { persist: false })
    },

    dispose() {
      verification += 1
    },
  }
}

/**
 * A message worth showing.
 *
 * The SDK's own errors are often opaque, and a 401 in particular deserves saying
 * plainly rather than as a status code.
 */
function messageFor(caught: unknown): string {
  const raw =
    caught instanceof Error
      ? caught.message
      : typeof caught === 'string'
        ? caught
        : 'Could not verify the token.'

  if (/401|unauthor|forbidden|invalid/i.test(raw)) {
    return 'That token was rejected. It may be expired or from another environment.'
  }
  if (/fetch|network|failed to/i.test(raw)) {
    return 'Could not reach the Zoo API. Check your connection and try again.'
  }
  return raw
}
