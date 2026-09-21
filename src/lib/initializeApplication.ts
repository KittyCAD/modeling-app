import type { App } from '@src/lib/app'
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
} from '@src/registry/contracts/appUrl'

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

  let destination: AppDestination = intent.destination
  let urlState: AppUrlState = {
    ...(intent.additionalIntents
      ? { additionalIntents: intent.additionalIntents }
      : {}),
    search: intent.search,
    hash: intent.hash,
  }
  let shouldProjectUrl = false

  for (
    let transitionCount = 0;
    transitionCount < MAX_INITIAL_TRANSITIONS;
    transitionCount += 1
  ) {
    let result: InitialResult
    switch (destination.type) {
      case 'index':
        result = await initIndexRoute(app, { urlState })
        break
      case 'home':
        result = await initHomeRoute(app)
        break
      case 'project':
        result = await initFileRoute(app, {
          id: destination.target,
          startup: urlState,
        })
        break
      case 'sign-in':
        return
    }

    if (result.kind === 'ready') {
      if (shouldProjectUrl && destination.type !== 'project') {
        void appUrl.navigate(appUrl.formatUrl({ destination, ...urlState }), {
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
