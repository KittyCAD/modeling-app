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
 * **Read this before trusting it:** these tests do not reproduce that cycle.
 * Verified by reintroducing each fault in turn — they pass either way. Preact
 * tolerates an effect writing a signal it depends on by re-running it, and this
 * harness converges on the second pass. The real failure needs React Router's
 * history and the hash router's synchronous commit, and only CI has shown it.
 *
 * What they do pin are the properties the fixes are *for*: one write per state
 * change, no write when the URL already agrees, and — since the write is now
 * deferred precisely so it never lands inside a signal notification — that it
 * is asynchronous. That last one is the only mechanical guard against the
 * regression, so it is the one to keep.
 */

function createHarness({
  synchronousNavigate,
}: {
  synchronousNavigate: boolean
}) {
  const location = signal({ pathname: '/home', search: '', hash: '' })
  const navigations: string[] = []
  const parse = (path: string) => {
    const [beforeAnchor, anchor = ''] = path.split('#')
    const [pathname, search = ''] = beforeAnchor.split(/(?=\?)/)
    return {
      pathname,
      search,
      hash: anchor ? `#${anchor}` : '',
    }
  }

  const router = {
    location: computed(() => location.value),
    isReady: computed(() => true),
    navigate: (to: unknown) => {
      const path = String(to)
      navigations.push(path)
      const next = parse(path)
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
  const fragment = signal('')
  const navigation = {
    location: computed(() => ({ kind: 'home' as const })),
    path: computed(() => derived.value),
    opaqueSearch: computed(() => opaqueSearch.value),
    setOpaqueSearch: (next: string) => {
      opaqueSearch.value = next
    },
    fragment: computed(() => fragment.value),
    setFragment: (next: string) => {
      fragment.value = next
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
  test('never writes synchronously', () => {
    const { app, derived, navigations } = createHarness({
      synchronousNavigate: true,
    })

    const teardown = install(app)
    try {
      derived.value = '/file/%2Fa%2Fmain.kcl'

      // The whole point of deferring: a navigation must never land inside the
      // signal update that produced it. This is the one assertion here that
      // would fail if the deferral were removed.
      expect(navigations).toEqual([])
    } finally {
      teardown?.()
    }
  })

  test('writes once per state change, and settles', async () => {
    const { app, derived, navigations } = createHarness({
      synchronousNavigate: true,
    })

    const teardown = install(app)
    try {
      derived.value = '/file/%2Fa%2Fmain.kcl'
      await Promise.resolve()
      derived.value = '/file/%2Fb%2Fmain.kcl'
      await Promise.resolve()

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
      await Promise.resolve()
      expect(navigations).toEqual(['/file/%2Fa%2Fmain.kcl'])
    } finally {
      teardown?.()
    }
  })

  test('carries the fragment into the write', async () => {
    const { app, derived, navigations } = createHarness({
      synchronousNavigate: true,
    })

    const teardown = install(app)
    try {
      // The anchor is part of the place. Dropping it is how settings opens at
      // the top instead of scrolled to the setting the menu asked for.
      derived.value = '/home/settings?tab=user#defaultUnit'
      await Promise.resolve()
      expect(navigations).toEqual(['/home/settings?tab=user#defaultUnit'])
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
