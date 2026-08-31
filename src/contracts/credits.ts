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
  /**
   * True when a contract owns billing, so there is no metered pool to count.
   *
   * The two remaining figures are meaningless in that case and will usually be
   * zero — which is exactly why this flag has to exist. Without it an
   * enterprise account reads as a confident "0 credits", which is worse than
   * showing nothing: it is wrong in the direction that stops people working.
   *
   * The existing app expresses the same state as `balance === Infinity`.
   */
  unlimited: boolean
  /**
   * Money currently owed, or null when the API did not say.
   *
   * Outstanding and draft invoices plus pending items. It is what the readout
   * shows *instead of* a credit count once the credits are gone: at that point
   * "0 remaining" has stopped being the useful number and the amount accruing
   * has started.
   *
   * Null is not zero. The field is documented as only returned when asked for,
   * so an absent value means "not told".
   */
  totalDue: number | null
  /** Which pool this came from: the member's own, or their org's. */
  scope: 'user' | 'org'
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
  /**
   * What this span belongs to, across spans.
   *
   * A conversation runs many turns, and each turn is its own span of spending.
   * Grouping by this is what turns a list of spans into "what has this
   * conversation cost me", which is the question actually being asked.
   */
  groupId: string
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
/** What one conversation has spent, this session. */
export interface CreditUsage {
  groupId: string
  label: string
  project: string | null
  /** Total time it has held the service busy, across turns. */
  totalMs: number
  /** True while it is still spending. */
  active: boolean
}

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
  /**
   * What each conversation has spent this session, live.
   *
   * Accumulated locally, because nothing else will tell us: the protocol sends
   * no usage and the balance is an account-wide figure that cannot be
   * attributed. What is measurable is how long each conversation held the
   * service busy, and the existing app's own estimate reduces — once its
   * multiply and divide by the credit price cancel — to exactly that: elapsed
   * minutes, one credit each. So this is the same basis, made explicit.
   *
   * An estimate, and labelled as one wherever it is shown. It survives a span
   * ending, so a conversation that has gone quiet still reports what it used.
   */
  readonly usage: ReadonlySignal<readonly CreditUsage[]>
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
