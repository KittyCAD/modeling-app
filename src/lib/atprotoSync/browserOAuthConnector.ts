import type {
  BrowserOAuthClientOptions,
  OAuthSession,
} from '@atproto/oauth-client-browser'
import {
  ATPROTO_IDENTITY_PROVIDER_ID,
  type AtprotoOAuthConnectOptions,
  type AtprotoOAuthConnector,
  type AtprotoOAuthIdentity,
  normalizeAtprotoOAuthIdentity,
} from '@src/lib/atprotoSync/oauth'

type BrowserOAuthClientLike = Pick<
  import('@atproto/oauth-client-browser').BrowserOAuthClient,
  'init' | 'restore' | 'revoke' | 'signInPopup'
>

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

  const createDefaultClient = async () => {
    const { BrowserOAuthClient } = await import('@atproto/oauth-client-browser')
    return new BrowserOAuthClient({
      clientMetadata,
      handleResolver,
      responseMode,
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

  return {
    initialize: async () => {
      const session = await initializeSession()
      return session
        ? atprotoOAuthIdentityFromSession({
            session,
            now,
          })
        : undefined
    },
    connect: async (options: AtprotoOAuthConnectOptions) => {
      const input = resolveDefaultInput(options.input, defaultInput)
      if (!input) {
        throw new Error('Enter an ATProto handle, DID, or PDS URL.')
      }

      const session = await (await getClient()).signInPopup(input, {
        scope: options.scopes.join(' '),
      })

      return atprotoOAuthIdentityFromSession({
        session,
        input,
        now,
      })
    },
    disconnect: async (identity) => {
      await (await getClient()).revoke(identity.did)
    },
    refresh: async (identity) => {
      try {
        const session = await (await getClient()).restore(identity.did, true)
        return atprotoOAuthIdentityFromSession({
          session,
          input: identity.handle,
          now,
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
