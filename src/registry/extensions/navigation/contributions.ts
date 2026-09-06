import { defineRegistryItem, provide } from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import type { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import { resolveIndexTarget } from '@src/lib/routeInit'
import {
  type AppLocation,
  type AppOverlay,
  locationSourcesValueSpec,
  urlRoutesValueSpec,
} from '@src/registry/contracts/navigation'

/** The route's own segment only; anything after it is an overlay. */
const FILE_ROUTE = new RegExp(`^${PATHS.FILE}/([^/]+)`)
const LIBRARY_ROUTE = new RegExp(`^${PATHS.LIBRARY}/([^/]+)`)

/**
 * The contributed answer to "where is the app", and how each answer serialises.
 *
 * Sources and routes live together per location kind on purpose: the pair is
 * the thing that has to agree, and splitting them across two files is how a
 * `toPath` drifts from the state that produces it.
 *
 * Two of these are honest placeholders, and the drift detector exists partly to
 * measure how bad they are:
 *
 * - **overlay** — whether settings/onboarding/telemetry is showing is real UI
 *   state today, spread across `Settings.tsx`, the onboarding routes and three
 *   different URL mechanisms. Until those own it, the signal here is seeded
 *   from the URL.
 * - **library** — `/library/:libraryId` is read straight out of `useParams` by
 *   `Home.tsx` and has no application-state equivalent at all.
 *
 * Both become real in the slice that takes ownership of `?tab=` and the home
 * screen. Neither blocks measuring whether `toPath` reproduces today's URLs.
 *
 * **Taking `app` is temporary.** It is registered from `App` itself, which is a
 * thing this migration is meant to stop doing — features should contribute
 * themselves rather than be reached into. The coupling is kept to three
 * members (`projectSignal`, `openFile`, `closeProject`) precisely because those
 * are what `projectSession` will own; when it becomes a registry service the
 * extension resolves it through `ctx.services`, this function stops taking an
 * argument, and the registration in `app.ts` disappears.
 */
export function createNavigationContributions(app: App) {
  /**
   * Owned by `App` now, not seeded here. The location is still *derived* from
   * app state — this reads it, nothing assigns a location.
   */
  const overlay = app.overlaySignal
  /** URL-seeded placeholder. See the note above. */
  const libraryId = signal<string | undefined>(undefined)

  /**
   * These two functions are the only place the overlay's *path nesting* is
   * baked in, and they are the only place that changes when overlays move to
   * query parameters — which is the intended direction. `AppOverlay` itself is
   * an axis with no opinion about serialisation, so the model does not move
   * with it. That migration deliberately changes URLs, so it cannot ride inside
   * a slice whose safety argument is that the URLs did not.
   *
   * An onboarding step is itself a path (`desktop/conclusion`), so its
   * separators stay structural while everything else is encoded. Encoding the
   * whole thing would turn today's URLs into `desktop%2Fconclusion`.
   */
  const encodeStep = (step: string) =>
    encodeURIComponent(step).replace(/%2F/g, '/')

  const overlaySuffix = (current: AppOverlay | undefined) => {
    if (!current) return ''
    if (current.kind === 'settings') return PATHS.SETTINGS
    if (current.kind === 'telemetry') return PATHS.TELEMETRY
    return current.step
      ? `${PATHS.ONBOARDING}/${encodeStep(current.step)}`
      : PATHS.ONBOARDING
  }

  const parseOverlay = (pathname: string): AppOverlay | undefined => {
    // Onboarding is checked first because its step is an arbitrary path, so a
    // step could itself end in `/settings` and be misread as one.
    const onboarding = pathname.indexOf(`${PATHS.ONBOARDING}/`)
    if (onboarding !== -1) {
      return {
        kind: 'onboarding',
        step: decodeURIComponent(
          pathname.slice(onboarding + PATHS.ONBOARDING.length + 1)
        ),
      }
    }
    if (pathname.endsWith(PATHS.ONBOARDING)) return { kind: 'onboarding' }
    if (pathname.endsWith(PATHS.SETTINGS)) return { kind: 'settings' }
    if (pathname.endsWith(PATHS.TELEMETRY)) return { kind: 'telemetry' }
    return undefined
  }

  /**
   * A project is open, so that is where the app is.
   *
   * The file comes from the executing path rather than from the URL, which is
   * the whole point: `useAbsoluteFilePath` already builds this exact URL from
   * this exact signal, so the app has been able to answer this question all
   * along without asking the router.
   */
  const projectLocation = computed<AppLocation | null>(() => {
    const project = app.projectSignal.value
    if (!project) return null
    return {
      kind: 'project',
      projectPath: project.projectIORefSignal.value.path,
      filePath: project.executingPathSignal.value?.value,
      overlay: overlay.value,
    }
  })

  const libraryLocation = computed<AppLocation | null>(() => {
    const id = libraryId.value
    if (!id) return null
    return { kind: 'library', libraryId: id, overlay: overlay.value }
  })

  const homeLocation = computed<AppLocation | null>(() => ({
    kind: 'home',
    overlay: overlay.value,
  }))

  return defineRegistryItem({
    id: 'navigation.contributions',
    provides: [
      // Lower order wins. A project beats a library beats the home fallback.
      provide(locationSourcesValueSpec, {
        id: 'project',
        order: 0,
        location: projectLocation,
      }),
      provide(locationSourcesValueSpec, {
        id: 'library',
        order: 10,
        location: libraryLocation,
      }),
      provide(locationSourcesValueSpec, {
        id: 'home',
        order: 100,
        location: homeLocation,
      }),

      provide(urlRoutesValueSpec, {
        id: 'project',
        order: 0,
        toPath: (location) =>
          location.kind === 'project'
            ? `${PATHS.FILE}/${encodeURIComponent(
                location.filePath ?? location.projectPath
              )}${overlaySuffix(location.overlay)}`
            : null,
        load: async (url) => {
          const match = FILE_ROUTE.exec(url.pathname)
          const encodedId = match?.[1]
          if (!encodedId) return false
          app.setOverlay(parseOverlay(url.pathname))
          libraryId.value = undefined
          await app.openFile({ id: decodeURIComponent(encodedId) })
          return true
        },
      }),
      provide(urlRoutesValueSpec, {
        id: 'library',
        order: 10,
        toPath: (location) =>
          location.kind === 'library'
            ? `${PATHS.LIBRARY}/${location.libraryId}${overlaySuffix(location.overlay)}`
            : null,
        load: (url) => {
          const id = LIBRARY_ROUTE.exec(url.pathname)?.[1]
          if (!id) return false
          app.setOverlay(parseOverlay(url.pathname))
          libraryId.value = id
          app.closeProject()
          return true
        },
      }),
      /**
       * `/` is a funnel, not a place, so it has no `toPath`: no application
       * state ever serialises back to it. It only claims the URL on the way in,
       * and what it claims it resolves into state — desktop and flagged web to
       * the project list, unflagged web to the one project it may have.
       *
       * `?ask-open-desktop` is declined rather than claimed, because
       * `OpenInDesktopAppHandler` owns that decision and this must not move the
       * app out from under it.
       */
      provide(urlRoutesValueSpec, {
        id: 'index',
        order: 50,
        toPath: () => null,
        load: async (url) => {
          if (url.pathname !== PATHS.INDEX) return false

          const target = await resolveIndexTarget(app, {
            requestUrl: url.href,
          })
          if (target.kind === 'defer') return false

          app.setOverlay(undefined)
          libraryId.value = undefined

          if (target.kind === 'home') {
            app.closeProject()
            return true
          }

          await app.openFile({ id: target.filePath })
          return true
        },
      }),
      provide(urlRoutesValueSpec, {
        id: 'home',
        order: 100,
        toPath: (location) =>
          location.kind === 'home'
            ? `${PATHS.HOME}${overlaySuffix(location.overlay)}`
            : null,
        load: (url) => {
          if (!url.pathname.startsWith(PATHS.HOME)) return false
          app.setOverlay(parseOverlay(url.pathname))
          libraryId.value = undefined
          app.closeProject()
          return true
        },
      }),
    ],
  })
}
