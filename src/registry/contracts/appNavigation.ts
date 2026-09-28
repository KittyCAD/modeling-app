import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ParsedAppNavigationIntent } from '@src/registry/contracts/appUrl'

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
 * Dispatches application intents without owning durable application state.
 *
 * Each contribution delegates to the capability that owns the resulting state;
 * this service only provides typed dispatch and additional-intent presentation.
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
