import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import { isErr } from '@src/lib/trap'

export type UrlQuery = Readonly<Record<string, string | undefined>>

/** Browser transport only. Publication must not dispatch navigation events. */
export interface UrlAdapter {
  /** Capture a snapshot of the current URLSearchParams */
  captureSearch(): string
  /** Publish query parameters to the browser's URL */
  publish(query: UrlQuery): void
}

/**
 * A startup-only query contribution. Parsing is the only operation receiving
 * serialized input; initialization receives T and must honor cancellation at
 * interrupting state changes. Serialization reads application signals.
 */
export interface UrlBehavior<T> {
  id: string
  /** the keys claimed by this behavior contribution, used to detect collisions between contributions. */
  queryKeys: readonly string[]
  /** ingest search params to generate app state data or fail */
  parse(params: URLSearchParams): T | Error | undefined
  /** Given successfully-parsed app state data from the URL, perform the effect or state initialization in the app. */
  initialize(value: T, signal: AbortSignal): void | Promise<void>
  /** Take app state values and serialize them to search params to publish to the URL. */
  serialize?: () => UrlQuery
}

/** Retains parsed T with its initializer while heterogeneous behaviors coexist. */
export interface ParsedUrlContribution {
  initialize(signal: AbortSignal): Promise<void>
}

export interface UrlContribution {
  id: string
  /** the keys claimed by this behavior contribution, used to detect collisions between contributions. */
  queryKeys: readonly string[]
  /** ingest search params to generate an initialize callback that provides app state data or fail */
  parse(params: URLSearchParams): ParsedUrlContribution | Error | undefined
  /** Take app state values and serialize them to search params to publish to the URL. */
  serialize?: () => UrlQuery
}

/**
 * Helper function to close over the `initialize` callback with the data returned from `parse`.
 */
export function defineUrlContribution<T>(
  behavior: UrlBehavior<T>
): UrlContribution {
  return {
    id: behavior.id,
    queryKeys: behavior.queryKeys,
    serialize: behavior.serialize,
    parse: (params) => {
      const value = behavior.parse(params)
      if (isErr<unknown>(value)) return value
      if (value === undefined) return undefined
      return {
        initialize: async (signal) => {
          if (!signal.aborted) await behavior.initialize(value, signal)
        },
      }
    },
  }
}

export interface UrlRegistryService {
  /** Capture once; repeated calls return the same initialization promise. */
  start(adapter: UrlAdapter): Promise<void>
}

export const urlContract = defineContract({
  urlService: defineService<UrlRegistryService>('url.service'),
  urlContributionsValueSpec:
    appendValueSpec<UrlContribution>('url.contributions'),
})

export const { urlService, urlContributionsValueSpec } = urlContract
