import type { App } from '@src/lib/app'
import {
  initFileRoute,
  initIndexRoute,
  type RouteInitResult,
} from '@src/lib/routeInit'
import type { FileLoaderData } from '@src/lib/types'
import {
  appNavigationService,
  showHomeIntent,
} from '@src/registry/contracts/appNavigation'
import {
  type AppDestination,
  type AppUrlState,
  appUrlService,
} from '@src/registry/contracts/appUrl'

const MAX_INITIAL_TRANSITIONS = 8

type InitialResult = RouteInitResult<undefined | FileLoaderData>

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
  const appNavigation = app.registry.get(appNavigationService)
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
        await appNavigation.dispatch(showHomeIntent, {
          ...(destination.libraryId
            ? { libraryId: destination.libraryId }
            : {}),
          startup: urlState,
        })
        result = { kind: 'ready', data: undefined }
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
      for (const additionalIntent of urlState.additionalIntents ?? []) {
        await appNavigation.dispatch(
          additionalIntent.intent,
          additionalIntent.input
        )
      }
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
