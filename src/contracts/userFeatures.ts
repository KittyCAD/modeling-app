import { defineContract, defineService } from '@kittycad/registry'
import type { Feature } from '@kittycad/lib'
import type { ReadonlySignal } from '@preact/signals'

/**
 * Which company-administered features this account has.
 *
 * Deliberately not settings. A setting is a preference with a three-level
 * cascade and a file someone can edit; a feature is an answer from the API about
 * what this account is allowed to see, and a project file has no business
 * turning one on. They are also asked differently: a setting always has a value,
 * while a feature has an answer only once it has been fetched.
 *
 * The API returns *only* the features resolved true for the caller, so presence
 * is the whole answer and absence means off — there is no third state to model.
 */
export type FeatureId = Feature

export type UserFeaturesStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface UserFeaturesService {
  readonly status: ReadonlySignal<UserFeaturesStatus>
  /** Features known to be on. Empty until the answer arrives, and when signed out. */
  readonly features: ReadonlySignal<ReadonlySet<FeatureId>>
  /** The reason the last fetch failed. Not fatal: absence of features is a usable state. */
  readonly error: ReadonlySignal<string | null>
  /**
   * True once the answer is as good as it is going to get.
   *
   * Ready, failed, or signed out — all three are settled, because a caller
   * gating on a feature needs to know when to stop waiting, not whether the
   * fetch succeeded.
   */
  readonly settled: ReadonlySignal<boolean>

  /**
   * Whether a feature is on, with an answer for "not known yet".
   *
   * The fallback is mandatory rather than defaulted to `false`, so every call
   * site has to decide what it does before the answer arrives. A gate that
   * silently reads false while loading flashes the ungated UI and then hides it.
   */
  has(feature: FeatureId, fallback: boolean): boolean

  /**
   * Resolve when settled, or when the wait has gone on long enough.
   *
   * For the callers that genuinely cannot proceed without an answer — a language
   * server whose executor is built once, at construction, from these flags.
   * Bounded, because a hung request must not be able to stop the app starting.
   */
  whenSettled(): Promise<ReadonlySet<FeatureId>>

  /** Ask again. Called on sign-in; otherwise rarely. */
  refresh(): Promise<void>
}

export const userFeaturesContract = defineContract({
  userFeaturesService: defineService<UserFeaturesService>(
    'userFeatures.service'
  ),
})

export const { userFeaturesService } = userFeaturesContract
