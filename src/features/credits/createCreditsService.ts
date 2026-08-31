import { computed, effect, signal } from '@preact/signals'
import type { ReadonlySignal } from '@preact/signals'
import type {
  CreditBalance,
  CreditConsumer,
  CreditConsumerSource,
  CreditsService,
} from '@src/contracts/credits'
import type { CreditsApi } from '@src/features/credits/creditsApi'

/** Client-side rate limit, so a burst of turn boundaries is one request. */
const MIN_FETCH_INTERVAL_MS = 1_000

/** How often to re-read the balance while signed in. */
const DEFAULT_POLL_INTERVAL_MS = 60_000

export interface CreditsServiceDependencies {
  api: CreditsApi
  token: ReadonlySignal<string | null>
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
  const { api, token, sources } = dependencies
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
    refresh,
    dispose: () => {
      disposed = true
      for (const stop of stops) stop()
      stops.length = 0
    },
  }
}
