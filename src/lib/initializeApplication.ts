import type { App } from '@src/lib/app'
import {
  initFileRoute,
  initHomeRoute,
  initIndexRoute,
  type RouteInitResult,
} from '@src/lib/routeInit'
import type { FileLoaderData, HomeLoaderData } from '@src/lib/types'
import { routerService } from '@src/registry/contracts/router'

const MAX_INITIAL_REDIRECTS = 8

type InitialResult = RouteInitResult<
  undefined | FileLoaderData | HomeLoaderData
>

function applicationPathFromRedirect(to: string, baseUrl: string) {
  const url = new URL(to, baseUrl)
  if (url.hash.startsWith('#/')) {
    return url.hash.slice(1)
  }
  return `${url.pathname}${url.search}${url.hash}`
}

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
 * Redirects are canonicalisation results from the application commands. They
 * are written back through the router capability and reparsed here; React
 * Router is not involved in executing any of these effects.
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
  const router = app.registry.get(routerService)
  let currentRequestUrl = requestUrl

  for (let redirectCount = 0; redirectCount < MAX_INITIAL_REDIRECTS; redirectCount += 1) {
    const intent = router.readInitialUrl({
      requestUrl: currentRequestUrl,
      usesHashRouter,
    })
    if (intent.type === 'unrecognized') {
      return
    }

    let result: InitialResult
    const currentEffectRequestUrl = effectRequestUrl(
      currentRequestUrl,
      usesHashRouter
    )
    switch (intent.destination.type) {
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
          id: intent.destination.target,
          requestUrl: currentEffectRequestUrl,
        })
        break
      case 'sign-in':
        return
    }

    if (result.kind === 'ok') {
      return
    }

    const path = applicationPathFromRedirect(
      result.to,
      currentRequestUrl
    )
    void router.navigate(path, { replace: true })
    currentRequestUrl = requestUrlFromApplicationPath(
      path,
      currentRequestUrl,
      usesHashRouter
    )
  }

  return Promise.reject(
    new Error('Too many redirects while restoring initial application state.')
  )
}
