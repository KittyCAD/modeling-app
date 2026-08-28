import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type {
  FeatureId,
  UserFeaturesService,
  UserFeaturesStatus,
} from '@src/contracts/userFeatures'

/**
 * How long a caller that cannot proceed without an answer will wait.
 *
 * A failed fetch settles immediately, so this only bounds a hung request. Two
 * seconds because the thing on the other side of it is a language server
 * starting: long enough for a normal round trip, short enough that a dead
 * network does not hold the editor's features hostage.
 */
export const SETTLE_TIMEOUT_MS = 2000

export interface UserFeaturesDependencies {
  /** Null while signed out. The service follows this. */
  token: ReadonlySignal<string | null>
  fetchFeatures: (token: string) => Promise<ReadonlySet<FeatureId>>
  timeoutMs?: number
}

/**
 * The account's feature set, followed from the token.
 *
 * Status and error rather than a state machine, the same choice the engine
 * connection made: the states are idle, loading, ready and failed, and none of
 * them has behaviour a machine would be enforcing.
 *
 * Three properties worth keeping:
 *
 * - **Signed out is settled, not pending.** There is nothing to wait for without
 *   a token, so a caller gating on a feature proceeds immediately rather than
 *   stalling for a request that will never be made.
 * - **A failure is not fatal.** The features are empty, `error` says why, and
 *   everything gated on one behaves as though the account does not have it —
 *   which is the same as the ordinary case for most accounts.
 * - **A stale answer is never served.** A response for a token that is no longer
 *   the current one is dropped, so signing out and back in as someone else
 *   cannot leave the previous account's features in place.
 */
export function createUserFeaturesService(
  dependencies: UserFeaturesDependencies
): UserFeaturesService & { sync: () => void; dispose: () => void } {
  const { token, fetchFeatures, timeoutMs = SETTLE_TIMEOUT_MS } = dependencies

  const status = signal<UserFeaturesStatus>('idle')
  const features = signal<ReadonlySet<FeatureId>>(new Set())
  const error = signal<string | null>(null)

  /** Which token the current in-flight request belongs to. */
  let inFlightFor: string | null = null

  const settled = computed(
    () =>
      status.value === 'ready' ||
      status.value === 'failed' ||
      // Nothing to fetch, so the answer is already final.
      (status.value === 'idle' && token.value === null)
  )

  const load = async (next: string | null) => {
    if (next === null) {
      inFlightFor = null
      status.value = 'idle'
      features.value = new Set()
      error.value = null
      return
    }

    inFlightFor = next
    status.value = 'loading'
    error.value = null

    try {
      const result = await fetchFeatures(next)
      // Dropped if the token moved on while we were asking: a late answer for a
      // previous account is worse than no answer.
      if (inFlightFor !== next) return
      features.value = result
      status.value = 'ready'
    } catch (caught) {
      if (inFlightFor !== next) return
      features.value = new Set()
      error.value =
        caught instanceof Error
          ? caught.message
          : 'The feature list could not be read.'
      status.value = 'failed'
    }
  }

  /**
   * Follow the token.
   *
   * Not an effect over the signal: this service is created during graph
   * construction, and an effect started there would run its body immediately —
   * the rule the container enforces. The caller starts it once the graph is
   * flattened.
   */
  let lastToken: string | null | undefined
  const sync = () => {
    const next = token.value
    if (next === lastToken) return
    lastToken = next
    void load(next)
  }

  return {
    status: computed(() => status.value),
    features: computed(() => features.value),
    error: computed(() => error.value),
    settled,

    has: (feature, fallback) =>
      settled.value ? features.value.has(feature) : fallback,

    whenSettled: () =>
      new Promise<ReadonlySet<FeatureId>>((resolve) => {
        if (settled.peek()) {
          resolve(features.peek())
          return
        }

        let done = false
        let stop: (() => void) | undefined

        const finish = () => {
          if (done) return
          done = true
          window.clearTimeout(timer)
          // Optional because `subscribe` calls back synchronously, so this can
          // run before the disposer has been assigned.
          stop?.()
          resolve(features.peek())
        }

        const timer = window.setTimeout(finish, timeoutMs)
        // Subscribed rather than polled, and torn down either way — a promise
        // that leaves a subscription behind is a leak per caller.
        stop = settled.subscribe((value) => {
          if (value) finish()
        })
      }),

    refresh: () => load(token.peek()),

    /**
     * Start following the token.
     *
     * Called by the registry item after the graph is flattened, not from the
     * factory body: an effect started during construction runs immediately,
     * which is the rule the container enforces.
     */
    sync,

    dispose: () => {
      inFlightFor = null
    },
  }
}
