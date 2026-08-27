import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import { type Signal, signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type AppLocation,
  type NavigationService,
  locationSourcesValueSpec,
  navigationService,
  urlRoutesValueSpec,
} from '@src/contracts/navigation'
import navigationFeature from '@src/features/navigation'

/** Let the feature's deferred history-sync effect start. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

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
    navigationFeature,
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
              ? `/project/${location.projectId}`
              : null,
          load: (url) => {
            const match = url.pathname.match(/^\/project\/([^/]+)$/)
            if (!match) return false
            loaded.push(`project:${match[1]}`)
            projectLocation.value = {
              kind: 'project',
              projectId: match[1],
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

describe('navigation', () => {
  let harness: Harness

  beforeEach(async () => {
    window.history.replaceState(null, '', '/')
    harness = createHarness()
    await settle()
  })

  afterEach(() => {
    harness.registry[Symbol.dispose]()
  })

  it('derives the location from state, taking the first source that answers', () => {
    expect(harness.navigation.location.value).toEqual({ kind: 'home' })

    harness.projectLocation.value = {
      kind: 'project',
      projectId: 'local:bracket',
    }
    expect(harness.navigation.location.value).toEqual({
      kind: 'project',
      projectId: 'local:bracket',
    })
  })

  it('falls back to home when every source declines', () => {
    // Nothing is allowed to leave the app with no location at all.
    expect(harness.navigation.location.value.kind).toBe('home')
  })

  it('serialises the derived location to a path', () => {
    expect(harness.navigation.path.value).toBe('/')

    harness.projectLocation.value = {
      kind: 'project',
      projectId: 'local:bracket',
    }
    expect(harness.navigation.path.value).toBe('/project/local:bracket')
  })

  it('writes the derived path into history when state changes', async () => {
    harness.projectLocation.value = {
      kind: 'project',
      projectId: 'local:bracket',
    }
    await settle()

    // The URL is an output. Nothing called navigate().
    expect(window.location.pathname).toBe('/project/local:bracket')
  })

  it('does not push an entry when the path already matches', async () => {
    const before = window.history.length
    harness.projectLocation.value = null
    await settle()
    expect(window.history.length).toBe(before)
  })

  it('applies an incoming URL to state and reports the route that claimed it', async () => {
    const claimed = await harness.navigation.loadUrl(
      new URL('http://localhost/project/local:enclosure')
    )

    expect(claimed).toBe('project')
    expect(harness.loaded).toContain('project:local:enclosure')
    expect(harness.navigation.location.value).toEqual({
      kind: 'project',
      projectId: 'local:enclosure',
    })
  })

  it('tries routes in order and stops at the first claim', async () => {
    await harness.navigation.loadUrl(new URL('http://localhost/'))
    expect(harness.loaded).toEqual(['home'])
  })

  it('reports an unclaimed URL rather than guessing', async () => {
    harness.projectLocation.value = {
      kind: 'project',
      projectId: 'local:bracket',
    }

    const claimed = await harness.navigation.loadUrl(
      new URL('http://localhost/nonsense/deep')
    )

    expect(claimed).toBeNull()
    // State is untouched: an unknown URL cannot displace what the app is doing.
    expect(harness.navigation.location.value).toEqual({
      kind: 'project',
      projectId: 'local:bracket',
    })
  })

  it('round-trips: a path loaded from a URL serialises back to itself', async () => {
    await harness.navigation.loadUrl(
      new URL('http://localhost/project/local:enclosure')
    )
    expect(harness.navigation.path.value).toBe('/project/local:enclosure')
  })

  it('stops syncing history once disposed', async () => {
    harness.registry[Symbol.dispose]()
    const pathBefore = window.location.pathname

    harness.projectLocation.value = {
      kind: 'project',
      projectId: 'local:bracket',
    }
    await settle()

    expect(window.location.pathname).toBe(pathBefore)
  })
})
