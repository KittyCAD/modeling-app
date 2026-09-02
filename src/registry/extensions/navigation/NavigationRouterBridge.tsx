import { effect } from '@preact/signals-core'
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

  useEffect(() => {
    const router = app.registry.get(routerService)
    const navigation = app.registry.get(navigationService)

    let seeded = false
    let wrote = false
    let stopOutbound: (() => void) | undefined

    /**
     * Mirror the derived path into history.
     *
     * `replace` on the first write so a reload adds no history entry, `push`
     * afterwards so Back behaves, and nothing at all when the path already
     * matches — which is what stops a history pop from pushing the same entry
     * straight back.
     *
     * The current location is read with `peek`, deliberately. Subscribing to it
     * would make every navigation retrigger the write that caused it.
     */
    const startOutbound = () =>
      effect(() => {
        const next = navigation.path.value
        // Before React Router is mounted the router service falls back to
        // writing `window.history` itself, which is the one thing this must
        // not do.
        if (!router.isReady.peek()) return

        const current = router.getLocation()
        if (samePlace(next, `${current.pathname}${current.search}`)) {
          wrote = true
          return
        }

        if (wrote) {
          void router.navigate(next)
        } else {
          wrote = true
          void router.navigate(next, { replace: true })
        }
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
      if (!seeded) {
        seeded = true
        navigation.setOpaqueSearch(location.search.replace(/^\?/, ''))
      }

      /*
       * Started here rather than above so the first derived write already
       * carries the query string. Starting it before the search was seeded
       * would write a path stripped of every parameter the location union does
       * not model.
       */
      stopOutbound ??= startOutbound()

      const actual = `${location.pathname}${location.search}`
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
      stopOutbound?.()
    }
  }, [app])

  return null
}
