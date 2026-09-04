import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import {
  type AppLocation,
  type AppOverlay,
  locationSourcesValueSpec,
  navigationService,
  urlRoutesValueSpec,
} from '@src/registry/contracts/navigation'

const HOME: AppLocation = { kind: 'home' }

/**
 * The router, inverted.
 *
 * Nothing here navigates. `location` is *derived* from application state by
 * asking each contributed source, in order, whether it recognises the current
 * state as its own. The URL is then a rendering of that answer.
 *
 * The consequence is that the URL cannot disagree with the screen: there is no
 * `navigate()` to forget to call, no route reachable without the state that
 * justifies it, and no loader reconstructing state the app already had.
 *
 * `loadUrl` is the one inbound path, used on boot and on a history pop. It
 * applies a URL to state and then gets out of the way. If no route claims the
 * URL, the app stays wherever its state already put it.
 *
 * Note what is deliberately *not* here: nothing writes to `window.history`.
 * React Router still owns history, and a direct `pushState` emits no
 * `popstate`, so the data router would never learn about it and the
 * `useLocation` in eighteen files would go stale. Mirroring the derived path
 * into history is the bridge's job, through the router service.
 */
export default defineRegistryItemFactory((ctx) => {
  const sources = computed(() =>
    [...ctx.valueSpecs.get(locationSourcesValueSpec)].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    )
  )

  const routes = computed(() =>
    [...ctx.valueSpecs.get(urlRoutesValueSpec)].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    )
  )

  const location = computed<AppLocation>(() => {
    for (const source of sources.value) {
      const candidate = source.location.value
      if (candidate) return candidate
    }
    // Nothing is allowed to leave the app with no location at all.
    return HOME
  })

  const opaqueSearch = signal('')
  const fragment = signal('')
  const overlay = signal<AppOverlay | undefined>(undefined)

  const path = computed(() => {
    const current = location.value
    let base = '/'
    for (const route of routes.value) {
      const candidate = route.toPath(current)
      if (candidate) {
        base = candidate
        break
      }
    }

    const search = opaqueSearch.value
    // `toPath` is contracted not to emit a query, but `PATHS.SETTINGS_USER` and
    // friends make that easy to get wrong, so joining correctly is cheaper than
    // producing a URL with two '?' in it.
    const withSearch = search
      ? `${base}${base.includes('?') ? '&' : '?'}${search}`
      : base

    const anchor = fragment.value
    return anchor ? `${withSearch}#${anchor}` : withSearch
  })

  const loadUrl = async (url: URL) => {
    for (const route of routes.value) {
      if (await route.load(url)) return route.id
    }
    return null
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'navigation',
      providesServices: [
        provideService(navigationService, {
          location,
          path,
          opaqueSearch,
          setOpaqueSearch: (next: string) => {
            opaqueSearch.value = next
          },
          fragment,
          setFragment: (next: string) => {
            fragment.value = next
          },
          overlay,
          setOverlay: (next: AppOverlay | undefined) => {
            overlay.value = next
          },
          openSettings: (options?: { tab?: string; anchor?: string }) => {
            overlay.value = { kind: 'settings' }
            opaqueSearch.value = options?.tab ? `tab=${options.tab}` : ''
            fragment.value = options?.anchor ?? ''
          },
          closeSettings: () => {
            overlay.value = undefined
            opaqueSearch.value = ''
            fragment.value = ''
          },
          loadUrl,
        }),
      ],
    }),
  }
}, 'navigation')
