import { joinRouterPaths, PATHS, webSafePathSplit } from '@src/lib/paths'
import type {
  AppDestination,
  AppDestinationKind,
  AppNavigationUrlContribution,
  AppUrlProjection,
  InitialUrlIntent,
} from '@src/registry/contracts/appUrl'

interface ApplicationUrl {
  pathname: string
  search: string
  hash: string
}

function readApplicationUrl(url: URL, usesHashRouter: boolean): ApplicationUrl {
  if (usesHashRouter) {
    if (url.hash.startsWith('#/')) {
      const hashUrl = new URL(url.hash.slice(1), 'http://application.local')
      return {
        pathname: hashUrl.pathname,
        search: hashUrl.search,
        hash: hashUrl.hash,
      }
    }

    // A hash router treats the desktop document URL as the application index
    // until a route hash exists. The filesystem pathname names index.html; it
    // is not an application route. Keep outer query parameters because desktop
    // launch commands use them before the canonical hash URL is projected.
    return { pathname: '/', search: url.search, hash: '' }
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

function formatDestination(destination: AppDestination): string {
  switch (destination.type) {
    case 'index':
      return PATHS.INDEX
    case 'home':
      return destination.libraryId
        ? joinRouterPaths(
            PATHS.LIBRARY,
            encodeURIComponent(destination.libraryId)
          )
        : PATHS.HOME
    case 'project':
      return joinRouterPaths(PATHS.FILE, encodeURIComponent(destination.target))
    case 'sign-in':
      return PATHS.SIGN_IN
  }
}

/** Format application state through the capability contributions that own it. */
export function formatAppUrl(
  projection: AppUrlProjection,
  navigationIntents: readonly AppNavigationUrlContribution[]
): string {
  const destinationPath = formatDestination(projection.destination)
  const additionalIntent = projection.additionalIntents?.[0]
  if (!additionalIntent) {
    return `${destinationPath}${projection.search}${projection.hash}`
  }

  const contribution = navigationIntents.find(
    ({ intent }) => intent.id === additionalIntent.intent.id
  )
  if (!contribution) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error(
      `Missing application navigation URL contribution: ${additionalIntent.intent.id}`
    )
  }

  const intentUrl = contribution.format(additionalIntent.input)
  return `${joinRouterPaths(destinationPath, intentUrl.path)}${
    intentUrl.search ?? projection.search
  }${intentUrl.hash ?? projection.hash}`
}

function parseDestination(pathname: string):
  | {
      destination: AppDestination
      intentDestination?: AppDestinationKind
      intentPath: string
    }
  | undefined {
  const segments = webSafePathSplit(pathname).filter(Boolean)
  if (segments.length === 0) {
    return { destination: { type: 'index' }, intentPath: '' }
  }

  const [head, encodedId, ...remainder] = segments
  const intentPath = remainder.length > 0 ? joinRouterPaths(...remainder) : ''

  if (head === PATHS.HOME.slice(1)) {
    return {
      destination: { type: 'home' },
      intentDestination: 'home',
      intentPath:
        encodedId === undefined ? '' : joinRouterPaths(encodedId, ...remainder),
    }
  }

  if (head === PATHS.LIBRARY.slice(1) && encodedId) {
    const libraryId = decodeSegment(encodedId)
    return libraryId === undefined
      ? undefined
      : {
          destination: { type: 'home', libraryId },
          intentDestination: 'home',
          intentPath,
        }
  }

  if (head === PATHS.FILE.slice(1) && encodedId) {
    const target = decodeSegment(encodedId)
    return target === undefined
      ? undefined
      : {
          destination: { type: 'project', target },
          intentDestination: 'project',
          intentPath,
        }
  }

  if (head === PATHS.SIGN_IN.slice(1) && segments.length === 1) {
    return { destination: { type: 'sign-in' }, intentPath: '' }
  }

  return undefined
}

/** Parse the initial URL without changing application or browser state. */
export function parseInitialUrl(
  requestUrl: string,
  {
    navigationIntents,
    usesHashRouter,
  }: {
    navigationIntents: readonly AppNavigationUrlContribution[]
    usesHashRouter: boolean
  }
): InitialUrlIntent {
  const applicationUrl = readApplicationUrl(new URL(requestUrl), usesHashRouter)
  const parsedDestination = parseDestination(applicationUrl.pathname)
  if (!parsedDestination) {
    return { type: 'unrecognized', ...applicationUrl }
  }

  if (!parsedDestination.intentPath) {
    return {
      type: 'launch',
      destination: parsedDestination.destination,
      search: applicationUrl.search,
      hash: applicationUrl.hash,
    }
  }

  if (!parsedDestination.intentDestination) {
    return { type: 'unrecognized', ...applicationUrl }
  }

  const input = {
    destination: parsedDestination.intentDestination,
    path: parsedDestination.intentPath,
    search: new URLSearchParams(applicationUrl.search),
    hash: applicationUrl.hash,
  }
  for (const contribution of navigationIntents) {
    const intentInput = contribution.parse(input)
    if (intentInput !== undefined) {
      return {
        type: 'launch',
        destination: parsedDestination.destination,
        additionalIntents: [
          { intent: contribution.intent, input: intentInput },
        ],
        search: applicationUrl.search,
        hash: applicationUrl.hash,
      }
    }
  }

  return { type: 'unrecognized', ...applicationUrl }
}
