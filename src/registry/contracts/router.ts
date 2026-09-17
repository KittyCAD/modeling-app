import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Location, NavigateFunction } from 'react-router-dom'

export type RouterRuntimeValues = {
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
  parse: (input: ParseAppOverlayInput) => unknown | undefined
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

/** The application intent represented by the URL at cold startup. */
export type InitialUrlIntent =
  | {
      type: 'launch'
      destination: AppDestination
      overlay?: ParsedAppOverlay
      search: string
      hash: string
    }
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
 * Shared app routing service.
 *
 * The service is constructed before React Router is mounted, so its public
 * values are non-nullable while `isReady` records whether they have been seeded
 * from an active router runtime.
 */
export type RouterRegistryService = {
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
  seed: (values: RouterRuntimeValues) => () => void
  reset: () => void
}

export const routerContract = defineContract({
  routerService: defineService<RouterRegistryService>('router.service'),
  appOverlayContributionsValueSpec: appendValueSpec<AppOverlayContribution>(
    'application-overlays'
  ),
})

export const { appOverlayContributionsValueSpec, routerService } =
  routerContract
