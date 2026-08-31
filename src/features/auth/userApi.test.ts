import { describe, expect, it } from 'vitest'
import { fetchUser } from '@src/features/auth/userApi'

/**
 * `@kittycad/lib` throws on any non-2xx with the status attached, so these fakes
 * exercise the one distinction that matters: a 404 from `/user/org` is the
 * endpoint saying "not a member", and every other failure leaves the question
 * open.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const SELF = {
  id: 'user-1',
  email: 'frank@zoo.dev',
  first_name: 'Frank',
  last_name: 'Noirot',
  image: '',
}

/** Routes by path, so each test says only what it cares about. */
function routed(handlers: {
  self?: () => Response
  org?: () => Response
}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/user/org')) {
      return handlers.org?.() ?? json({}, 404)
    }
    return handlers.self?.() ?? json(SELF)
  }) as unknown as typeof fetch
}

describe('fetching the signed-in user', () => {
  it('reports the org when the account is in one', async () => {
    const original = globalThis.fetch
    globalThis.fetch = routed({
      org: () => json({ id: 'org-1', name: 'Zoo', role: 'admin' }),
    })

    try {
      const user = await fetchUser('tok-1')

      expect(user.org).toEqual({ id: 'org-1', name: 'Zoo', role: 'admin' })
      expect(user.orgError).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  /* A 404 is the endpoint's answer, not a failure. */
  it('reports no org, and no error, on a 404', async () => {
    const original = globalThis.fetch
    globalThis.fetch = routed({ org: () => json({}, 404) })

    try {
      const user = await fetchUser('tok-1')

      expect(user.org).toBeNull()
      expect(user.orgError).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  /*
   * The bug this guards. Every non-404 used to be swallowed into `org: null`,
   * so the account panel told somebody they were not in an org when the request
   * had simply failed — a claim the lookup could not support.
   */
  it('does not claim "no org" when the lookup failed for another reason', async () => {
    const original = globalThis.fetch
    globalThis.fetch = routed({
      org: () => json({ message: 'Forbidden for this token.' }, 403),
    })

    try {
      const user = await fetchUser('tok-1')

      expect(user.org).toBeNull()
      expect(user.orgError).toContain('403')
      expect(user.orgError).toContain('Forbidden for this token.')
    } finally {
      globalThis.fetch = original
    }
  })

  it('treats a 2xx with no id as a surprise rather than an absence', async () => {
    const original = globalThis.fetch
    globalThis.fetch = routed({ org: () => json({ name: 'Zoo' }) })

    try {
      const user = await fetchUser('tok-1')

      expect(user.org).toBeNull()
      expect(user.orgError).not.toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  it('still resolves the profile when the org lookup fails outright', async () => {
    const original = globalThis.fetch
    globalThis.fetch = routed({
      org: () => {
        throw new Error('network down')
      },
    })

    try {
      const user = await fetchUser('tok-1')

      // Sign-in must not hinge on org membership.
      expect(user.email).toBe('frank@zoo.dev')
      expect(user.orgError).toContain('network down')
    } finally {
      globalThis.fetch = original
    }
  })

  it('names the org by domain when it has no name', async () => {
    const original = globalThis.fetch
    globalThis.fetch = routed({
      org: () => json({ id: 'org-1', domain: 'zoo.dev', role: 'member' }),
    })

    try {
      const user = await fetchUser('tok-1')

      expect(user.org?.name).toBe('zoo.dev')
    } finally {
      globalThis.fetch = original
    }
  })
})
