import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

/**
 * Where the app is, expressed in the app's own terms.
 *
 * Note what this is not: a path, a set of route params, or a match object. It
 * is a description of application state. The URL is one rendering of it.
 */
export type AppLocation =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string; filePath?: string }
  | { kind: 'settings'; section?: string }

/**
 * A candidate answer to "where is the app".
 *
 * Features contribute sources derived from their own state. The navigation
 * service takes the first source reporting a location, in order. Nothing
 * assigns the location imperatively, so the URL can never disagree with what
 * is on screen.
 */
export interface LocationSource {
  id: string
  /** Lower wins. */
  order?: number
  location: ReadonlySignal<AppLocation | null>
}

/**
 * A URL shape, in both directions.
 *
 * `toPath` is the authoritative direction: state produces a URL. `load` is the
 * nicety — it exists so that a pasted link, a reload, or a back button can
 * seed application state on the way in. After that it plays no part.
 */
export interface UrlRoute {
  id: string
  order?: number
  /** Return null when this route does not describe the given location. */
  toPath: (location: AppLocation) => string | null
  /**
   * Apply a URL to application state. Return false if the URL is not ours, so
   * the next route can try.
   */
  load: (url: URL) => boolean | Promise<boolean>
}

export interface NavigationService {
  /** Derived from application state. Read-only by construction. */
  readonly location: ReadonlySignal<AppLocation>
  /** The URL the current location serialises to. */
  readonly path: ReadonlySignal<string>
  /**
   * Apply an incoming URL, on boot or on a history pop.
   *
   * Resolves to the route that claimed it, or null when nothing matched — in
   * which case the app simply stays wherever its state already put it.
   */
  loadUrl(url: URL): Promise<string | null>
}

export const navigationContract = defineContract({
  locationSourcesValueSpec: appendValueSpec<LocationSource>(
    'navigation.locationSources'
  ),
  urlRoutesValueSpec: appendValueSpec<UrlRoute>('navigation.urlRoutes'),
  navigationService: defineService<NavigationService>('navigation.service'),
})

export const {
  locationSourcesValueSpec,
  urlRoutesValueSpec,
  navigationService,
} = navigationContract
