import { computed, signal } from '@preact/signals-core'
import type { App } from '@src/lib/app'
import type { NavigationService } from '@src/registry/contracts/navigation'
import type { RouterRegistryService } from '@src/registry/contracts/router'
import { routerService } from '@src/registry/contracts/router'
import { install } from '@src/registry/extensions/navigation/NavigationRouterBridge'
import { describe, expect, test } from 'vitest'

/**
 * The bridge writes a signal it also has to read, so what it reads *with*
 * matters.
 *
 * Reading the location through `getLocation()` rather than `peek()` subscribed
 * the outbound effect to the location its own `navigate` writes. On desktop
 * that threw `Cycle detected` from inside a React effect, which took the app
 * down at startup and failed thirty-four e2e tests at 0ms.
 *
 * **Read this before trusting it:** these tests do *not* reproduce that cycle.
 * They pass either way — verified by reintroducing the reactive read. Preact
 * tolerates an effect writing a signal it depends on, by re-running it, and
 * this harness then converges on the second pass. The real failure needs
 * React's synchronous flush and the hash router, and only CI has shown it.
 *
 * What they do pin is the property the fix is *for*: one write per state
 * change, no runaway. That is worth having, and it is all that is claimed.
 */

function createHarness({
  synchronousNavigate,
}: {
  synchronousNavigate: boolean
}) {
  const location = signal({ pathname: '/home', search: '', hash: '' })
  const navigations: string[] = []

  const router = {
    location: computed(() => location.value),
    isReady: computed(() => true),
    navigate: (to: unknown) => {
      const path = String(to)
      navigations.push(path)
      const [pathname, search] = path.split(/(?=\?)/)
      const next = { pathname, search: search ?? '', hash: '' }
      if (synchronousNavigate) {
        location.value = next
      } else {
        queueMicrotask(() => {
          location.value = next
        })
      }
      return Promise.resolve()
    },
    getLocation: () => location.value,
  } as unknown as RouterRegistryService

  const derived = signal('/home')
  const opaqueSearch = signal('')
  const navigation = {
    location: computed(() => ({ kind: 'home' as const })),
    path: computed(() => derived.value),
    opaqueSearch: computed(() => opaqueSearch.value),
    setOpaqueSearch: (next: string) => {
      opaqueSearch.value = next
    },
    loadUrl: () => Promise.resolve(null),
  } as unknown as NavigationService

  const app = {
    registry: {
      get: (service: unknown) =>
        service === routerService ? router : navigation,
    },
  } as unknown as App

  return { app, derived, location, navigations }
}

describe('the navigation bridge', () => {
  test('writes once per state change, and settles', () => {
    const { app, derived, navigations } = createHarness({
      synchronousNavigate: true,
    })

    const teardown = install(app)
    try {
      derived.value = '/file/%2Fa%2Fmain.kcl'
      derived.value = '/file/%2Fb%2Fmain.kcl'

      // Two state changes, two writes. A location that is a dependency of the
      // effect rather than a `peek` is how this becomes a runaway.
      expect(navigations).toEqual([
        '/file/%2Fa%2Fmain.kcl',
        '/file/%2Fb%2Fmain.kcl',
      ])
    } finally {
      teardown?.()
    }
  })

  test('does not write when the URL already matches the state', () => {
    const { app, derived, navigations } = createHarness({
      synchronousNavigate: true,
    })

    const teardown = install(app)
    try {
      derived.value = '/home'
      // Nothing to do: this is what stops a history pop from pushing the same
      // entry straight back.
      expect(navigations).toEqual([])
    } finally {
      teardown?.()
    }
  })

  test('writes once when navigation lands asynchronously', async () => {
    const { app, derived, navigations } = createHarness({
      synchronousNavigate: false,
    })

    const teardown = install(app)
    try {
      derived.value = '/file/%2Fa%2Fmain.kcl'
      await Promise.resolve()
      expect(navigations).toEqual(['/file/%2Fa%2Fmain.kcl'])
    } finally {
      teardown?.()
    }
  })

  test('teardown can be called twice', () => {
    const { app } = createHarness({ synchronousNavigate: true })
    const teardown = install(app)
    teardown?.()
    expect(() => teardown?.()).not.toThrow()
  })
})
