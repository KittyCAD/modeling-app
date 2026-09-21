import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  type AppNavigationUrlContribution,
  type AppUrlRuntimeValues,
  type AppUrlService,
  appNavigationUrlContributionsValueSpec,
  appUrlService,
} from '@src/registry/contracts/appUrl'
import {
  createPath,
  type Location,
  type NavigateFunction,
  type NavigateOptions,
  type To,
} from 'react-router-dom'
import { formatAppUrl, parseInitialUrl } from './initialUrl'

const initialLocation: Location = {
  pathname: '/',
  search: '',
  hash: '',
  state: null,
  key: 'default',
}

const isReactRouterHistoryState = (
  historyState: unknown
): historyState is { usr: unknown; key?: unknown } =>
  Boolean(
    historyState &&
      typeof historyState === 'object' &&
      'usr' in historyState &&
      'key' in historyState
  )

const readHistoryStateValue = (historyState: unknown) => {
  if (isReactRouterHistoryState(historyState)) {
    return historyState.usr
  }

  return historyState ?? null
}

const readHistoryStateKey = (historyState: unknown) => {
  if (
    isReactRouterHistoryState(historyState) &&
    typeof historyState.key === 'string'
  ) {
    return historyState.key
  }

  return initialLocation.key
}

const readBrowserLocation = (): Location => {
  if (typeof window === 'undefined') {
    return initialLocation
  }

  return {
    pathname: window.location.pathname || initialLocation.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: readHistoryStateValue(window.history.state),
    key: readHistoryStateKey(window.history.state),
  }
}

const createUnseededNavigate =
  (syncLocation: () => void): NavigateFunction =>
  (toOrDelta: To | number, options?: NavigateOptions) => {
    if (typeof window === 'undefined') {
      return
    }

    if (typeof toOrDelta === 'number') {
      window.history.go(toOrDelta)
      syncLocation()
      return
    }

    const path =
      typeof toOrDelta === 'string' ? toOrDelta : createPath(toOrDelta)
    const browserPath =
      window.electron && path.startsWith('/') ? `#${path}` : path

    try {
      if (options?.replace) {
        window.history.replaceState(options.state ?? null, '', browserPath)
      } else {
        window.history.pushState(options?.state ?? null, '', browserPath)
      }
      syncLocation()
    } catch {
      if (options?.replace) {
        window.location.replace(browserPath)
      } else {
        window.location.assign(browserPath)
      }
    }
  }

export const createAppUrlService = ({
  getNavigationIntents = () => [],
}: {
  getNavigationIntents?: () => readonly AppNavigationUrlContribution[]
} = {}): AppUrlService => {
  const location = signal<Location>(readBrowserLocation())
  const isReady = signal(false)
  const syncBrowserLocation = () => {
    location.value = readBrowserLocation()
  }
  let activeNavigate = createUnseededNavigate(syncBrowserLocation)
  let preloadedNavigationIntents:
    | readonly AppNavigationUrlContribution[]
    | undefined
  /**
   * Freeze startup-time URL codecs on first use. Runtime extension changes take
   * effect after an application restart instead of racing initial URL parsing.
   */
  const getPreloadedNavigationIntents = () => {
    preloadedNavigationIntents ??= [...getNavigationIntents()]
    return preloadedNavigationIntents
  }

  const navigate: NavigateFunction = (
    toOrDelta: To | number,
    options?: NavigateOptions
  ) => {
    if (typeof toOrDelta === 'number') {
      return activeNavigate(toOrDelta)
    }

    return activeNavigate(toOrDelta, options)
  }

  const resetNavigate = (navigateToReset: NavigateFunction) => {
    if (activeNavigate !== navigateToReset) {
      return
    }

    activeNavigate = createUnseededNavigate(syncBrowserLocation)
    syncBrowserLocation()
    isReady.value = false
  }

  const serviceImpl: AppUrlService = {
    location,
    isReady,
    navigate,
    readInitialUrl: ({
      requestUrl = window.location.href,
      usesHashRouter = Boolean(window.electron),
    } = {}) =>
      parseInitialUrl(requestUrl, {
        navigationIntents: getPreloadedNavigationIntents(),
        usesHashRouter,
      }),
    formatUrl: (projection) =>
      formatAppUrl(projection, getPreloadedNavigationIntents()),
    getLocation: () => location.value,
    setLocation: (nextLocation) => {
      location.value = nextLocation
    },
    setNavigate: (nextNavigate) => {
      activeNavigate = nextNavigate
      isReady.value = true

      return () => resetNavigate(nextNavigate)
    },
    seed: (values: AppUrlRuntimeValues) => {
      serviceImpl.setLocation(values.location)
      return serviceImpl.setNavigate(values.navigate)
    },
    reset: () => {
      syncBrowserLocation()
      activeNavigate = createUnseededNavigate(syncBrowserLocation)
      isReady.value = false
    },
  }

  return serviceImpl
}

export const routerExtension = defineRegistryItemFactory((ctx) => {
  const serviceImpl = createAppUrlService({
    getNavigationIntents: () =>
      ctx.valueSpecs.get(appNavigationUrlContributionsValueSpec),
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'router-extension',
      providesServices: [provideService(appUrlService, serviceImpl)],
      dispose: serviceImpl.reset,
    }),
  }
}, 'router-extension')

export default defineRegistryItem({
  id: 'router',
  uses: [routerExtension],
})
