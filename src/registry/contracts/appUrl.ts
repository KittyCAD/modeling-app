import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Location, NavigateFunction } from 'react-router-dom'

export type AppUrlRuntimeValues = {
  location: Location
  navigate: NavigateFunction
}

export type AppDestinationKind = 'home' | 'project'

export interface AppOverlayUrlParts {
  path: string
  search?: string
  hash?: string
}

export interface ParseAppOverlayInput {
  destination: AppDestinationKind
  path: string
  search: URLSearchParams
  hash: string
}

/**
 * One capability-owned overlay that can be restored from and projected to a
 * URL. The registry erases each contribution's private state type only after
 * its parser and projector have been paired.
 */
export interface AppOverlayContribution {
  id: string
  /** Returning `undefined` means this contribution did not match. */
  parse: (input: ParseAppOverlayInput) => unknown
  format: (state: unknown) => AppOverlayUrlParts
}

export type AppDestination =
  | { type: 'index' }
  | { type: 'home'; libraryId?: string }
  | { type: 'project'; target: string }
  | { type: 'sign-in' }

export interface ParsedAppOverlay {
  contributionId: string
  state: unknown
}

/** URL-owned state that accompanies one application destination at startup. */
export interface AppUrlState {
  overlay?: ParsedAppOverlay
  search: string
  hash: string
}

export type AppUrlProjection = AppUrlState & {
  destination: AppDestination
}

/** The application intent represented by the URL at cold startup. */
export type InitialUrlIntent =
  | (AppUrlState & {
      type: 'launch'
      destination: AppDestination
    })
  | {
      type: 'unrecognized'
      pathname: string
      search: string
      hash: string
    }

export interface TypedAppOverlayContribution<State> {
  id: string
  parse: (input: ParseAppOverlayInput) => State | undefined
  format: (state: State) => AppOverlayUrlParts
}

export const defineAppOverlayContribution = <State>(
  contribution: TypedAppOverlayContribution<State>
): AppOverlayContribution => ({
  id: contribution.id,
  parse: contribution.parse,
  format: (state) => contribution.format(state as State),
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
  formatUrl: (projection: AppUrlProjection) => string
  getLocation: () => Location
  setLocation: (location: Location) => void
  setNavigate: (navigate: NavigateFunction) => () => void
  seed: (values: AppUrlRuntimeValues) => () => void
  reset: () => void
}

export const appUrlContract = defineContract({
  appUrlService: defineService<AppUrlService>('application-url.service'),
  appOverlayContributionsValueSpec: appendValueSpec<AppOverlayContribution>(
    'application-overlays'
  ),
})

export const { appOverlayContributionsValueSpec, appUrlService } =
  appUrlContract
