import { computed, effect, signal } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'
import type {
  CreditBalance,
  CreditConsumer,
  CreditConsumerSource,
  CreditUsage,
  CreditsService,
} from '@src/contracts/credits'
import type { CreditsApi } from '@src/features/credits/creditsApi'

/** Client-side rate limit, so a burst of turn boundaries is one request. */
const MIN_FETCH_INTERVAL_MS = 1_000

/** How often to re-read the balance while signed in. */
const DEFAULT_POLL_INTERVAL_MS = 60_000

/** How often the usage clock advances while something is spending. */
const USAGE_TICK_MS = 1_000

export interface CreditsServiceDependencies {
  api: CreditsApi
  token: ReadonlySignal<string | null>
  /**
   * The org whose pool is being read, or null for the personal one.
   *
   * Watched as well as passed to the api, because membership arrives *after*
   * the first read: sign-in verifies the token, then fetches the profile. The
   * first balance is therefore the personal pool, and without a re-read on this
   * an org member would keep looking at it.
   */
  org?: ReadonlySignal<string | null>
  /** Every source that can spend, as contributed to the value spec. */
  sources: ReadonlySignal<readonly CreditConsumerSource[]>
  /** 0 disables polling. Tests pass 0 and drive `refresh` themselves. */
  pollIntervalMs?: number
}

export interface CreditsServiceModel extends CreditsService {
  dispose(): void
}

/**
 * The account's credit balance, and who is spending it.
 *
 * Signals rather than a machine: there is no multi-step flow here. A fetch is in
 * flight or it is not, and the four states the readout distinguishes are
 * functions of what has been read so far.
 *
 * The balance is re-read at two moments, and which two is the design. A slow
 * poll, because usage is metered server-side and the number moves whether or not
 * this client caused it. And the instant spending *stops*, because that is when
 * a turn's cost has actually landed — polling faster during a turn would show a
 * number lagging behind by an unknown amount either way.
 */
export function createCreditsService(
  dependencies: CreditsServiceDependencies
): CreditsServiceModel {
  const { api, token, org, sources } = dependencies
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  const balance = signal<CreditBalance | null>(null)
  const error = signal<string | null>(null)
  const loading = signal(false)

  let lastFetchAt = 0
  let inFlight: Promise<void> | null = null
  let disposed = false

  /**
   * Every consumer, flattened, oldest span first.
   *
   * Sorted by when spending started rather than by source, because the question
   * the list answers is "what is running", and the thing that has been running
   * longest is the one worth looking at first.
   */
  const consumers = computed<readonly CreditConsumer[]>(() =>
    sources.value
      .flatMap((source) => source.consumers.value)
      .slice()
      .sort((a, b) => a.startedAt - b.startedAt)
  )

  const spending = computed(() => consumers.value.length > 0)

  /**
   * What each conversation has spent, accumulated across its turns.
   *
   * Kept outside the signal graph and advanced by a ticker, because the quantity
   * being measured is *elapsed time*: no signal changes as a turn runs, so a
   * computed over the consumer list would report the same number until the turn
   * ended and then jump.
   *
   * Spans are settled on the way out rather than sampled on the way in, so a
   * conversation that has gone quiet keeps whatever it used.
   */
  const settledMs = new Map<string, number>()
  const labels = new Map<string, { label: string; project: string | null }>()
  /** Spans currently open, by consumer id, with the time last charged for. */
  const openSpans = new Map<string, { groupId: string; chargedTo: number }>()
  const usageVersion = signal(0)

  /**
   * Move every open span's clock forward, and close the ones that have gone.
   *
   * Charging incrementally rather than from `startedAt` at the end means a span
   * interrupted by a reload or a dispose has still contributed what it ran for.
   */
  const chargeUsage = () => {
    const now = Date.now()
    const live = consumers.peek()
    const seen = new Set<string>()

    for (const consumer of live) {
      seen.add(consumer.id)
      labels.set(consumer.groupId, {
        label: consumer.label,
        project: consumer.project,
      })

      const open = openSpans.get(consumer.id)
      // A span first seen after it started is charged from its own start, not
      // from now, or the first tick would silently lose up to a second.
      const chargedTo = open?.chargedTo ?? consumer.startedAt
      const advance = Math.max(0, now - chargedTo)

      settledMs.set(
        consumer.groupId,
        (settledMs.get(consumer.groupId) ?? 0) + advance
      )
      openSpans.set(consumer.id, { groupId: consumer.groupId, chargedTo: now })
    }

    for (const id of [...openSpans.keys()]) {
      if (!seen.has(id)) openSpans.delete(id)
    }

    usageVersion.value += 1
  }

  const usage = computed<readonly CreditUsage[]>(() => {
    // Reading the version is what makes this recompute as the clock advances.
    void usageVersion.value
    const activeGroups = new Set(
      consumers.value.map((consumer) => consumer.groupId)
    )

    return [...settledMs.entries()]
      .map(([groupId, totalMs]) => ({
        groupId,
        label: labels.get(groupId)?.label ?? groupId,
        project: labels.get(groupId)?.project ?? null,
        totalMs,
        active: activeGroups.has(groupId),
      }))
      .toSorted((a, b) => b.totalMs - a.totalMs)
  })

  const state = computed<'idle' | 'loading' | 'ready' | 'error'>(() => {
    if (loading.value && balance.value === null) return 'loading'
    if (error.value !== null && balance.value === null) return 'error'
    if (balance.value !== null) return 'ready'
    return 'idle'
  })

  const refresh = async () => {
    if (disposed) return
    // Coalesce rather than queue: two callers wanting the balance want the same
    // balance, and the second would only overwrite the first with the same read.
    if (inFlight) return inFlight
    if (token.peek() === null) {
      error.value = 'Sign in to see your credit balance.'
      return
    }
    if (Date.now() - lastFetchAt < MIN_FETCH_INTERVAL_MS) return

    loading.value = true
    inFlight = (async () => {
      try {
        const next = await api.balance()
        if (disposed) return
        balance.value = next
        error.value = null
      } catch (cause) {
        if (disposed) return
        error.value =
          cause instanceof Error ? cause.message : 'Could not read the balance.'
      } finally {
        lastFetchAt = Date.now()
        loading.value = false
        inFlight = null
      }
    })()

    return inFlight
  }

  const stops: Array<() => void> = []

  /*
   * Read once as soon as there is a token, and forget the balance when it goes.
   * Signing out has to clear it: a stale number belonging to the previous
   * account is worse than no number.
   */
  stops.push(
    effect(() => {
      if (token.value === null) {
        balance.value = null
        return
      }
      void refresh()
    })
  )

  /*
   * Re-read when the pool changes. See the note on `org`: the first read happens
   * before the profile lands, so this is what corrects it — and it also covers
   * switching accounts, where the previous org's balance must not linger.
   */
  if (org !== undefined) {
    let lastOrg = org.peek()
    stops.push(
      effect(() => {
        const next = org.value
        if (next === lastOrg) return
        lastOrg = next
        lastFetchAt = 0
        void refresh()
      })
    )
  }

  /*
   * Refresh when spending stops. Tracked as a transition rather than by reading
   * `spending` and reacting to every change, because the edge is the whole
   * signal: going from spending to idle means a cost has landed.
   */
  let wasSpending = spending.peek()
  stops.push(
    effect(() => {
      const now = spending.value
      const stopped = wasSpending && !now
      wasSpending = now
      if (stopped) void refresh()
    })
  )

  /*
   * The usage clock. Only runs while something is spending: an interval ticking
   * against an idle app would be a wakeup a second for a number that cannot
   * have changed.
   */
  let usageTimer: ReturnType<typeof setInterval> | undefined
  stops.push(
    effect(() => {
      const active = spending.value
      if (active && usageTimer === undefined) {
        // Charged immediately as well as on the interval, so the first second
        // is not missing from the total.
        chargeUsage()
        usageTimer = setInterval(chargeUsage, USAGE_TICK_MS)
      }
      if (!active && usageTimer !== undefined) {
        clearInterval(usageTimer)
        usageTimer = undefined
        // One last charge, so the tail between the final tick and the turn
        // ending is counted.
        chargeUsage()
      }
    })
  )
  stops.push(() => {
    if (usageTimer !== undefined) clearInterval(usageTimer)
    usageTimer = undefined
  })

  if (pollIntervalMs > 0) {
    const timer = setInterval(() => {
      if (token.peek() !== null) void refresh()
    }, pollIntervalMs)
    stops.push(() => clearInterval(timer))
  }

  return {
    balance: computed(() => balance.value),
    state,
    error: computed(() => error.value),
    consumers,
    spending,
    usage,
    refresh,
    dispose: () => {
      disposed = true
      for (const stop of stops) stop()
      stops.length = 0
    },
  }
}
