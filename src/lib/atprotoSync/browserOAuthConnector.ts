import type {
  BrowserOAuthClientOptions,
  OAuthSession,
} from '@atproto/oauth-client-browser'
import type { AtprotoProjectApiConfig } from '@src/lib/atprotoSync/api'
import {
  ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI,
  type AtprotoDesktopOAuthCallbackRedirectUri,
} from '@src/lib/atprotoSync/desktopOAuth'
import {
  ATPROTO_IDENTITY_PROVIDER_ID,
  ATPROTO_OAUTH_SCOPES,
  type AtprotoOAuthConnectOptions,
  type AtprotoOAuthConnector,
  type AtprotoOAuthIdentity,
  normalizeAtprotoOAuthIdentity,
} from '@src/lib/atprotoSync/oauth'
import { AtprotoXrpcClient } from '@src/lib/atprotoSync/xrpcClient'

type BrowserOAuthClientLike = Pick<
  import('@atproto/oauth-client-browser').BrowserOAuthClient,
  'init' | 'restore' | 'revoke' | 'signInPopup'
> &
  Partial<{
    authorize: (
      input: string,
      options?: {
        scope?: string
        redirect_uri?: AtprotoDesktopOAuthCallbackRedirectUri
      }
    ) => Promise<URL>
    callback: (
      params: URLSearchParams,
      options?: {
        redirect_uri?: AtprotoDesktopOAuthCallbackRedirectUri
      }
    ) => Promise<{
      session: OAuthSession
      state: string | null
    }>
  }>

export type AtprotoBrowserOAuthConnectorOptions = {
  client?: BrowserOAuthClientLike
  createClient?: () => BrowserOAuthClientLike | Promise<BrowserOAuthClientLike>
  clientMetadata?: BrowserOAuthClientOptions['clientMetadata']
  handleResolver?: BrowserOAuthClientOptions['handleResolver']
  responseMode?: BrowserOAuthClientOptions['responseMode']
  plcDirectoryUrl?: BrowserOAuthClientOptions['plcDirectoryUrl']
  fetch?: BrowserOAuthClientOptions['fetch']
  defaultInput?: string | (() => string | undefined)
  now?: () => Date
}

function scopesFromTokenInfoScope(scope: string): readonly string[] {
  return scope.split(/\s+/).filter(Boolean)
}

function inferHandleFromInput(input: string | undefined): string | undefined {
  if (!input || input.startsWith('did:')) {
    return undefined
  }

  try {
    const url = new URL(input)
    return url.hostname || undefined
  } catch {
    return input
  }
}

function resolveDefaultInput(
  input: string | undefined,
  fallback: string | (() => string | undefined) | undefined
) {
  if (input) {
    return input
  }

  return typeof fallback === 'function' ? fallback() : fallback
}

function isLoginContinuedInParentWindowError(cause: unknown) {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === 'LOGIN_CONTINUED_IN_PARENT_WINDOW'
  )
}

function isLoopbackRedirectError(cause: unknown) {
  return (
    cause instanceof Error && cause.message === 'Redirecting to loopback IP...'
  )
}

function canUseDefaultBrowserOAuthRuntime() {
  return (
    typeof window !== 'undefined' &&
    typeof indexedDB !== 'undefined' &&
    typeof localStorage !== 'undefined' &&
    typeof BroadcastChannel !== 'undefined' &&
    !!globalThis.crypto?.subtle
  )
}

function isLoopbackHostname(hostname: string) {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  )
}

function canUseDesktopExternalBrowserOAuth() {
  return (
    typeof window !== 'undefined' &&
    !!window.electron?.startAtprotoOAuthCallback &&
    !!window.electron.waitForAtprotoOAuthCallback &&
    !!window.electron.cancelAtprotoOAuthCallback &&
    !!window.electron.openExternal
  )
}

function getDefaultRedirectUri() {
  if (canUseDesktopExternalBrowserOAuth()) {
    return ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI
  }
  if (
    typeof window === 'undefined' ||
    !isLoopbackHostname(window.location.hostname)
  ) {
    return undefined
  }

  const redirectHostname =
    window.location.hostname === 'localhost'
      ? '127.0.0.1'
      : window.location.hostname
  return `http://${redirectHostname}${
    window.location.port ? `:${window.location.port}` : ''
  }${window.location.pathname || '/'}`
}

// The ATProto loopback client id is also the dev metadata declaration, so it
// must encode every custom scope that the authorization request may ask for.
function createDefaultClientMetadata():
  | BrowserOAuthClientOptions['clientMetadata']
  | undefined {
  const redirectUri = getDefaultRedirectUri()
  if (!redirectUri) {
    return undefined
  }

  const scope = ATPROTO_OAUTH_SCOPES.join(' ')
  const clientIdParams = new URLSearchParams({
    scope,
    redirect_uri: redirectUri,
  })

  return {
    client_id: `http://localhost?${clientIdParams.toString()}`,
    scope,
    redirect_uris: [redirectUri],
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
    dpop_bound_access_tokens: true,
  }
}

function hasOAuthCallbackParams(params: URLSearchParams) {
  return params.has('state') && (params.has('code') || params.has('error'))
}

function hasAtprotoOAuthCallbackParams() {
  if (typeof window === 'undefined') {
    return false
  }

  return (
    hasOAuthCallbackParams(new URLSearchParams(window.location.search)) ||
    hasOAuthCallbackParams(new URLSearchParams(window.location.hash.slice(1)))
  )
}

function sessionFetchHandler(session: OAuthSession): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    )
    return session.fetchHandler(`${url.pathname}${url.search}`, init)
  }
}

async function atprotoOAuthIdentityFromSession({
  session,
  input,
  now,
}: {
  session: OAuthSession
  input?: string
  now: () => Date
}): Promise<AtprotoOAuthIdentity> {
  const tokenInfo = await session.getTokenInfo('auto')

  return normalizeAtprotoOAuthIdentity({
    provider: ATPROTO_IDENTITY_PROVIDER_ID,
    did: session.did,
    handle: inferHandleFromInput(input),
    serviceUrl: tokenInfo.aud,
    authorizationServer: tokenInfo.iss,
    scopes: scopesFromTokenInfoScope(tokenInfo.scope),
    status: tokenInfo.expired ? 'expired' : 'connected',
    connectedAt: now().toISOString(),
    expiresAt: tokenInfo.expiresAt?.toISOString(),
  })
}

export function createAtprotoBrowserOAuthConnector({
  client,
  createClient,
  clientMetadata,
  handleResolver = 'https://bsky.social',
  responseMode,
  plcDirectoryUrl,
  fetch,
  defaultInput,
  now = () => new Date(),
}: AtprotoBrowserOAuthConnectorOptions = {}): AtprotoOAuthConnector {
  let clientPromise: Promise<BrowserOAuthClientLike> | undefined
  let initializationPromise: Promise<OAuthSession | undefined> | undefined
  const sessions = new Map<string, OAuthSession>()

  const createDefaultClient = async () => {
    const { BrowserOAuthClient } = await import('@atproto/oauth-client-browser')
    return new BrowserOAuthClient({
      clientMetadata: clientMetadata ?? createDefaultClientMetadata(),
      handleResolver,
      responseMode:
        responseMode ??
        (canUseDesktopExternalBrowserOAuth() ? 'query' : undefined),
      plcDirectoryUrl,
      fetch,
    })
  }

  const getClient = async () => {
    clientPromise ??= Promise.resolve(
      client ?? createClient?.() ?? createDefaultClient()
    )

    return clientPromise
  }

  const initializeSession = async () => {
    if (!client && !createClient && !canUseDefaultBrowserOAuthRuntime()) {
      return undefined
    }
    if (!client && !createClient && !hasAtprotoOAuthCallbackParams()) {
      return undefined
    }

    initializationPromise ??= (async () => {
      try {
        return (await (await getClient()).init(true))?.session
      } catch (cause) {
        if (
          isLoginContinuedInParentWindowError(cause) ||
          isLoopbackRedirectError(cause)
        ) {
          return undefined
        }

        throw cause
      }
    })()

    return initializationPromise
  }

  const signInWithDesktopExternalBrowser = async ({
    oauthClient,
    input,
    options,
  }: {
    oauthClient: BrowserOAuthClientLike
    input: string
    options: AtprotoOAuthConnectOptions
  }) => {
    const electron = window.electron
    if (!electron || !oauthClient.authorize || !oauthClient.callback) {
      return oauthClient.signInPopup(input, {
        scope: options.scopes.join(' '),
      })
    }

    const { redirectUri } = await electron.startAtprotoOAuthCallback()
    try {
      const authorizationUrl = await oauthClient.authorize(input, {
        scope: options.scopes.join(' '),
        redirect_uri: redirectUri,
      })
      await electron.openExternal(authorizationUrl.href)
      const callback = await electron.waitForAtprotoOAuthCallback()
      const result = await oauthClient.callback(
        new URLSearchParams(callback.params),
        {
          redirect_uri: callback.redirectUri,
        }
      )
      return oauthClient.restore(result.session.did, false)
    } catch (cause) {
      await electron.cancelAtprotoOAuthCallback().catch(() => undefined)
      throw cause
    }
  }

  const rememberSession = (session: OAuthSession) => {
    sessions.set(session.did, session)
    return session
  }

  const restoreSession = async (identity: AtprotoOAuthIdentity) => {
    const restored = await (await getClient()).restore(identity.did, true)
    return rememberSession(restored)
  }

  const identityFromSession = async ({
    session,
    input,
  }: {
    session: OAuthSession
    input?: string
  }) =>
    atprotoOAuthIdentityFromSession({
      session: rememberSession(session),
      input,
      now,
    })

  return {
    initialize: async () => {
      const session = await initializeSession()
      return session ? identityFromSession({ session }) : undefined
    },
    createProjectApiConfig: async (
      identity
    ): Promise<AtprotoProjectApiConfig> => {
      const session =
        sessions.get(identity.did) ?? (await restoreSession(identity))
      const tokenInfo = await session.getTokenInfo('auto')
      const serviceUrl = identity.serviceUrl ?? tokenInfo.aud
      if (!serviceUrl) {
        throw new Error('ATProto OAuth session is missing a PDS service URL.')
      }

      return {
        repo: identity.did,
        client: new AtprotoXrpcClient({
          serviceUrl,
          fetch: sessionFetchHandler(session),
        }),
        source: 'zds-atproto-sync',
      }
    },
    connect: async (options: AtprotoOAuthConnectOptions) => {
      const input = resolveDefaultInput(options.input, defaultInput)
      if (!input) {
        throw new Error('Enter an ATProto handle, DID, or PDS URL.')
      }

      const oauthClient = await getClient()
      const session =
        !client && !createClient && canUseDesktopExternalBrowserOAuth()
          ? await signInWithDesktopExternalBrowser({
              oauthClient,
              input,
              options,
            })
          : await oauthClient.signInPopup(input, {
              scope: options.scopes.join(' '),
            })

      return identityFromSession({
        session,
        input,
      })
    },
    disconnect: async (identity) => {
      await (await getClient()).revoke(identity.did)
    },
    refresh: async (identity) => {
      try {
        const session = await (await getClient()).restore(identity.did, true)
        return identityFromSession({
          session,
          input: identity.handle,
        })
      } catch {
        return {
          ...identity,
          status: 'expired',
        }
      }
    },
  }
}
