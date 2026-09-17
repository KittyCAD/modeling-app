import {
  joinRouterPaths,
  PATHS,
  webSafePathSplit,
} from '@src/lib/paths'
import type {
  AppDestination,
  AppDestinationKind,
  AppOverlayContribution,
  InitialUrlIntent,
} from '@src/registry/contracts/router'

interface ApplicationUrl {
  pathname: string
  search: string
  hash: string
}

function readApplicationUrl(url: URL, usesHashRouter: boolean): ApplicationUrl {
  if (usesHashRouter && url.hash.startsWith('#/')) {
    const hashUrl = new URL(url.hash.slice(1), 'http://application.local')
    return {
      pathname: hashUrl.pathname,
      search: hashUrl.search,
      hash: hashUrl.hash,
    }
  }

  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  }
}

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

function parseDestination(pathname: string):
  | {
      destination: AppDestination
      overlayDestination?: AppDestinationKind
      overlayPath: string
    }
  | undefined {
  const segments = webSafePathSplit(pathname).filter(Boolean)
  if (segments.length === 0) {
    return { destination: { type: 'index' }, overlayPath: '' }
  }

  const [head, encodedId, ...remainder] = segments
  const overlayPath =
    remainder.length > 0 ? joinRouterPaths(...remainder) : ''

  if (head === PATHS.HOME.slice(1)) {
    return {
      destination: { type: 'home' },
      overlayDestination: 'home',
      overlayPath:
        encodedId === undefined
          ? ''
          : joinRouterPaths(encodedId, ...remainder),
    }
  }

  if (head === PATHS.LIBRARY.slice(1) && encodedId) {
    const libraryId = decodeSegment(encodedId)
    return libraryId === undefined
      ? undefined
      : {
          destination: { type: 'home', libraryId },
          overlayDestination: 'home',
          overlayPath,
        }
  }

  if (head === PATHS.FILE.slice(1) && encodedId) {
    const target = decodeSegment(encodedId)
    return target === undefined
      ? undefined
      : {
          destination: { type: 'project', target },
          overlayDestination: 'project',
          overlayPath,
        }
  }

  if (head === PATHS.SIGN_IN.slice(1) && segments.length === 1) {
    return { destination: { type: 'sign-in' }, overlayPath: '' }
  }

  return undefined
}

/** Parse the initial URL without changing application or browser state. */
export function parseInitialUrl(
  requestUrl: string,
  {
    overlays,
    usesHashRouter,
  }: {
    overlays: readonly AppOverlayContribution[]
    usesHashRouter: boolean
  }
): InitialUrlIntent {
  const applicationUrl = readApplicationUrl(new URL(requestUrl), usesHashRouter)
  const parsedDestination = parseDestination(applicationUrl.pathname)
  if (!parsedDestination) {
    return { type: 'unrecognized', ...applicationUrl }
  }

  if (!parsedDestination.overlayPath) {
    return {
      type: 'launch',
      destination: parsedDestination.destination,
      search: applicationUrl.search,
      hash: applicationUrl.hash,
    }
  }

  if (!parsedDestination.overlayDestination) {
    return { type: 'unrecognized', ...applicationUrl }
  }

  const input = {
    destination: parsedDestination.overlayDestination,
    path: parsedDestination.overlayPath,
    search: new URLSearchParams(applicationUrl.search),
    hash: applicationUrl.hash,
  }
  for (const contribution of overlays) {
    const state = contribution.parse(input)
    if (state !== undefined) {
      return {
        type: 'launch',
        destination: parsedDestination.destination,
        overlay: { contributionId: contribution.id, state },
        search: applicationUrl.search,
        hash: applicationUrl.hash,
      }
    }
  }

  return { type: 'unrecognized', ...applicationUrl }
}
