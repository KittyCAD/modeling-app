import type { UserResponse } from '@kittycad/lib'
import { batch, signal } from '@preact/signals-core'
import {
  clearSessionExpiredNotice,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import type { RuntimeInfo } from '@src/registry/contracts/runtime'
import { createAuthOrganizationState } from '@src/registry/extensions/auth/organization'
import { afterEach, describe, expect, it, vi } from 'vitest'

const organization = {
  id: 'organization-a',
  name: 'Organization A',
  role: 'member',
  created_at: '2026-11-20T00:00:00Z',
  updated_at: '2026-11-20T00:00:00Z',
}

function user(id: string): UserResponse {
  return {
    id,
    image: '',
    created_at: '2026-11-20T00:00:00Z',
    updated_at: '2026-11-20T00:00:00Z',
  }
}

describe('auth organization state', () => {
  let dispose: (() => void) | undefined

  afterEach(() => {
    dispose?.()
    dispose = undefined
    vi.unstubAllGlobals()
    clearSessionExpiredNotice()
  })

  async function setup(loggedIn = true) {
    const auth = {
      token: signal('token-a'),
      user: signal<UserResponse | undefined>(user('account-a')),
      isLoggedIn: signal(loggedIn),
    }
    const runtime = signal<RuntimeInfo>({
      target: 'web',
      hasWindow: true,
      isDesktop: false,
      isWeb: true,
      isServer: false,
      isPlaywright: false,
      environmentName: 'test',
      apiBaseUrl: 'https://api.test',
    })
    const organizationState = createAuthOrganizationState(
      auth,
      signal({
        current: runtime,
        get: () => runtime.value,
        refresh: () => runtime.value,
      })
    )
    dispose = organizationState.start()
    return { auth, runtime, org: organizationState.state }
  }

  it('waits for authenticated account identity and shares one pending request with all callers', async () => {
    const request = Promise.withResolvers<Response>()
    const fetch = vi.fn<typeof globalThis.fetch>(() => request.promise)
    vi.stubGlobal('fetch', fetch)
    const { auth, org } = await setup(false)

    expect(fetch).not.toHaveBeenCalled()
    await org.refresh()
    expect(fetch).not.toHaveBeenCalled()

    batch(() => {
      auth.user.value = undefined
      auth.isLoggedIn.value = true
    })
    expect(fetch).not.toHaveBeenCalled()
    auth.user.value = user('account-a')
    const first = org.refresh()
    const second = org.refresh()
    expect(first).toBe(second)
    expect(org.loading.value).toBe(true)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.test/user/org')
    expect(
      new Headers(fetch.mock.calls[0][1]?.headers).get('Authorization')
    ).toBe('Bearer token-a')

    request.resolve(Response.json(organization))
    await first
    expect(org.current.value).toEqual(organization)
    expect(org.loading.value).toBe(false)
    expect(org.error.value).toBeUndefined()
  })

  it('treats 404 as no membership and can refresh after the user joins an organization', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ message: 'No organization' }, { status: 404 })
      )
      .mockResolvedValueOnce(Response.json(organization))
    vi.stubGlobal('fetch', fetch)
    const { org } = await setup()
    await org.refresh()
    expect(org.current.value).toBeUndefined()
    expect(org.loading.value).toBe(false)
    expect(org.error.value).toBeUndefined()

    await org.refresh()
    expect(org.current.value).toEqual(organization)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('exposes permission failures without signing the user out and supports retry', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ message: 'Permission denied' }, { status: 403 })
      )
      .mockResolvedValueOnce(Response.json(organization))
    vi.stubGlobal('fetch', fetch)
    const { org, auth } = await setup()
    await org.refresh()
    expect(org.current.value).toBeUndefined()
    expect(org.error.value).toMatchObject({ status: 403 })
    expect(org.loading.value).toBe(false)
    expect(auth.isLoggedIn.value).toBe(true)
    expect(sessionExpiredNotice.value).toBeUndefined()

    await org.refresh()
    expect(org.current.value).toEqual(organization)
    expect(org.error.value).toBeUndefined()
  })

  it.each([200, 401])(
    'clears account state and ignores a late %i response from the old account',
    async (status) => {
      const oldRequest = Promise.withResolvers<Response>()
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json(organization))
        .mockReturnValueOnce(oldRequest.promise)
        .mockResolvedValueOnce(
          Response.json({ ...organization, id: 'organization-b' })
        )
      vi.stubGlobal('fetch', fetch)
      const { org, auth } = await setup()
      await org.refresh()
      const oldRefresh = org.refresh()
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      batch(() => {
        auth.user.value = user('account-b')
        auth.token.value = 'token-b'
      })
      expect(org.current.value).toBeUndefined()
      expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true)
      await org.refresh()
      expect(org.current.value?.id).toBe('organization-b')
      expect(
        new Headers(fetch.mock.calls[2][1]?.headers).get('Authorization')
      ).toBe('Bearer token-b')

      oldRequest.resolve(
        Response.json(
          { ...organization, message: 'Old account expired' },
          { status }
        )
      )
      await oldRefresh
      expect(org.current.value?.id).toBe('organization-b')
      expect(org.error.value).toBeUndefined()
      expect(org.loading.value).toBe(false)
      expect(sessionExpiredNotice.value).toBeUndefined()
    }
  )

  it('refetches for an API or token change but not unrelated runtime metadata', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(organization)
    )
    vi.stubGlobal('fetch', fetch)
    const { org, auth, runtime } = await setup()
    await org.refresh()
    runtime.value = { ...runtime.value, nodeEnv: 'test' }
    expect(fetch).toHaveBeenCalledOnce()
    expect(org.current.value).toEqual(organization)

    runtime.value = { ...runtime.value, apiBaseUrl: 'https://preview.test' }
    expect(org.current.value).toBeUndefined()
    await org.refresh()
    expect(String(fetch.mock.calls[1][0])).toBe('https://preview.test/user/org')

    auth.token.value = 'renewed-token'
    expect(org.current.value).toBeUndefined()
    await org.refresh()
    expect(
      new Headers(fetch.mock.calls[2][1]?.headers).get('Authorization')
    ).toBe('Bearer renewed-token')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('clears on logout and cancels pending work when auth is disposed', async () => {
    const request = Promise.withResolvers<Response>()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(organization))
      .mockReturnValueOnce(request.promise)
    vi.stubGlobal('fetch', fetch)
    const { org, auth } = await setup()
    await org.refresh()
    auth.isLoggedIn.value = false
    expect(org.current.value).toBeUndefined()
    expect(org.loading.value).toBe(false)

    auth.isLoggedIn.value = true
    const pending = org.refresh()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    dispose?.()
    dispose = undefined
    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true)
    expect(org.current.value).toBeUndefined()
    expect(org.loading.value).toBe(false)
    request.resolve(Response.json(organization))
    await pending
    await org.refresh()
    expect(org.current.value).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
