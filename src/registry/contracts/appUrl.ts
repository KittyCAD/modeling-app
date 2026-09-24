import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { AppNavigationIntent } from '@src/registry/contracts/appNavigation'
import type { Location, NavigateFunction } from 'react-router-dom'

export type AppUrlRuntimeValues = {
  location: Location
  navigate: NavigateFunction
}

export type AppDestinationKind = 'home' | 'project'

export interface AppNavigationUrlParts {
  path: string
  search?: string
  hash?: string
}

export interface ParseAppNavigationUrlInput {
  destination: AppDestinationKind
  path: string
  search: URLSearchParams
  hash: string
}

/**
 * The URL codec for one capability-owned application-navigation intent.
 *
 * The registry erases each intent's private input type only after its parser
 * and projector have been paired with the same typed intent token.
 */
export interface AppNavigationUrlContribution {
  intent: AppNavigationIntent<unknown, unknown>
  /** Returning `undefined` means this contribution did not match. */
  parse: (input: ParseAppNavigationUrlInput) => unknown
  format: (input: unknown) => AppNavigationUrlParts
}

export type AppDestination =
  | { type: 'index' }
  | { type: 'home'; libraryId?: string }
  | { type: 'project'; target: string }
  | { type: 'sign-in' }

export interface ParsedAppNavigationIntent {
  intent: AppNavigationIntent<unknown, unknown>
  input: unknown
}

/** The application intent represented by the URL at cold startup. */
export type InitialUrlIntent =
  | {
      type: 'launch'
      destination: AppDestination
      additionalIntents?: readonly ParsedAppNavigationIntent[]
      search: string
      hash: string
    }
  | {
      type: 'unrecognized'
      pathname: string
      search: string
      hash: string
    }

export interface TypedAppNavigationUrlContribution<Input> {
  parse: (input: ParseAppNavigationUrlInput) => Input | undefined
  format: (input: Input) => AppNavigationUrlParts
}

export const defineAppNavigationUrlContribution = <Input, Output>(
  intent: AppNavigationIntent<Input, Output>,
  contribution: TypedAppNavigationUrlContribution<Input>
): AppNavigationUrlContribution => ({
  intent,
  parse: contribution.parse,
  format: (input) => contribution.format(input as Input),
})

/**
 * Owns the application's URL representation, not application state changes.
 *
 * The service is constructed before React Router is mounted, so its public
 * values are non-nullable while `isReady` records whether the React Router
 * bridge has seeded an active runtime.
 */
export type AppUrlService = {
  location: ReadonlySignal<Location>
  isReady: ReadonlySignal<boolean>
  navigate: NavigateFunction
  readInitialUrl: (options?: {
    requestUrl?: string
    usesHashRouter?: boolean
  }) => InitialUrlIntent
  getLocation: () => Location
  setLocation: (location: Location) => void
  setNavigate: (navigate: NavigateFunction) => () => void
  seed: (values: AppUrlRuntimeValues) => () => void
  reset: () => void
}

export const appUrlContract = defineContract({
  appUrlService: defineService<AppUrlService>('application-url.service'),
  appNavigationUrlContributionsValueSpec:
    appendValueSpec<AppNavigationUrlContribution>(
      'application-navigation.url-contributions'
    ),
})

export const { appNavigationUrlContributionsValueSpec, appUrlService } =
  appUrlContract
