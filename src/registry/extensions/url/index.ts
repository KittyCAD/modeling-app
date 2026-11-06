import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import { isErr } from '@src/lib/trap'
import {
  type ParsedUrlContribution,
  type UrlAdapter,
  type UrlContribution,
  type UrlQuery,
  urlContributionsValueSpec,
  urlService,
  type UrlRegistryService,
} from '@src/registry/contracts/url'

/**
 * Owns one startup snapshot and one publication effect for the contributions
 * present at start. No location subscription or React Router dependency.
 */
export function createUrlRegistryService(
  getContributions: () => readonly UrlContribution[]
) {
  const cancellation = new AbortController()
  let started: Promise<void> | undefined
  let stopPublication: (() => void) | undefined

  const dispose = () => {
    cancellation.abort()
    stopPublication?.()
    stopPublication = undefined
  }

  const initialize = async (adapter: UrlAdapter) => {
    if (cancellation.signal.aborted) {
      return Promise.reject(new Error('The URL system has been disposed.'))
    }
    const contributions = [...getContributions()]
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (const contribution of contributions) {
      if (ids.has(contribution.id)) {
        return Promise.reject(
          new Error(`Duplicate URL contribution: ${contribution.id}`)
        )
      }
      ids.add(contribution.id)
      for (const key of contribution.queryKeys) {
        if (keys.has(key)) {
          return Promise.reject(new Error(`Duplicate URL query key: ${key}`))
        }
        keys.add(key)
      }
    }

    const search = adapter.captureSearch()
    const parsed: ParsedUrlContribution[] = []
    for (const contribution of contributions) {
      // Parse every field before any initializer changes application state.
      const value = contribution.parse(new URLSearchParams(search))
      if (isErr(value)) return Promise.reject(value)
      if (value !== undefined) parsed.push(value)
    }
    await Promise.all(
      parsed.map((value) => value.initialize(cancellation.signal))
    )
    if (cancellation.signal.aborted) return

    const publishers = contributions.filter((item) => item.serialize)
    if (publishers.length === 0) return
    stopPublication = effect(() => {
      const query: Record<string, string | undefined> = Object.create(null)
      for (const contribution of publishers) {
        const values = contribution.serialize?.()
        for (const key of contribution.queryKeys) {
          query[key] = values?.[key]
        }
      }
      adapter.publish(query)
    })
  }

  const service: UrlRegistryService = {
    start: (adapter) => {
      started ??= initialize(adapter).catch((error: unknown) => {
        dispose()
        return Promise.reject(error)
      })
      return started
    },
  }
  return { service, dispose }
}

export const urlExtension = defineRegistryItemFactory((ctx) => {
  const { service, dispose } = createUrlRegistryService(() =>
    ctx.valueSpecs.get(urlContributionsValueSpec)
  )
  return {
    id: 'url-extension',
    providesServices: [provideService(urlService, service)],
    dispose,
  }
}, 'url-extension')

export default defineRegistryItem({
  id: 'url',
  uses: [urlExtension],
})

/**
 * Reads incoming query state only at capture. Publication merges into the
 * current transport URL to preserve paths and fields still owned by legacy
 * routing, without feeding that URL back into application initialization.
 */
export function createBrowserUrlAdapter(
  browser: {
    location: Pick<Location, 'href'>
    history: Pick<History, 'state' | 'replaceState'>
  },
  usesHashRouter: boolean
): UrlAdapter {
  const read = () => {
    const outer = new URL(browser.location.href)
    // A file: base retains Windows drive letters even for root-relative paths.
    // The hash is an app route, independent of the outer document's location.
    const route =
      usesHashRouter && outer.hash.startsWith('#/')
        ? new URL(outer.hash.slice(1), 'https://url-state.invalid')
        : outer
    return {
      /** The unchanged URL as read from the app. */
      outer,
      /** A unified version of the current URL that accounts for hash routing (used by Electron) */
      route,
    }
  }
  return {
    captureSearch: () => read().route.search,
    publish: (query: UrlQuery) => {
      const { outer, route } = read()
      const previous = outer.href
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) route.searchParams.delete(key)
        else route.searchParams.set(key, value)
      }
      if (route !== outer) {
        outer.hash = `${route.pathname}${route.search}${route.hash}`
      }
      if (outer.href !== previous) {
        browser.history.replaceState(browser.history.state, '', outer.href)
      }
    },
  }
}
