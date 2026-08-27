import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import {
  type AppLocation,
  locationSourcesValueSpec,
  navigationService,
  urlRoutesValueSpec,
} from '@src/contracts/navigation'

const HOME: AppLocation = { kind: 'home' }

/**
 * The router, inverted.
 *
 * Nothing here navigates. `location` is *derived* from application state by
 * asking each contributed source, in order, whether it recognises the current
 * state as its own. The URL is then a rendering of that answer, written to
 * history by an effect.
 *
 * The consequence is that the URL can never disagree with the screen. There is
 * no navigate() to forget to call, no route that can be entered without the
 * state that justifies it, and no loader that has to reconstruct state the app
 * already had.
 *
 * `loadUrl` is the one inbound path, used on boot and on a history pop. It
 * applies a URL to state and then gets out of the way. If no route claims the
 * URL, the app simply stays wherever its state already put it.
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
    return HOME
  })

  const path = computed(() => {
    const current = location.value
    for (const route of routes.value) {
      const candidate = route.toPath(current)
      if (candidate) return candidate
    }
    return '/'
  })

  const loadUrl = async (url: URL) => {
    for (const route of routes.value) {
      if (await route.load(url)) return route.id
    }
    return null
  }

  /**
   * Mirror the derived path into history.
   *
   * `replaceState` on the first run so a reload does not add an entry, and
   * `pushState` afterwards so Back means what a user expects. Writes are
   * skipped when the path already matches, which stops a history pop from
   * immediately pushing the same entry back.
   *
   * Started in a microtask, not inline. An effect runs its body the moment it
   * is created, and this body reads value specs — which would mean reading the
   * registry graph while that graph is still being flattened. Deferring by one
   * tick puts the first read safely after construction.
   */
  let seeded = false
  let stopSync: (() => void) | null = null
  let disposed = false

  queueMicrotask(() => {
    if (disposed) return
    stopSync = effect(() => {
      const next = path.value
      const currentUrl = `${window.location.pathname}${window.location.search}`
      if (next === currentUrl) {
        seeded = true
        return
      }
      if (seeded) {
        window.history.pushState(null, '', next)
      } else {
        window.history.replaceState(null, '', next)
        seeded = true
      }
    })
  })

  const onPopState = () => {
    void loadUrl(new URL(window.location.href))
  }
  window.addEventListener('popstate', onPopState)

  return {
    item: defineRuntimeRegistryItem({
      id: 'navigation',
      dispose: () => {
        disposed = true
        stopSync?.()
        window.removeEventListener('popstate', onPopState)
      },
      providesServices: [
        provideService(navigationService, { location, path, loadUrl }),
      ],
    }),
  }
}, 'navigation')
