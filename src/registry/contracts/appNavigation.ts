import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { IndexLoaderData } from '@src/lib/types'
import type {
  AppUrlState,
  ParsedAppNavigationIntent,
} from '@src/registry/contracts/appUrl'

declare const appNavigationIntentInput: unique symbol
declare const appNavigationIntentOutput: unique symbol

/**
 * A typed token naming one application-navigation intent.
 *
 * Capabilities export tokens while their registry items contribute handlers,
 * so appNavigation can dispatch an extensible catalog without knowing every
 * capability at compile time.
 */
export interface AppNavigationIntent<Input, Output> {
  readonly id: string
  readonly placement: 'primary' | 'additional'
  readonly [appNavigationIntentInput]?: Input
  readonly [appNavigationIntentOutput]?: Output
}

/** A type-erased handler stored in the registry after input/output are paired. */
export interface AppNavigationIntentContribution {
  readonly intentId: string
  readonly dispatch: (input: unknown) => Promise<unknown>
}

export function defineAppNavigationIntent<Input, Output>(
  id: string,
  { placement = 'primary' }: { placement?: 'primary' | 'additional' } = {}
): AppNavigationIntent<Input, Output> {
  return { id, placement }
}

export function defineAppNavigationIntentContribution<Input, Output>(
  intent: AppNavigationIntent<Input, Output>,
  dispatch: (input: Input) => Promise<Output>
): AppNavigationIntentContribution {
  return {
    intentId: intent.id,
    dispatch: (input) => dispatch(input as Input),
  }
}

/**
 * An application-level request to enter a project.
 *
 * `target` is deliberately broader than a file path while the existing
 * `/file/*` URL shape is supported. Resolving that legacy target into a project
 * and optional initial editor is the coordinator's responsibility.
 */
export interface OpenProjectRequest {
  target: string
  /** Parsed URL-owned state, present only while restoring cold startup. */
  startup?: AppUrlState
}

export type OpenProjectOutcome = { kind: 'opened'; data: IndexLoaderData }

/** The first application intent moved behind the navigation coordinator. */
export const openProjectIntent = defineAppNavigationIntent<
  OpenProjectRequest,
  OpenProjectOutcome
>('project.open')

export interface ShowHomeRequest {
  libraryId?: string
  /** Parsed URL-owned state, present only while restoring cold startup. */
  startup?: AppUrlState
}

/** Enter Home and optionally restore its selected project library. */
export const showHomeIntent = defineAppNavigationIntent<
  ShowHomeRequest,
  undefined
>('home.show')

/**
 * Coordinates application intents without owning durable application state.
 *
 * Project and editor lifecycle belongs to `projectSession`; this service only
 * resolves requests and delegates to the capability that owns the result.
 */
export interface AppNavigationService {
  /** The additional application intent currently presented over a destination. */
  activeAdditionalIntent: ReadonlySignal<ParsedAppNavigationIntent | undefined>
  dispatch: <Input, Output>(
    intent: AppNavigationIntent<Input, Output>,
    input: Input
  ) => Promise<Output>
  dismissAdditionalIntent: () => void
}

export const appNavigationContract = defineContract({
  appNavigationIntentContributionsValueSpec:
    appendValueSpec<AppNavigationIntentContribution>(
      'application-navigation.intents'
    ),
  appNavigationService: defineService<AppNavigationService>(
    'application-navigation'
  ),
})

export const {
  appNavigationIntentContributionsValueSpec,
  appNavigationService,
} = appNavigationContract
