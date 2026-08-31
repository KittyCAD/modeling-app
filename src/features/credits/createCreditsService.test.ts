import { computed, signal } from '@preact/signals'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreditBalance,
  CreditConsumer,
  CreditConsumerSource,
} from '@src/contracts/credits'
import { createCreditsService } from '@src/features/credits/createCreditsService'

const aBalance = (over: Partial<CreditBalance> = {}): CreditBalance => ({
  monthlyRemaining: 900,
  stableRemaining: 100,
  refreshAt: null,
  unlimited: false,
  scope: 'user',
  fetchedAt: Date.now(),
  ...over,
})

const aConsumer = (over: Partial<CreditConsumer> = {}): CreditConsumer => ({
  id: 'c1:t1',
  kind: 'zookeeper.conversation',
  label: 'Conversation 1',
  project: 'bracket',
  startedAt: 1_000,
  ...over,
})

function harness(
  options: {
    balance?: () => Promise<CreditBalance>
    token?: string | null
    org?: string | null
    sources?: CreditConsumerSource[]
  } = {}
) {
  const token = signal<string | null>(
    options.token === undefined ? 'tok-1' : options.token
  )
  const org = signal<string | null>(options.org ?? null)
  const sources = signal<readonly CreditConsumerSource[]>(options.sources ?? [])
  const balance = vi.fn(options.balance ?? (async () => aBalance()))

  const service = createCreditsService({
    api: { balance },
    token,
    org: computed(() => org.value),
    sources: computed(() => sources.value),
    // No timer: every test drives the reads it wants.
    pollIntervalMs: 0,
  })

  return { service, token, org, sources, balance }
}

/** The service rate limits to one read a second; tests that read twice skip it. */
const pastTheRateLimit = () => vi.advanceTimersByTime(2_000)

describe('the credits service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('reads the balance as soon as there is a token', async () => {
    const { service, balance } = harness()
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    expect(service.state.value).toBe('ready')
    expect(service.balance.value?.monthlyRemaining).toBe(900)
    service.dispose()
  })

  it('does not read without a token, and says why', async () => {
    const { service, balance } = harness({ token: null })
    await service.refresh()

    expect(balance).not.toHaveBeenCalled()
    expect(service.state.value).toBe('error')
    expect(service.error.value).toMatch(/sign in/i)
    service.dispose()
  })

  /*
   * Signing out has to clear the number rather than leave it. A balance
   * belonging to the previous account is worse than no balance, because nothing
   * on screen would say it was not yours.
   */
  it('forgets the balance when the token goes away', async () => {
    const { service, token } = harness()
    await vi.waitFor(() => expect(service.balance.value).not.toBeNull())

    token.value = null
    expect(service.balance.value).toBeNull()
    service.dispose()
  })

  it('reports a failed read without discarding a balance it already had', async () => {
    let fail = false
    const { service } = harness({
      balance: async () => {
        if (fail) throw new Error('Balance unavailable.')
        return aBalance()
      },
    })
    await vi.waitFor(() => expect(service.balance.value).not.toBeNull())

    fail = true
    pastTheRateLimit()
    await service.refresh()

    expect(service.error.value).toBe('Balance unavailable.')
    // Still `ready`: a stale number with an error beside it beats a blank field.
    expect(service.state.value).toBe('ready')
    expect(service.balance.value?.monthlyRemaining).toBe(900)
    service.dispose()
  })

  it('flattens every source into one list, oldest span first', async () => {
    const first = signal<readonly CreditConsumer[]>([
      aConsumer({ id: 'b', startedAt: 2_000 }),
    ])
    const second = signal<readonly CreditConsumer[]>([
      aConsumer({ id: 'a', startedAt: 1_000 }),
    ])
    const { service } = harness({
      sources: [
        { id: 'one', consumers: computed(() => first.value) },
        { id: 'two', consumers: computed(() => second.value) },
      ],
    })

    expect(service.consumers.value.map((each) => each.id)).toEqual(['a', 'b'])
    expect(service.spending.value).toBe(true)
    service.dispose()
  })

  it('is not spending when every source is empty', () => {
    const { service } = harness({
      sources: [{ id: 'one', consumers: computed(() => []) }],
    })

    expect(service.spending.value).toBe(false)
    expect(service.consumers.value).toEqual([])
    service.dispose()
  })

  /*
   * The edge is the whole signal. Spending stopping is the moment a turn's cost
   * has actually landed, so it is the one moment worth re-reading on.
   */
  it('re-reads the balance when spending stops', async () => {
    const consumers = signal<readonly CreditConsumer[]>([aConsumer()])
    const { service, balance } = harness({
      sources: [{ id: 'one', consumers: computed(() => consumers.value) }],
    })
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    pastTheRateLimit()
    consumers.value = []
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(2))
    service.dispose()
  })

  it('does not re-read when spending starts', async () => {
    const consumers = signal<readonly CreditConsumer[]>([])
    const { service, balance } = harness({
      sources: [{ id: 'one', consumers: computed(() => consumers.value) }],
    })
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    pastTheRateLimit()
    consumers.value = [aConsumer()]
    await Promise.resolve()

    expect(balance).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('coalesces concurrent reads into one request', async () => {
    const { service, balance } = harness()
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    pastTheRateLimit()
    await Promise.all([service.refresh(), service.refresh(), service.refresh()])

    expect(balance).toHaveBeenCalledTimes(2)
    service.dispose()
  })

  it('rate limits a burst of turn boundaries to one request', async () => {
    const { service, balance } = harness()
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    // No clock advance: the second read lands inside the limit and is skipped.
    await service.refresh()

    expect(balance).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('stops reading once disposed', async () => {
    const { service, balance } = harness()
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    service.dispose()
    pastTheRateLimit()
    await service.refresh()

    expect(balance).toHaveBeenCalledTimes(1)
  })

  /*
   * The ordering that makes this necessary: sign-in verifies the token, and the
   * profile that says which org you are in lands after. So the first read is
   * always the personal pool, and an org member would sit looking at it.
   */
  it('re-reads the pool when org membership arrives after the first read', async () => {
    const { service, org, balance } = harness()
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    org.value = 'org-1'
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(2))
    service.dispose()
  })

  /* Membership is not the rate limit's business: it changes the answer. */
  it('re-reads on an org change even inside the rate limit', async () => {
    const { service, org, balance } = harness()
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    // No clock advance at all.
    org.value = 'org-1'
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(2))
    service.dispose()
  })

  it('does not re-read when the org is unchanged', async () => {
    const { service, org, balance } = harness({ org: 'org-1' })
    await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(1))

    org.value = 'org-1'
    await Promise.resolve()

    expect(balance).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  /*
   * The state this whole thing exists for: a contract-billed account has zero in
   * both pools, so anything summing them reports "0 credits" to somebody who has
   * no limit at all.
   */
  it('carries an unlimited balance through without counting it', async () => {
    const { service } = harness({
      balance: async () =>
        aBalance({
          unlimited: true,
          scope: 'org',
          monthlyRemaining: 0,
          stableRemaining: 0,
        }),
    })
    await vi.waitFor(() => expect(service.balance.value).not.toBeNull())

    expect(service.balance.value?.unlimited).toBe(true)
    expect(service.balance.value?.scope).toBe('org')
    expect(service.state.value).toBe('ready')
    service.dispose()
  })
})
