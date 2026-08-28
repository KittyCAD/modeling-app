import { effect, signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureId } from '@src/contracts/userFeatures'
import {
  SETTLE_TIMEOUT_MS,
  createUserFeaturesService,
} from '@src/features/userFeatures/createUserFeaturesService'

/** Let a resolved promise's continuations run. */
const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(
  options: {
    token?: string | null
    fetchFeatures?: (token: string) => Promise<ReadonlySet<FeatureId>>
  } = {}
) {
  // Not `??`: `null` is a meaningful value here — it is what signed out looks
  // like — and coalescing would quietly turn every signed-out test into a
  // signed-in one.
  const token = signal<string | null>(
    options.token === undefined ? 'token-1' : options.token
  )
  const calls: string[] = []

  const fetchFeatures =
    options.fetchFeatures ??
    (async (given: string) => {
      calls.push(given)
      return new Set<FeatureId>(['plugins'])
    })

  const service = createUserFeaturesService({
    token,
    fetchFeatures: async (given) => {
      if (!options.fetchFeatures) calls.push(given)
      return options.fetchFeatures
        ? await options.fetchFeatures(given)
        : new Set<FeatureId>(['plugins'])
    },
  })

  // What the registry item does once the graph is flat.
  const stop = effect(() => service.sync())

  return { service, token, calls, stop, fetchFeatures }
}

describe('user features', () => {
  it('fetches for the token it is given', async () => {
    const { service, calls } = setup()
    await settleMicrotasks()

    expect(calls).toEqual(['token-1'])
    expect(service.status.value).toBe('ready')
    expect(service.has('plugins', false)).toBe(true)
    expect(service.has('billing', false)).toBe(false)
  })

  it('re-fetches when the token changes', async () => {
    const { service, token, calls } = setup()
    await settleMicrotasks()

    token.value = 'token-2'
    await settleMicrotasks()

    expect(calls).toEqual(['token-1', 'token-2'])
    expect(service.status.value).toBe('ready')
  })

  it('does not re-fetch when the token is set to the same value', async () => {
    const { token, calls } = setup()
    await settleMicrotasks()

    token.value = 'token-1'
    await settleMicrotasks()

    expect(calls).toEqual(['token-1'])
  })

  /** Signing out is not "unknown"; it is a final answer of no features. */
  it('clears and settles on sign-out', async () => {
    const { service, token } = setup()
    await settleMicrotasks()
    expect(service.features.value.size).toBe(1)

    token.value = null
    await settleMicrotasks()

    expect(service.features.value.size).toBe(0)
    expect(service.status.value).toBe('idle')
    expect(service.settled.value).toBe(true)
  })

  it('is settled before anything happens when there is no token at all', () => {
    const { service } = setup({ token: null })
    expect(service.settled.value).toBe(true)
    expect(service.has('plugins', true)).toBe(false)
  })

  /**
   * The fallback exists for the window before the answer arrives, which is why
   * it is mandatory: a gate that reads false while loading flashes the ungated
   * UI and then hides it.
   */
  it('answers with the fallback until it has an answer', async () => {
    const { service } = setup()

    expect(service.settled.value).toBe(false)
    expect(service.has('plugins', true)).toBe(true)
    expect(service.has('plugins', false)).toBe(false)

    await settleMicrotasks()
    expect(service.has('plugins', false)).toBe(true)
  })

  it('treats a failed fetch as no features, and says why', async () => {
    const { service } = setup({
      fetchFeatures: async () => {
        throw new Error('The feature list could not be read.')
      },
    })
    await settleMicrotasks()

    expect(service.status.value).toBe('failed')
    expect(service.settled.value).toBe(true)
    expect(service.features.value.size).toBe(0)
    expect(service.error.value).toBe('The feature list could not be read.')
    // Gated things behave as though the account does not have the feature,
    // which is the ordinary case for most accounts.
    expect(service.has('plugins', false)).toBe(false)
  })

  /**
   * A late answer for an account that is no longer signed in would leave the
   * previous user's features in place — the worst failure available here.
   */
  it('drops an answer for a token that has moved on', async () => {
    let release: (value: ReadonlySet<FeatureId>) => void = () => {}
    const { service, token } = setup({
      token: 'slow',
      fetchFeatures: (given) =>
        given === 'slow'
          ? new Promise<ReadonlySet<FeatureId>>((resolve) => {
              release = resolve
            })
          : Promise.resolve(new Set<FeatureId>(['billing'])),
    })

    token.value = 'fast'
    await settleMicrotasks()
    expect(service.has('billing', false)).toBe(true)

    // The first request finally answers, for an account nobody is using.
    release(new Set(['plugins']))
    await settleMicrotasks()

    expect(service.has('plugins', false)).toBe(false)
    expect(service.has('billing', false)).toBe(true)
  })

  it('asks again on demand', async () => {
    const { service, calls } = setup()
    await settleMicrotasks()

    await service.refresh()
    expect(calls).toEqual(['token-1', 'token-1'])
  })

  describe('whenSettled', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('resolves immediately when there is nothing to wait for', async () => {
      const { service } = setup({ token: null })
      await expect(service.whenSettled()).resolves.toEqual(new Set())
    })

    /**
     * The point of the bound: a hung request must not be able to stop a language
     * server starting. It proceeds with what it knows, which is nothing.
     */
    it('gives up after the timeout and proceeds with what it has', async () => {
      const { service } = setup({
        fetchFeatures: () => new Promise(() => {}),
      })

      const waiting = service.whenSettled()
      vi.advanceTimersByTime(SETTLE_TIMEOUT_MS)

      await expect(waiting).resolves.toEqual(new Set())
      expect(service.status.value).toBe('loading')
    })
  })
})
