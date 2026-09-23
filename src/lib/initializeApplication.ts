import type { App } from '@src/lib/app'
import { parseLaunchRequest } from '@src/lib/launchRequest'
import {
  initFileRoute,
  initHomeRoute,
  initIndexRoute,
  type RouteInitResult,
} from '@src/lib/routeInit'
import type { FileLoaderData, HomeLoaderData } from '@src/lib/types'
import {
  type AppDestination,
  type AppUrlState,
  appUrlService,
  type InitialUrlIntent,
} from '@src/registry/contracts/appUrl'
import { appLaunchService } from '@src/registry/contracts/appLaunch'
import type { AppNavigationService } from '@src/registry/contracts/appNavigation'

const MAX_INITIAL_TRANSITIONS = 8

type InitialResult = RouteInitResult<
  undefined | FileLoaderData | HomeLoaderData
>

/**
 * Restore application state from the URL once, before React is mounted.
 *
 * Startup transitions carry typed application destinations rather than URL
 * strings. They are followed directly, then their canonical URL is projected
 * only after the resulting application state has been established.
 */
export async function initializeApplication(
  app: App,
  {
    requestUrl = window.location.href,
    usesHashRouter = Boolean(window.electron),
  }: {
    requestUrl?: string
    usesHashRouter?: boolean
  } = {}
): Promise<void> {
  const appUrl = app.registry.get(appUrlService)
  const intent = appUrl.readInitialUrl({ requestUrl, usesHashRouter })
  if (intent.type === 'unrecognized') {
    return
  }

  const { request, remainingSearch } = parseLaunchRequest(intent.search)
  if (request) {
    // Keep the transferable URL through full-page authentication and the
    // desktop choice. Only the launch owner consumes its one-shot parameters.
    // Some commands register when their React view mounts. Acceptance owns the
    // continuation, but must not block mounting that view or the sign-in UI.
    void app.registry.get(appLaunchService).accept({
      destination: intent.destination,
      urlState: {
        overlay: intent.overlay,
        search: intent.search,
        hash: intent.hash,
      },
      request,
      remainingSearch,
    })
    return
  }
  return restoreApplicationDestination(app, intent)
}

/** Establish a typed destination without reading the URL again. */
export async function restoreApplicationDestination(
  app: App,
  intent: Extract<InitialUrlIntent, { type: 'launch' }>,
  options: {
    openProject?: AppNavigationService['openProject']
    signal?: AbortSignal
    projectUrl?: boolean
  } = {}
): Promise<void> {
  const appUrl = app.registry.get(appUrlService)

  let destination: AppDestination = intent.destination
  let urlState: AppUrlState = {
    ...(intent.overlay ? { overlay: intent.overlay } : {}),
    search: intent.search,
    hash: intent.hash,
  }
  let shouldProjectUrl = options.projectUrl ?? false

  for (
    let transitionCount = 0;
    transitionCount < MAX_INITIAL_TRANSITIONS;
    transitionCount += 1
  ) {
    options.signal?.throwIfAborted()
    let result: InitialResult
    switch (destination.type) {
      case 'index':
        result = await initIndexRoute(app, {
          urlState,
          ...(options.signal ? { signal: options.signal } : {}),
        })
        break
      case 'home':
        result = options.signal
          ? await initHomeRoute(app, { signal: options.signal })
          : await initHomeRoute(app)
        break
      case 'project':
        result = await initFileRoute(app, {
          id: destination.target,
          startup: urlState,
          ...(options.openProject ? { openProject: options.openProject } : {}),
        })
        break
      case 'sign-in':
        return
    }
    options.signal?.throwIfAborted()

    if (result.kind === 'ready') {
      if (shouldProjectUrl && destination.type !== 'project') {
        await appUrl.navigate(appUrl.formatUrl({ destination, ...urlState }), {
          replace: true,
        })
      }
      return
    }

    destination = result.destination
    urlState = result.urlState
    shouldProjectUrl = true
  }

  return Promise.reject(
    new Error('Too many transitions while restoring initial application state.')
  )
}
