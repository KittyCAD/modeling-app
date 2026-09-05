import { useApp } from '@src/lib/boot'
import { navigationService } from '@src/registry/contracts/navigation'
import { useCallback } from 'react'
import type { SetURLSearchParams } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'

/**
 * `useSearchParams`, but the change is application state as well as a URL.
 *
 * Query parameters are the one part of the URL that `AppLocation` does not
 * model, so the navigation service carries them verbatim. That only works if
 * the app is told when they change. Otherwise the two disagree, and which one
 * wins is decided by whichever wrote last:
 *
 * - `setSearchParams` is a navigation, and React Router does not commit a
 *   navigation until its loader resolves. If that loader changes application
 *   state, the derived URL is recomputed from the parameters *still committed* —
 *   the ones being removed — and the write puts them straight back.
 * - Seeding the carried string from the URL on every location change has the
 *   same effect from the other direction: the app can set it, and the next
 *   commit overrules it.
 *
 * So writers use this instead. It still navigates, so nothing about the URL
 * changes today; it also records the intent, which is what makes a removal
 * survive.
 *
 * Reach for `useSearchParams` directly only where the parameters are read and
 * never written.
 */
export function useOwnedSearchParams(): [URLSearchParams, SetURLSearchParams] {
  const app = useApp()
  const [searchParams, setSearchParams] = useSearchParams()

  const setOwnedSearchParams = useCallback<SetURLSearchParams>(
    (nextInit, navigateOptions) => {
      // React Router accepts a value or an updater; resolve the updater the
      // same way it does so the recorded intent matches the URL it will write.
      const resolved =
        typeof nextInit === 'function' ? nextInit(searchParams) : nextInit
      const next = new URLSearchParams(
        resolved as ConstructorParameters<typeof URLSearchParams>[0]
      )

      app.registry.get(navigationService).setOpaqueSearch(next.toString())
      setSearchParams(nextInit, navigateOptions)
    },
    [app, searchParams, setSearchParams]
  )

  return [searchParams, setOwnedSearchParams]
}
