import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import {
  type NavigationService,
  navigationService,
} from '@src/registry/contracts/navigation'
import navigationExtension from '@src/registry/extensions/navigation'
import { createNavigationContributions } from '@src/registry/extensions/navigation/contributions'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'

/**
 * The property the whole inversion rests on: a URL loaded into application
 * state has to serialise back to the URL it came from.
 *
 * If that is not an identity, then reload and Back silently move the user —
 * the app ends up somewhere the URL does not describe, or the URL bar ends up
 * describing somewhere the app is not. Example-based tests cover three or four
 * shapes; the real space is every location kind times four overlay states
 * times arbitrary project and file paths, and the failures live in the
 * combinations rather than in any single case.
 *
 * Written against the *real* contributed routes, not a harness, so it is the
 * shipped `toPath`/`load` pair being checked.
 */

/**
 * An app that only does what these routes ask of it: remember which project is
 * open. `openFile` echoes the id back as both the project path and the
 * executing file, which is what closes the round trip.
 */
function createFakeApp() {
  const projectSignal = signal<unknown>(undefined)
  return {
    projectSignal,
    openFile: ({ id }: { id: string | undefined }) => {
      projectSignal.value = {
        projectIORefSignal: { value: { path: id } },
        executingPathSignal: { value: { value: id } },
      }
      return Promise.resolve({ kind: 'opened' as const })
    },
    closeProject: () => {
      projectSignal.value = undefined
    },
  } as unknown as App
}

function createNavigation(): NavigationService {
  const registry = new Registry()
  registry.configure([
    navigationExtension,
    createNavigationContributions(createFakeApp()),
  ])
  return registry.get(navigationService)
}

/** Path-ish text that still exercises percent-encoding. */
const segment = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.trim().length > 0)

const absolutePath = fc
  .array(segment, { minLength: 1, maxLength: 4 })
  .map((parts) => parts.reduce((path, part) => `${path}/${part}`, ''))

/**
 * Onboarding steps are slugs in reality — `desktop/conclusion` — and unlike a
 * project path they are not percent-encoded as a unit, because their separators
 * are structural. Generating arbitrary text here would only assert that this
 * test and the implementation encode identically, which is not a property worth
 * having. The arbitrary input that matters is the project and file paths, and
 * those stay unconstrained below.
 */
const stepSlug = fc.constantFrom(
  'desktop',
  'web',
  'intro',
  'conclusion',
  'step-1',
  'a.b',
  'desktop/conclusion'
)

const overlaySuffixArb = fc.oneof(
  fc.constant(''),
  fc.constant(PATHS.SETTINGS),
  fc.constant(PATHS.TELEMETRY),
  fc.constant(PATHS.ONBOARDING),
  stepSlug.map((step) => `${PATHS.ONBOARDING}/${step}`)
)

const projectUrl = fc
  .tuple(absolutePath, overlaySuffixArb)
  .map(
    ([path, overlay]) => `${PATHS.FILE}/${encodeURIComponent(path)}${overlay}`
  )

const libraryUrl = fc
  .tuple(absolutePath, overlaySuffixArb)
  .map(
    ([id, overlay]) => `${PATHS.LIBRARY}/${encodeURIComponent(id)}${overlay}`
  )

const homeUrl = overlaySuffixArb.map((overlay) => `${PATHS.HOME}${overlay}`)

describe('URL round-tripping', () => {
  test('a project URL serialises back to itself', async () => {
    await fc.assert(
      fc.asyncProperty(projectUrl, async (path) => {
        const navigation = createNavigation()
        await navigation.loadUrl(new URL(`http://localhost${path}`))
        expect(navigation.path.value).toBe(path)
      }),
      { numRuns: 300 }
    )
  })

  test('a library URL serialises back to itself', async () => {
    await fc.assert(
      fc.asyncProperty(libraryUrl, async (path) => {
        const navigation = createNavigation()
        await navigation.loadUrl(new URL(`http://localhost${path}`))
        expect(navigation.path.value).toBe(path)
      }),
      { numRuns: 300 }
    )
  })

  test('a home URL serialises back to itself', async () => {
    await fc.assert(
      fc.asyncProperty(homeUrl, async (path) => {
        const navigation = createNavigation()
        await navigation.loadUrl(new URL(`http://localhost${path}`))
        expect(navigation.path.value).toBe(path)
      }),
      { numRuns: 300 }
    )
  })

  test('loading is idempotent: loading the derived path again changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(projectUrl, libraryUrl, homeUrl),
        async (path) => {
          const navigation = createNavigation()
          await navigation.loadUrl(new URL(`http://localhost${path}`))
          const once = navigation.path.value
          await navigation.loadUrl(new URL(`http://localhost${once}`))
          // A history pop replays a URL the app may already be at. If that were
          // not a fixed point, Back could walk the app somewhere new.
          expect(navigation.path.value).toBe(once)
        }
      ),
      { numRuns: 200 }
    )
  })
})

/**
 * Query strings as they actually appear, including characters that are legal
 * unencoded in a query value and therefore must not be re-encoded. `/` is the
 * one the drift detector caught in the real suite.
 */
const rawQueryString = fc
  .array(
    fc.tuple(
      fc.constantFrom('cmd', 'groupId', 'sample', 'source', 'pool', 'tab'),
      fc.constantFrom(
        'alpha',
        'a/main.kcl',
        'socket-head-cap-screw/main.kcl',
        'kcl-samples',
        'x.y-z',
        '1'
      )
    ),
    { minLength: 1, maxLength: 4 }
  )
  .map((pairs) =>
    pairs
      .map(([k, v]) => `${k}=${v}`)
      .reduce((acc, part) => (acc ? `${acc}&${part}` : part), '')
  )

describe('opaque search parameters', () => {
  test('are carried through character for character', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(projectUrl, libraryUrl, homeUrl),
        rawQueryString,
        async (path, search) => {
          const navigation = createNavigation()
          await navigation.loadUrl(new URL(`http://localhost${path}`))
          navigation.setOpaqueSearch(search)

          // Verbatim, not merely equivalent. Parsing and re-serialising through
          // URLSearchParams turns `sample=a/main.kcl` into `sample=a%2Fmain.kcl`
          // — the same value, a different URL, and this is the one thing whose
          // whole job is to pass through untouched.
          expect(navigation.path.value).toBe(`${path}?${search}`)
        }
      ),
      { numRuns: 300 }
    )
  })

  test('an empty query string adds no question mark', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(projectUrl, libraryUrl, homeUrl),
        async (path) => {
          const navigation = createNavigation()
          await navigation.loadUrl(new URL(`http://localhost${path}`))
          navigation.setOpaqueSearch('')
          expect(navigation.path.value).toBe(path)
        }
      ),
      { numRuns: 100 }
    )
  })
})
