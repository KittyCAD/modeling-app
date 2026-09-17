import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { IndexLoaderData } from '@src/lib/types'

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
  readonly [appNavigationIntentInput]?: Input
  readonly [appNavigationIntentOutput]?: Output
}

/** A type-erased handler stored in the registry after input/output are paired. */
export interface AppNavigationIntentContribution {
  readonly intentId: string
  readonly dispatch: (input: unknown) => Promise<unknown>
}

export function defineAppNavigationIntent<Input, Output>(
  id: string
): AppNavigationIntent<Input, Output> {
  return { id }
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
  target?: string
  requestUrl?: string
  /**
   * Transitional React Router loader cancellation. Once startup is no longer
   * loader-owned, appNavigation keeps latest-intent cancellation private.
   */
  signal?: AbortSignal
}

export type OpenProjectOutcome =
  | { kind: 'opened'; data: IndexLoaderData }
  /**
   * Transitional loader-compatible result used while React Router still
   * initiates project opens. The final inversion replaces this with opening
   * normalized project state and projecting its canonical URL afterward.
   */
  | { kind: 'redirect'; to: string }

/** The first application intent moved behind the navigation coordinator. */
export const openProjectIntent = defineAppNavigationIntent<
  OpenProjectRequest,
  OpenProjectOutcome
>('project.open')

/**
 * Coordinates application intents without owning durable application state.
 *
 * Project and editor lifecycle belongs to `projectSession`; this service only
 * resolves requests and delegates to the capability that owns the result.
 */
export interface AppNavigationService {
  dispatch: <Input, Output>(
    intent: AppNavigationIntent<Input, Output>,
    input: Input
  ) => Promise<Output>
  showHome: () => Promise<void>
  /**
   * Transitional escape hatch for a legacy file route that returns before it
   * can call openProject. Remove it with the effectful loader integration.
   */
  supersedeProjectOpen: (signal?: AbortSignal) => void
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
