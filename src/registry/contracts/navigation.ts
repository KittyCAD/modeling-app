import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

/**
 * Something shown *over* a place in the app rather than instead of it.
 *
 * This axis exists because the routes nest: `/settings`, `/onboarding/*` and
 * `/telemetry` all sit under `/file/:id`, under `/home` and under
 * `/library/:libraryId`. A flat union of peers cannot say "settings over which
 * project", and so cannot serialise back to the URL it came from.
 */
export type AppOverlay =
  | { kind: 'settings'; tab?: string }
  | { kind: 'onboarding'; step?: string }
  | { kind: 'telemetry' }

/**
 * Where the app is, expressed in the app's own terms.
 *
 * Note what this is not: a path, a set of route params, or a match object. It
 * is a description of application state. The URL is one rendering of it.
 */
export type AppLocation =
  | { kind: 'home'; overlay?: AppOverlay }
  /** The project index for one library. */
  | { kind: 'library'; libraryId: string; overlay?: AppOverlay }
  | {
      kind: 'project'
      /** Absolute path of the project root, which is what this app keys on. */
      projectPath: string
      filePath?: string
      overlay?: AppOverlay
    }
  | { kind: 'signin' }

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
 *
 * `toPath` must return a path only, never a query string. Query parameters are
 * the service's business, via `opaqueSearch`. Watch out for `PATHS.SETTINGS_USER`
 * and its siblings, which are named like paths but bake `?tab=` into the value.
 */
export interface UrlRoute {
  id: string
  order?: number
  /** Return null when this route does not describe the given location. */
  toPath: (location: AppLocation) => string | null
  /**
   * Apply a URL to application state. Return false if the URL is not ours, so
   * the next route can try.
   *
   * It must reconcile the URL *completely, absences included* — a project URL
   * with no file must clear the open file, not leave the previous one. Handling
   * only what is present is how Back ends up with the URL and the view
   * disagreeing.
   */
  load: (url: URL) => boolean | Promise<boolean>
}

export interface NavigationService {
  /** Derived from application state. Read-only by construction. */
  readonly location: ReadonlySignal<AppLocation>
  /** The URL the current location serialises to, including `opaqueSearch`. */
  readonly path: ReadonlySignal<string>
  /**
   * Query parameters that `AppLocation` does not model, carried verbatim.
   *
   * A path derived from a closed union cannot know about `?tab=`, `?sort_by=`,
   * `?cmd=`, `?pool=` and the rest, so without this the first derived write
   * would silently drop every one of them. It is a transitional mechanism, and
   * deliberately a single place to look: emptying it is how this migration
   * finishes, one parameter at a time.
   *
   * **A raw string, not `URLSearchParams`, and that distinction is load-bearing.**
   * Parsing and re-serialising is not lossless: `URLSearchParams.toString()`
   * percent-encodes characters that were legal unencoded, so
   * `?sample=a/main.kcl` comes back as `?sample=a%2Fmain.kcl`. Same value, but a
   * different URL — and this is the one thing here whose whole job is to be
   * passed through untouched. Opaque means uninterpreted.
   *
   * Excludes the leading `?`. Set through `setOpaqueSearch` rather than by
   * assignment: the registry re-exposes signal-valued service fields as readonly
   * on purpose, so a mutable surface has to be an explicit method.
   */
  readonly opaqueSearch: ReadonlySignal<string>
  /** Replace the carried query string wholesale. Exclude the leading `?`. */
  setOpaqueSearch(next: string): void
  /**
   * The URL fragment, carried verbatim, for the same reason as `opaqueSearch`.
   *
   * `AppLocation` does not model in-page anchors, and four call sites depend on
   * them: the native menu and the home screen open settings scrolled to
   * `libraries` or `defaultUnit`. Without this the derived write drops the
   * anchor, and "Changing modeling default unit" fails because settings opens
   * at the top.
   *
   * Excludes the leading marker, and is set through `setFragment` for the same
   * reason `opaqueSearch` is.
   */
  readonly fragment: ReadonlySignal<string>
  /** Replace the fragment wholesale. Exclude the leading marker. */
  setFragment(next: string): void
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
