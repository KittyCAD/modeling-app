import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import { type Signal, signal } from '@preact/signals-core'
import {
  type AppLocation,
  locationSourcesValueSpec,
  type NavigationService,
  navigationService,
  urlRoutesValueSpec,
} from '@src/registry/contracts/navigation'
import navigationExtension from '@src/registry/extensions/navigation'
import { afterEach, describe, expect, test } from 'vitest'

/**
 * The service on its own: location derived from contributed sources, a path
 * serialised from it, and one inbound direction.
 *
 * Nothing here touches history — that is the bridge's job, and testing it here
 * would be testing a thing this file deliberately does not do.
 */

interface Harness {
  registry: Registry
  navigation: NavigationService
  projectLocation: Signal<AppLocation | null>
  /** Route ids that claimed a URL, in order, so ordering can be asserted. */
  loaded: string[]
}

function createHarness(): Harness {
  const projectLocation = signal<AppLocation | null>(null)
  const loaded: string[] = []

  const registry = new Registry()
  registry.configure([
    navigationExtension,
    defineRegistryItem({
      id: 'test.sources',
      provides: [
        // A feature-owned source, ahead of the catch-all.
        provide(locationSourcesValueSpec, {
          id: 'project',
          order: 0,
          location: projectLocation,
        }),
        provide(locationSourcesValueSpec, {
          id: 'home',
          order: 100,
          location: signal<AppLocation | null>({ kind: 'home' }),
        }),
        provide(urlRoutesValueSpec, {
          id: 'project',
          order: 0,
          toPath: (location) =>
            location.kind === 'project'
              ? `/file/${encodeURIComponent(location.projectPath)}${
                  location.overlay?.kind === 'settings' ? '/settings' : ''
                }`
              : null,
          load: (url) => {
            const match = url.pathname.match(/^\/file\/([^/]+)$/)
            if (!match) return false
            loaded.push(`project:${decodeURIComponent(match[1])}`)
            projectLocation.value = {
              kind: 'project',
              projectPath: decodeURIComponent(match[1]),
            }
            return true
          },
        }),
        provide(urlRoutesValueSpec, {
          id: 'home',
          order: 100,
          toPath: (location) => (location.kind === 'home' ? '/' : null),
          load: (url) => {
            if (url.pathname !== '/') return false
            loaded.push('home')
            projectLocation.value = null
            return true
          },
        }),
      ],
    }),
  ])

  return {
    registry,
    navigation: registry.get(navigationService),
    projectLocation,
    loaded,
  }
}

let harness: Harness | undefined

afterEach(() => {
  harness?.registry[Symbol.dispose]()
  harness = undefined
})

describe('deriving the location', () => {
  test('takes the first source that answers', () => {
    harness = createHarness()
    expect(harness.navigation.location.value).toEqual({ kind: 'home' })

    harness.projectLocation.value = {
      kind: 'project',
      projectPath: '/library/proj',
    }

    // The project source is ordered ahead of home, so it wins as soon as it
    // has an answer. Nothing was told to navigate.
    expect(harness.navigation.location.value).toEqual({
      kind: 'project',
      projectPath: '/library/proj',
    })
  })

  test('falls back to home when every source declines', () => {
    harness = createHarness()
    harness.projectLocation.value = {
      kind: 'project',
      projectPath: '/library/proj',
    }
    harness.projectLocation.value = null

    // Nothing is allowed to leave the app with no location at all.
    expect(harness.navigation.location.value).toEqual({ kind: 'home' })
  })
})

describe('serialising the location', () => {
  test('serialises through the first route that recognises it', () => {
    harness = createHarness()
    expect(harness.navigation.path.value).toBe('/')

    harness.projectLocation.value = {
      kind: 'project',
      projectPath: '/library/proj',
    }

    expect(harness.navigation.path.value).toBe(
      `/file/${encodeURIComponent('/library/proj')}`
    )
  })

  test('an overlay serialises over the place it sits on', () => {
    harness = createHarness()
    harness.projectLocation.value = {
      kind: 'project',
      projectPath: '/library/proj',
      overlay: { kind: 'settings' },
    }

    // The reason AppLocation needs an overlay axis at all: settings is *over* a
    // project, and the URL has to say which project.
    expect(harness.navigation.path.value).toBe(
      `/file/${encodeURIComponent('/library/proj')}/settings`
    )
  })
})

describe('opaque search parameters', () => {
  test('are appended to the derived path', () => {
    harness = createHarness()
    harness.navigation.setOpaqueSearch('pool=alpha')

    expect(harness.navigation.path.value).toBe('/?pool=alpha')
  })

  test('survive a change of location', () => {
    harness = createHarness()
    harness.navigation.setOpaqueSearch('pool=alpha')
    harness.projectLocation.value = {
      kind: 'project',
      projectPath: '/library/proj',
    }

    // Without this the first derived write would silently drop every parameter
    // the location union does not model.
    expect(harness.navigation.path.value).toBe(
      `/file/${encodeURIComponent('/library/proj')}?pool=alpha`
    )
  })

  test('are preserved character for character', () => {
    harness = createHarness()
    // The case the drift detector actually caught: `/` is legal unencoded in a
    // query value, and re-encoding it changes the URL for no reason.
    harness.navigation.setOpaqueSearch('sample=socket-head-cap-screw/main.kcl')

    expect(harness.navigation.path.value).toBe(
      '/?sample=socket-head-cap-screw/main.kcl'
    )
  })

  test('an empty set adds no question mark', () => {
    harness = createHarness()
    harness.navigation.setOpaqueSearch('')
    expect(harness.navigation.path.value).toBe('/')
  })
})

describe('applying an incoming URL', () => {
  test('applies it to state and reports the route that claimed it', async () => {
    harness = createHarness()

    const claimed = await harness.navigation.loadUrl(
      new URL(`http://localhost/file/${encodeURIComponent('/library/proj')}`)
    )

    expect(claimed).toBe('project')
    expect(harness.navigation.location.value).toEqual({
      kind: 'project',
      projectPath: '/library/proj',
    })
  })

  test('tries routes in order and stops at the first claim', async () => {
    harness = createHarness()

    await harness.navigation.loadUrl(new URL('http://localhost/'))

    expect(harness.loaded).toEqual(['home'])
  })

  test('reports an unclaimed URL rather than guessing', async () => {
    harness = createHarness()
    harness.projectLocation.value = {
      kind: 'project',
      projectPath: '/library/proj',
    }

    const claimed = await harness.navigation.loadUrl(
      new URL('http://localhost/nothing/here')
    )

    // State is untouched: an unknown URL cannot displace what the app is doing.
    expect(claimed).toBeNull()
    expect(harness.navigation.location.value).toEqual({
      kind: 'project',
      projectPath: '/library/proj',
    })
  })

  test('round-trips: a path loaded from a URL serialises back to itself', async () => {
    harness = createHarness()
    const path = `/file/${encodeURIComponent('/library/proj')}`

    await harness.navigation.loadUrl(new URL(`http://localhost${path}`))

    expect(harness.navigation.path.value).toBe(path)
  })
})
