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
  appUrlService,
} from '@src/registry/contracts/appUrl'

const MAX_INITIAL_TRANSITIONS = 8

type InitialResult = RouteInitResult<
  undefined | FileLoaderData | HomeLoaderData
>

function requestUrlFromApplicationPath(
  path: string,
  baseUrl: string,
  usesHashRouter: boolean
) {
  const url = new URL(baseUrl)
  if (usesHashRouter) {
    url.hash = `#${path}`
    return url.href
  }
  return new URL(path, url).href
}

function effectRequestUrl(requestUrl: string, usesHashRouter: boolean) {
  const url = new URL(requestUrl)
  if (usesHashRouter && url.hash.startsWith('#/')) {
    return new URL(url.hash.slice(1), 'http://application.local').href
  }
  return requestUrl
}

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
  let currentEffectRequestUrl = effectRequestUrl(requestUrl, usesHashRouter)
  let canonicalPath: string | undefined

  for (
    let transitionCount = 0;
    transitionCount < MAX_INITIAL_TRANSITIONS;
    transitionCount += 1
  ) {
    let result: InitialResult
    switch (destination.type) {
      case 'index':
        result = await initIndexRoute(app, {
          requestUrl: currentEffectRequestUrl,
        })
        break
      case 'home':
        result = await initHomeRoute(app)
        break
      case 'project':
        result = await initFileRoute(app, {
          id: destination.target,
          requestUrl: currentEffectRequestUrl,
        })
        break
      case 'sign-in':
        return
    }

    if (result.kind === 'ready') {
      if (canonicalPath) {
        void appUrl.navigate(canonicalPath, { replace: true })
      }
      return
    }

    destination = result.destination
    canonicalPath = result.canonicalPath
    const nextRequestUrl = requestUrlFromApplicationPath(
      canonicalPath,
      currentEffectRequestUrl,
      usesHashRouter
    )
    currentEffectRequestUrl = effectRequestUrl(nextRequestUrl, usesHashRouter)
  }

  return Promise.reject(
    new Error('Too many transitions while restoring initial application state.')
  )
}
