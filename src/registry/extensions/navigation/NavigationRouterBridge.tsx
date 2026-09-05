import { effect, signal } from '@preact/signals-core'
import { useApp } from '@src/lib/boot'
import { navigationService } from '@src/registry/contracts/navigation'
import { routerService } from '@src/registry/contracts/router'
import { samePlace } from '@src/registry/extensions/navigation/samePlace'
import { useEffect } from 'react'

export interface NavigationDriftRecord {
  /** What the app's own state says the URL should be. */
  derived: string
  /** What the URL actually is. */
  actual: string
}

declare global {
  interface Window {
    /** Drift observed this session, collected for the Playwright suite. */
    __navDrift?: NavigationDriftRecord[]
  }
}

/**
 * Watches the derived path disagree with the real URL, and says so.
 *
 * This is the whole point of landing the navigation model dark. Before anything
 * starts *writing* the URL from application state, we get to find out whether
 * the state can reproduce the URL the app already has — across the sixty-five
 * Playwright specs, in one run, at zero risk. Every disagreement is a place the
 * outbound flip would have silently moved the user.
 *
 * It only reports. Nothing here writes history or navigates, and the flip to a
 * hard CI failure happens in the branch that turns the outbound direction on.
 *
 * Outbound, the derived path is mirrored into history, so application state is
 * what determines the URL rather than the other way round. Everything goes
 * through `routerService.navigate` rather than `window.history`: React Router
 * still owns history, and a direct `pushState` emits no `popstate`, so the data
 * router would never learn about the write and the `useLocation` in eighteen
 * files would go stale. It also keeps hash-router-on-desktop versus
 * browser-router-on-web out of this file entirely.
 */
export function NavigationRouterBridge() {
  const app = useApp()

  useEffect(() => install(app), [app])

  return null
}

/**
 * Everything the bridge does, separated from the component so it can be tested
 * without a browser. Returns its own teardown.
 */
export function install(app: ReturnType<typeof useApp>) {
  {
    const router = app.registry.get(routerService)
    const navigation = app.registry.get(navigationService)

    /**
     * Whether the carried query string has been taken from the incoming URL
     * yet. A signal rather than a flag so the outbound effect can wait for it
     * without being created inside a subscriber.
     */
    const hasSeeded = signal(false)
    let wrote = false

    /**
     * Mirror the derived path into history.
     *
     * `replace` on the first write so a reload adds no history entry, `push`
     * afterwards so Back behaves, and nothing at all when the path already
     * matches — which is what stops a history pop from pushing the same entry
     * straight back.
     *
     * Three things here are load-bearing, and each was learned by breaking it:
     *
     * 1. The current location is read with `peek`. `getLocation()` looks
     *    equivalent and is not — it reads `location.value`, subscribing this
     *    effect to the signal its own `navigate` writes.
     * 2. The effect is created here, at install time, and not inside the
     *    location subscriber. Creating it there meant the first run happened
     *    *during* a `location` notification, so the `navigate` below wrote
     *    `location` from inside its own subscriber.
     * 3. The write itself is deferred to a microtask. Even reached legitimately,
     *    a synchronous `navigate` re-enters React Router's history from inside a
     *    signal update, and Preact throws `Cycle detected` — which, thrown from
     *    a React effect, takes the whole app down at startup. Desktop's hash
     *    router lands writes synchronously, so it fails there and not on web.
     */
    /**
     * The whole URL the router is currently showing, in the same shape the
     * derived path takes. Four places need this and they must agree, or the
     * writer and the drift report disagree about what "the same place" means.
     */
    const currentUrl = () => {
      const now = router.location.peek()
      return `${now.pathname}${now.search}${now.hash}`
    }

    const stopOutbound = effect(() => {
      if (!hasSeeded.value) return
      const next = navigation.path.value
      // Before React Router is mounted the router service falls back to
      // writing `window.history` itself, which is the one thing this must
      // not do.
      if (!router.isReady.value) return

      if (samePlace(next, currentUrl())) {
        wrote = true
        return
      }

      const replace = !wrote
      wrote = true
      queueMicrotask(() => {
        // Re-check: the URL may have caught up while this was queued.
        if (samePlace(next, currentUrl())) return
        void router.navigate(next, replace ? { replace: true } : undefined)
      })
    })

    const unsubscribe = router.location.subscribe((location) => {
      /*
       * Seeded once, on the way in, and never re-adopted.
       *
       * Re-reading it on every location change looks harmless and is not: the
       * app could set the carried parameters and the next commit would overrule
       * it, so a parameter could never be *removed*. Ownership has to sit on
       * one side, and this is the side that can express intent.
       *
       * Verbatim, with the leading '?' stripped: round-tripping through
       * URLSearchParams re-encodes characters that were legal unencoded.
       */
      if (!hasSeeded.peek()) {
        navigation.setOpaqueSearch(location.search.replace(/^\?/, ''))
        navigation.setFragment(location.hash.replace(/^#/, ''))
        // Flipped last, so the outbound effect's first run already sees the
        // carried query string. Without that ordering the first derived write
        // would be a path stripped of every parameter the union does not model.
        hasSeeded.value = true
      }

      const actual = `${location.pathname}${location.search}${location.hash}`
      const derived = navigation.path.peek()
      if (samePlace(derived, actual)) return

      // With the outbound direction live this should be unreachable: anything
      // that moves the URL without going through application state is a call
      // site the migration has not converted yet.
      window.__navDrift = window.__navDrift ?? []
      window.__navDrift.push({ derived, actual })
      console.error(
        `navigation drift: state serialises to "${derived}" but the URL is "${actual}"`
      )
    })

    return () => {
      unsubscribe()
      stopOutbound()
    }
  }
}
