import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@src/contracts/auth'
import { createAuthService } from '@src/features/auth/createAuthService'
import type { StoredToken } from '@src/features/auth/tokenStore'

const user: AuthUser = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.dev',
  org: null,
}

/** Settle the constructor's restore pass. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * No development token, unless a test says otherwise.
 *
 * The service used to read `import.meta.env` for one, which meant these tests
 * asserted "nothing is stored" against whatever the machine had exported. This
 * repo's `.envrc` exports a dev token through direnv, so the suite passed in CI
 * and failed on a development machine. Injecting the reader is what makes
 * "nothing stored" mean it.
 */
function create(
  fetchUser = vi.fn(async () => user),
  environmentToken: () => StoredToken | null = () => null
) {
  return {
    auth: createAuthService({ fetchUser, environmentToken }),
    fetchUser,
  }
}

describe('auth service', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts signed out with nothing stored', async () => {
    const { auth, fetchUser } = create()
    await settle()

    expect(auth.status.value).toBe('signedOut')
    expect(auth.token.value).toBeNull()
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('verifies a token by fetching the account, and keeps the profile', async () => {
    const { auth, fetchUser } = create()
    await settle()

    await expect(auth.signIn('good-token')).resolves.toBe(true)
    expect(fetchUser).toHaveBeenCalledWith('good-token')
    expect(auth.status.value).toBe('signedIn')
    expect(auth.user.value?.name).toBe('Ada Lovelace')
  })

  it('restores a stored token on the next session', async () => {
    const first = create()
    await settle()
    await first.auth.signIn('good-token')

    const second = create()
    await settle()
    expect(second.auth.status.value).toBe('signedIn')
    expect(second.auth.token.value).toBe('good-token')
  })

  it('discards a token the API rejects, rather than keeping it', async () => {
    const failing = vi.fn(async () => {
      throw new Error('401 unauthorized')
    })
    const { auth } = create(failing as never)
    await settle()

    await expect(auth.signIn('bad-token')).resolves.toBe(false)
    expect(auth.status.value).toBe('error')
    // A token that does not verify is worse than none: it makes every later
    // request fail confusingly.
    expect(auth.token.value).toBeNull()
    expect(localStorage.getItem('zds.auth.token')).toBeNull()
  })

  it('says plainly that a token was rejected', async () => {
    const failing = vi.fn(async () => {
      throw new Error('Request failed with status code 401')
    })
    const { auth } = create(failing as never)
    await settle()
    await auth.signIn('bad')

    expect(auth.error.value).toMatch(/rejected|expired/i)
  })

  it('distinguishes an unreachable API from a bad token', async () => {
    const failing = vi.fn(async () => {
      throw new Error('Failed to fetch')
    })
    const { auth } = create(failing as never)
    await settle()
    await auth.signIn('token')

    expect(auth.error.value).toMatch(/could not reach/i)
  })

  it('rejects an empty token without calling the API', async () => {
    const { auth, fetchUser } = create()
    await settle()

    await expect(auth.signIn('   ')).resolves.toBe(false)
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('signs out and forgets the stored token', async () => {
    const { auth } = create()
    await settle()
    await auth.signIn('good-token')

    auth.signOut()
    expect(auth.status.value).toBe('signedOut')
    expect(auth.user.value).toBeNull()
    expect(localStorage.getItem('zds.auth.token')).toBeNull()
  })

  it('cannot be signed back in by a verification already in flight', async () => {
    let release: ((value: AuthUser) => void) | undefined
    const slow = vi.fn(
      () => new Promise<AuthUser>((resolve) => (release = resolve))
    )
    const { auth } = create(slow as never)
    await settle()

    const signingIn = auth.signIn('good-token')
    auth.signOut()
    release?.(user)

    // Signing out during a sign-in must win, or a user who cancels ends up
    // signed in anyway.
    await expect(signingIn).resolves.toBe(false)
    expect(auth.status.value).toBe('signedOut')
  })

  it('ignores a superseded verification', async () => {
    const results: ((value: AuthUser) => void)[] = []
    const slow = vi.fn(
      () => new Promise<AuthUser>((resolve) => results.push(resolve))
    )
    const { auth } = create(slow as never)
    await settle()

    const first = auth.signIn('first-token')
    const second = auth.signIn('second-token')

    // Resolve them out of order: the older attempt must not win.
    results[0]?.(user)
    results[1]?.({ ...user, name: 'Second' })

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
    expect(auth.user.value?.name).toBe('Second')
  })

  describe('sign-in requests', () => {
    it('does not ask for credentials merely because nobody is signed in', async () => {
      const { auth } = create()
      await settle()

      // Local projects, editing, and diagnostics all work without an account.
      expect(auth.status.value).toBe('signedOut')
      expect(auth.signInRequested.value).toBe(false)
    })

    it('asks when something needs an account, and carries the reason', async () => {
      const { auth } = create()
      await settle()

      auth.requestSignIn('The engine needs an account.')
      expect(auth.signInRequested.value).toBe(true)
      expect(auth.signInReason.value).toBe('The engine needs an account.')
    })

    it('does not ask when already signed in', async () => {
      const { auth } = create()
      await settle()
      await auth.signIn('good-token')

      auth.requestSignIn('why')
      expect(auth.signInRequested.value).toBe(false)
    })

    it('stops asking once signed in', async () => {
      const { auth } = create()
      await settle()

      auth.requestSignIn()
      await auth.signIn('good-token')
      expect(auth.signInRequested.value).toBe(false)
    })

    it('clears a stale failure when dismissed', async () => {
      const failing = vi.fn(async () => {
        throw new Error('401')
      })
      const { auth } = create(failing as never)
      await settle()

      auth.requestSignIn()
      await auth.signIn('bad')
      expect(auth.status.value).toBe('error')

      auth.dismissSignIn()
      // Returning to the screen later should not show an error about an attempt
      // the user has moved on from.
      expect(auth.status.value).toBe('signedOut')
      expect(auth.error.value).toBeNull()
    })
  })
})

/*
 * The development token had no test of its own — the only thing exercising it
 * was the suite accidentally picking up the machine's, which asserted the
 * opposite of what it does.
 */
describe('a development token from the environment', () => {
  const fromEnvironment = (): StoredToken => ({
    token: 'dev-token',
    source: 'VITE_KC_DEV_TOKEN',
  })

  it('signs in with it when nothing is stored', async () => {
    const { auth, fetchUser } = create(undefined, fromEnvironment)
    await settle()

    expect(auth.status.value).toBe('signedIn')
    expect(auth.token.value).toBe('dev-token')
    expect(fetchUser).toHaveBeenCalledWith('dev-token')
  })

  it('names where it came from, so a surprise session is explicable', async () => {
    const { auth } = create(undefined, fromEnvironment)
    await settle()

    expect(auth.source.value).toBe('VITE_KC_DEV_TOKEN')
  })

  /* A real sign-in outranks a convenience. */
  it('does not override a stored token', async () => {
    const first = create()
    await settle()
    await first.auth.signIn('good-token')

    const second = create(undefined, fromEnvironment)
    await settle()

    expect(second.auth.token.value).toBe('good-token')
  })

  /*
   * Signing out of an environment token has to stick, or the button does
   * nothing: the variable is still set, and the next read would restore it.
   */
  it('stays signed out after signing out', async () => {
    const { auth } = create(undefined, fromEnvironment)
    await settle()
    expect(auth.status.value).toBe('signedIn')

    auth.signOut()

    expect(auth.status.value).toBe('signedOut')
    expect(auth.token.value).toBeNull()
  })
})
