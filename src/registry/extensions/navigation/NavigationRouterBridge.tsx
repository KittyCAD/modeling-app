import { useApp } from '@src/lib/boot'
import { navigationService } from '@src/registry/contracts/navigation'
import { routerService } from '@src/registry/contracts/router'
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
 * `opaqueSearch` is kept in step with the real query string here, because while
 * the URL is still authoritative that *is* where those parameters live. So drift
 * measures the path, which is the part the location union is responsible for.
 */
export function NavigationRouterBridge() {
  const app = useApp()

  useEffect(() => {
    const router = app.registry.get(routerService)
    const navigation = app.registry.get(navigationService)

    return router.location.subscribe((location) => {
      const incoming = new URLSearchParams(location.search)
      if (incoming.toString() !== navigation.opaqueSearch.peek().toString()) {
        navigation.setOpaqueSearch(incoming)
      }

      const actual = `${location.pathname}${location.search}`
      const derived = navigation.path.peek()
      if (derived === actual) return

      const record = { derived, actual }
      window.__navDrift = window.__navDrift ?? []
      window.__navDrift.push(record)
      console.error(
        `navigation drift: state serialises to "${derived}" but the URL is "${actual}"`
      )
    })
  }, [app])

  return null
}
