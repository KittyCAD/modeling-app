import { defineRegistryItem, provide } from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import type { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
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
  /** URL-seeded placeholder. See the note above. */
  const overlay = signal<AppOverlay | undefined>(undefined)
  /** URL-seeded placeholder. See the note above. */
  const libraryId = signal<string | undefined>(undefined)

  const overlaySuffix = (current: AppOverlay | undefined) => {
    if (!current) return ''
    if (current.kind === 'settings') return PATHS.SETTINGS
    if (current.kind === 'telemetry') return PATHS.TELEMETRY
    return current.step
      ? `${PATHS.ONBOARDING}/${current.step}`
      : PATHS.ONBOARDING
  }

  const parseOverlay = (pathname: string): AppOverlay | undefined => {
    if (pathname.endsWith(PATHS.SETTINGS)) return { kind: 'settings' }
    if (pathname.endsWith(PATHS.TELEMETRY)) return { kind: 'telemetry' }
    const onboarding = pathname.indexOf(`${PATHS.ONBOARDING}/`)
    if (onboarding !== -1) {
      return {
        kind: 'onboarding',
        step: pathname.slice(onboarding + PATHS.ONBOARDING.length + 1),
      }
    }
    if (pathname.endsWith(PATHS.ONBOARDING)) return { kind: 'onboarding' }
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
          overlay.value = parseOverlay(url.pathname)
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
          overlay.value = parseOverlay(url.pathname)
          libraryId.value = id
          app.closeProject()
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
          overlay.value = parseOverlay(url.pathname)
          libraryId.value = undefined
          app.closeProject()
          return true
        },
      }),
    ],
  })
}
