import { describe, expect, it, vi } from 'vitest'
import {
  CreditsApiError,
  createCreditsApi,
} from '@src/features/credits/creditsApi'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const api = (fetchImpl: typeof fetch, token: string | null = 'tok-1') =>
  createCreditsApi({
    token: () => token,
    baseUrl: 'https://api.test',
    fetch: fetchImpl,
  })

describe('the credits API', () => {
  it('reads both pools and the refresh date', async () => {
    const request = vi.fn(async () =>
      ok({
        monthly_api_credits_remaining: 420,
        stable_api_credits_remaining: 80,
        monthly_api_credits_refresh_at: '2026-09-01T00:00:00Z',
      })
    )

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.monthlyRemaining).toBe(420)
    expect(balance.stableRemaining).toBe(80)
    expect(balance.refreshAt).toBe(Date.parse('2026-09-01T00:00:00Z'))
  })

  it('sends the token as a bearer, read at call time', async () => {
    let current = 'first'
    const sent: Array<string | undefined> = []
    const request = async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      sent.push(headers.get('Authorization') ?? undefined)
      return ok({})
    }
    const client = createCreditsApi({
      token: () => current,
      baseUrl: 'https://api.test',
      fetch: request as unknown as typeof fetch,
    })

    await client.balance()
    current = 'second'
    await client.balance()

    expect(sent[0]).toBe('Bearer first')
    // The whole reason the token is a function: a captured one goes stale.
    expect(sent[1]).toBe('Bearer second')
  })

  /* A missing field is zero rather than a throw: an account with no carried-over
   * credits legitimately omits the pool. */
  it('treats an absent pool as empty', async () => {
    const request = vi.fn(async () => ok({}))

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.monthlyRemaining).toBe(0)
    expect(balance.stableRemaining).toBe(0)
    expect(balance.refreshAt).toBeNull()
  })

  it('reports no refresh date rather than an invalid one', async () => {
    const request = vi.fn(async () =>
      ok({ monthly_api_credits_refresh_at: 'not a date' })
    )

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.refreshAt).toBeNull()
  })

  it('refuses without a token, without making a request', async () => {
    const request = vi.fn(async () => ok({}))

    await expect(
      api(request as unknown as typeof fetch, null).balance()
    ).rejects.toBeInstanceOf(CreditsApiError)
    expect(request).not.toHaveBeenCalled()
  })

  it('surfaces the server’s own message on a failure', async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Account suspended.' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
    )

    await expect(
      api(request as unknown as typeof fetch).balance()
    ).rejects.toThrow('Account suspended.')
  })

  it('refuses when no API base URL is configured', async () => {
    const request = vi.fn(async () => ok({}))
    const client = createCreditsApi({
      token: () => 'tok-1',
      baseUrl: '',
      fetch: request as unknown as typeof fetch,
    })

    await expect(client.balance()).rejects.toBeInstanceOf(CreditsApiError)
    expect(request).not.toHaveBeenCalled()
  })

  it('reads the personal pool when there is no org', async () => {
    const urls: string[] = []
    const request = async (url: string) => {
      urls.push(url)
      return ok({})
    }
    const client = createCreditsApi({
      token: () => 'tok-1',
      baseUrl: 'https://api.test',
      fetch: request as unknown as typeof fetch,
    })

    const balance = await client.balance()

    expect(urls[0]).toBe('https://api.test/user/payment/balance')
    expect(balance.scope).toBe('user')
  })

  /*
   * The bug this fixes: an org member has no personal credits, so the user
   * endpoint returns zero however much the org has — which reads as "you are out
   * of credits" rather than "wrong pool".
   */
  it('reads the org pool when the caller is in an org', async () => {
    const urls: string[] = []
    const request = async (url: string) => {
      urls.push(url)
      return ok({})
    }
    const client = createCreditsApi({
      token: () => 'tok-1',
      org: () => 'org-1',
      baseUrl: 'https://api.test',
      fetch: request as unknown as typeof fetch,
    })

    const balance = await client.balance()

    expect(urls[0]).toBe('https://api.test/org/payment/balance')
    expect(balance.scope).toBe('org')
  })

  it('follows the org function rather than a captured value', async () => {
    const urls: string[] = []
    let org: string | null = null
    const request = async (url: string) => {
      urls.push(url)
      return ok({})
    }
    const client = createCreditsApi({
      token: () => 'tok-1',
      org: () => org,
      baseUrl: 'https://api.test',
      fetch: request as unknown as typeof fetch,
    })

    await client.balance()
    org = 'org-1'
    await client.balance()

    expect(urls[0]).toContain('/user/')
    expect(urls[1]).toContain('/org/')
  })

  it('reports a contract-billed account as unlimited', async () => {
    const request = vi.fn(async () =>
      ok({
        monthly_api_credits_remaining: 0,
        stable_api_credits_remaining: 0,
        subscription_details: { modeling_app: { price: { type: 'contract' } } },
      })
    )

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.unlimited).toBe(true)
  })

  /* An org on a metered plan is not unlimited: the price type is the signal. */
  it('does not treat a metered plan as unlimited', async () => {
    const request = vi.fn(async () =>
      ok({
        monthly_api_credits_remaining: 100,
        subscription_details: { modeling_app: { price: { type: 'per_user' } } },
      })
    )

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.unlimited).toBe(false)
  })

  it('is not unlimited when the response says nothing about a subscription', async () => {
    const request = vi.fn(async () => ok({}))

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.unlimited).toBe(false)
  })

  it('reads what is owed', async () => {
    const request = vi.fn(async () => ok({ total_due: 12.5 }))

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.totalDue).toBe(12.5)
  })

  /* Documented as only returned when asked for, so absent means "not told". */
  it('reports an absent amount owed as null rather than zero', async () => {
    const request = vi.fn(async () => ok({}))

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.totalDue).toBeNull()
  })

  it('keeps a genuine zero owed distinct from not knowing', async () => {
    const request = vi.fn(async () => ok({ total_due: 0 }))

    const balance = await api(request as unknown as typeof fetch).balance()

    expect(balance.totalDue).toBe(0)
  })
})
