import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import { byOrder, dedupeById } from '@src/lib/registryOrdering'

/**
 * What the account has left, as the API last reported it.
 *
 * Two pools rather than one because the API returns two and they behave
 * differently: monthly credits are re-upped and do not carry over, stable ones
 * persist. A readout that summed them would be telling you a number that
 * changes meaning at the start of every month.
 */
export interface CreditBalance {
  monthlyRemaining: number
  stableRemaining: number
  /**
   * When the monthly pool next refreshes, or null when no billing schedule owns
   * it. May be in the past: the API returns the due timestamp until the refresh
   * is actually applied, so a past value means pending, not overdue.
   */
  refreshAt: number | null
  /** When this was read. The readout says "as of", because it cannot say "now". */
  fetchedAt: number
}

/**
 * One thing currently spending credits.
 *
 * `project` is denormalised rather than looked up, and that is the whole point
 * of this shape: a conversation outlives the project session it started in, so
 * asking "which project is this spending against" at display time gets the
 * answer wrong the moment somebody closes the project. What is recorded is where
 * the spending *started*, which is a historical fact and cannot go stale.
 */
export interface CreditConsumer {
  /** Stable across a span of spending, so elapsed time can accumulate. */
  id: string
  /** What kind of thing is spending, for grouping and for the icon. */
  kind: 'zookeeper.conversation' | 'textToCad' | 'other'
  /** How to name it to a person: "Conversation 2". */
  label: string
  /**
   * The project it is working in, by name, or null when it belongs to no
   * project. Null is a real state, not missing data — the meta-agent case.
   */
  project: string | null
  /** When this span of spending began. */
  startedAt: number
}

/**
 * A feature that can spend credits.
 *
 * Contributed rather than registered through a method on the service, so that a
 * plugin turning off takes its consumers with it: the value spec simply stops
 * including them. A push-based API would leave the credits service holding
 * consumers belonging to a feature that no longer exists.
 */
export interface CreditConsumerSource {
  id: string
  order?: number
  /** Empty whenever this source is not spending. */
  consumers: ReadonlySignal<readonly CreditConsumer[]>
}

/**
 * The account's credit balance, and who is spending it.
 *
 * Account-level rather than per-project on purpose. Credits are one pool shared
 * by every agent in the app, so a readout scoped to the open project would
 * answer the wrong question the moment a second conversation — or a second
 * project — is spending against it.
 *
 * Deliberately does *not* estimate a decremented balance. The Zookeeper
 * protocol reports no usage (`MlCopilotServerMessage` has no usage arm), and the
 * balance endpoint returns no per-second price, so a ticking number would be
 * invented precision. What is honest is available: the balance as of a moment,
 * and exactly who has been spending since.
 */
export interface CreditsService {
  readonly balance: ReadonlySignal<CreditBalance | null>
  readonly state: ReadonlySignal<'idle' | 'loading' | 'ready' | 'error'>
  /** Why the balance is unavailable, for the readout to show in place of it. */
  readonly error: ReadonlySignal<string | null>
  /** Everything spending right now, across every source, in start order. */
  readonly consumers: ReadonlySignal<readonly CreditConsumer[]>
  /** True while anything is spending, so the readout can say the number is moving. */
  readonly spending: ReadonlySignal<boolean>
  /** Re-read the balance. Rate limited; safe to call on every turn boundary. */
  refresh(): Promise<void>
}

export const creditsContract = defineContract({
  creditsService: defineService<CreditsService>('credits.service'),
  creditConsumersValueSpec: defineValueSpec<
    CreditConsumerSource,
    CreditConsumerSource[]
  >({
    name: 'credits.consumerSources',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
})

export const { creditsService, creditConsumersValueSpec } = creditsContract
