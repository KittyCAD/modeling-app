import type { OAuthSession } from '@atproto/oauth-client-browser'
import {
  ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI,
  ATPROTO_ARCHIVE_BLOB_SCOPE,
  ATPROTO_AUTH_SYNC_SCOPE,
  ATPROTO_OAUTH_SCOPES,
  createAtprotoBrowserOAuthConnector,
} from '@src/lib/atprotoSync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const defaultBrowserOAuthClientMock = vi.hoisted(() => {
  let client:
    | {
        authorize?: (...args: unknown[]) => unknown
        callback?: (...args: unknown[]) => unknown
        init: (...args: unknown[]) => unknown
        restore: (...args: unknown[]) => unknown
        revoke: (...args: unknown[]) => unknown
        signInPopup: (...args: unknown[]) => unknown
      }
    | undefined
  const constructorSpy = vi.fn()

  return {
    constructorSpy,
    setClient: (nextClient: typeof client) => {
      client = nextClient
    },
    BrowserOAuthClient: class BrowserOAuthClient {
      constructor(options: unknown) {
        constructorSpy(options)
      }

      authorize(...args: unknown[]) {
        return client?.authorize?.(...args)
      }

      callback(...args: unknown[]) {
        return client?.callback?.(...args)
      }

      init(...args: unknown[]) {
        return client?.init(...args)
      }

      restore(...args: unknown[]) {
        return client?.restore(...args)
      }

      revoke(...args: unknown[]) {
        return client?.revoke(...args)
      }

      signInPopup(...args: unknown[]) {
        return client?.signInPopup(...args)
      }
    },
  }
})

vi.mock('@atproto/oauth-client-browser', () => ({
  BrowserOAuthClient: defaultBrowserOAuthClientMock.BrowserOAuthClient,
}))

function setTestUrl(url: string) {
  ;(
    globalThis as {
      happyDOM?: { setURL: (nextUrl: string) => void }
    }
  ).happyDOM?.setURL(url)
}

function createSession({
  did = 'did:plc:frank',
  scope = `atproto ${ATPROTO_AUTH_SYNC_SCOPE} ${ATPROTO_ARCHIVE_BLOB_SCOPE}`,
  expired = false,
  fetchHandler = vi.fn(),
}: {
  did?: string
  scope?: string
  expired?: boolean
  fetchHandler?: OAuthSession['fetchHandler']
} = {}): OAuthSession {
  return {
    did,
    fetchHandler,
    getTokenInfo: vi.fn().mockResolvedValue({
      aud: 'https://pds.example',
      iss: 'https://auth.example',
      scope,
      expired,
      expiresAt: new Date('2026-08-22T01:00:00.000Z'),
    }),
  } as unknown as OAuthSession
}

describe('ATProto browser OAuth connector', () => {
  let originalElectron: Window['electron']

  beforeEach(() => {
    originalElectron = window.electron
    window.electron = undefined
    setTestUrl('http://localhost:3000/')
    defaultBrowserOAuthClientMock.constructorSpy.mockReset()
    defaultBrowserOAuthClientMock.setClient(undefined)
  })

  afterEach(() => {
    window.electron = originalElectron
    vi.unstubAllGlobals()
  })

  it('does not initialize the default SDK client on ordinary app routes', async () => {
    window.history.pushState(null, '', '/signin?callbackUrl=%2F')
    vi.stubGlobal('indexedDB', {})
    vi.stubGlobal('localStorage', {})
    vi.stubGlobal('BroadcastChannel', class BroadcastChannel {})
    defaultBrowserOAuthClientMock.setClient({
      init: vi.fn().mockResolvedValue({
        session: createSession({ did: 'did:plc:unexpected' }),
      }),
      restore: vi.fn(),
      revoke: vi.fn(),
      signInPopup: vi.fn(),
    })
    const connector = createAtprotoBrowserOAuthConnector()

    await expect(connector.initialize?.()).resolves.toBeUndefined()

    expect(defaultBrowserOAuthClientMock.constructorSpy).not.toHaveBeenCalled()
  })

  it('initializes the default SDK client on ATProto OAuth callback routes', async () => {
    window.history.pushState(null, '', '/?code=oauth-code&state=oauth-state')
    vi.stubGlobal('indexedDB', {})
    vi.stubGlobal('localStorage', {})
    vi.stubGlobal('BroadcastChannel', class BroadcastChannel {})
    const client = {
      init: vi.fn().mockResolvedValue({
        session: createSession({ did: 'did:plc:callback' }),
      }),
      restore: vi.fn(),
      revoke: vi.fn(),
      signInPopup: vi.fn(),
    }
    defaultBrowserOAuthClientMock.setClient(client)
    const connector = createAtprotoBrowserOAuthConnector({
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    })

    const identity = await connector.initialize?.()

    expect(defaultBrowserOAuthClientMock.constructorSpy).toHaveBeenCalledTimes(
      1
    )
    expect(client.init).toHaveBeenCalledWith(true)
    expect(identity).toMatchObject({
      provider: 'atproto',
      did: 'did:plc:callback',
      status: 'connected',
    })
  })

  it('initializes the default SDK client on ATProto OAuth fragment callback routes', async () => {
    window.history.pushState(null, '', '/#code=oauth-code&state=oauth-state')
    vi.stubGlobal('indexedDB', {})
    vi.stubGlobal('localStorage', {})
    vi.stubGlobal('BroadcastChannel', class BroadcastChannel {})
    const client = {
      init: vi.fn().mockResolvedValue({
        session: createSession({ did: 'did:plc:fragment-callback' }),
      }),
      restore: vi.fn(),
      revoke: vi.fn(),
      signInPopup: vi.fn(),
    }
    defaultBrowserOAuthClientMock.setClient(client)
    const connector = createAtprotoBrowserOAuthConnector({
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    })

    const identity = await connector.initialize?.()

    expect(defaultBrowserOAuthClientMock.constructorSpy).toHaveBeenCalledTimes(
      1
    )
    expect(client.init).toHaveBeenCalledWith(true)
    expect(identity).toMatchObject({
      provider: 'atproto',
      did: 'did:plc:fragment-callback',
      status: 'connected',
    })
  })

  it('initializes the SDK once and converts a restored session to an identity', async () => {
    const client = {
      init: vi.fn().mockResolvedValue({
        session: createSession({ did: 'did:plc:restored' }),
      }),
      restore: vi.fn(),
      revoke: vi.fn(),
      signInPopup: vi.fn(),
    }
    const connector = createAtprotoBrowserOAuthConnector({
      client,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    })

    const identity = await connector.initialize?.()
    await connector.initialize?.()

    expect(client.init).toHaveBeenCalledTimes(1)
    expect(client.init).toHaveBeenCalledWith(true)
    expect(identity).toMatchObject({
      provider: 'atproto',
      did: 'did:plc:restored',
      status: 'connected',
      connectedAt: '2026-08-22T00:00:00.000Z',
    })
  })

  it('starts popup sign-in and converts the resulting SDK session to an identity', async () => {
    const session = createSession()
    const client = {
      init: vi.fn(),
      restore: vi.fn(),
      revoke: vi.fn(),
      signInPopup: vi.fn().mockResolvedValue(session),
    }
    const connector = createAtprotoBrowserOAuthConnector({
      client,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    })

    const identity = await connector.connect({
      input: 'franknoirot.co',
      scopes: ['atproto', ATPROTO_AUTH_SYNC_SCOPE, ATPROTO_ARCHIVE_BLOB_SCOPE],
    })

    expect(client.signInPopup).toHaveBeenCalledWith('franknoirot.co', {
      scope: `atproto ${ATPROTO_AUTH_SYNC_SCOPE} ${ATPROTO_ARCHIVE_BLOB_SCOPE}`,
    })
    expect(identity).toEqual({
      provider: 'atproto',
      did: 'did:plc:frank',
      handle: 'franknoirot.co',
      serviceUrl: 'https://pds.example',
      authorizationServer: 'https://auth.example',
      scopes: ['atproto', ATPROTO_AUTH_SYNC_SCOPE, ATPROTO_ARCHIVE_BLOB_SCOPE],
      status: 'connected',
      connectedAt: '2026-08-22T00:00:00.000Z',
      expiresAt: '2026-08-22T01:00:00.000Z',
    })
  })

  it('declares requested sync scopes in default loopback client metadata', async () => {
    setTestUrl('http://127.0.0.1:3000/settings')
    vi.stubGlobal('indexedDB', {})
    vi.stubGlobal('localStorage', {})
    vi.stubGlobal('BroadcastChannel', class BroadcastChannel {})
    const client = {
      init: vi.fn(),
      restore: vi.fn(),
      revoke: vi.fn(),
      signInPopup: vi.fn().mockResolvedValue(createSession()),
    }
    defaultBrowserOAuthClientMock.setClient(client)
    const scope = ATPROTO_OAUTH_SCOPES.join(' ')
    const redirectUri = `http://127.0.0.1${window.location.port ? `:${window.location.port}` : ''}${window.location.pathname}`
    const connector = createAtprotoBrowserOAuthConnector({
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    })

    await connector.connect({
      input: 'franknoirot.co',
      scopes: ATPROTO_OAUTH_SCOPES,
    })

    const constructorOptions = defaultBrowserOAuthClientMock.constructorSpy.mock
      .calls[0]?.[0] as {
      clientMetadata?: {
        client_id: string
        scope: string
        redirect_uris: string[]
      }
    }

    expect(constructorOptions.clientMetadata).toMatchObject({
      scope,
      redirect_uris: [redirectUri],
    })
    expect(
      new URL(constructorOptions.clientMetadata?.client_id ?? '').searchParams
    ).toEqual(new URLSearchParams({ scope, redirect_uri: redirectUri }))
    expect(client.signInPopup).toHaveBeenCalledWith('franknoirot.co', {
      scope,
    })
  })

  it('uses the desktop external browser callback bridge from localhost', async () => {
    const scope = ATPROTO_OAUTH_SCOPES.join(' ')
    const session = createSession({ did: 'did:plc:desktop' })
    const client = {
      authorize: vi
        .fn()
        .mockResolvedValue(new URL('https://auth.example/authorize')),
      callback: vi.fn().mockResolvedValue({ session }),
      init: vi.fn(),
      restore: vi.fn().mockResolvedValue(session),
      revoke: vi.fn(),
      signInPopup: vi.fn(),
    }
    defaultBrowserOAuthClientMock.setClient(client)
    window.electron = {
      startAtprotoOAuthCallback: vi.fn().mockResolvedValue({
        redirectUri: ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI,
      }),
      waitForAtprotoOAuthCallback: vi.fn().mockResolvedValue({
        redirectUri: ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI,
        params: [
          ['code', 'oauth-code'],
          ['state', 'oauth-state'],
        ],
      }),
      cancelAtprotoOAuthCallback: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn().mockResolvedValue(undefined),
    } as unknown as Window['electron']
    const connector = createAtprotoBrowserOAuthConnector({
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    })

    const identity = await connector.connect({
      input: 'franknoirot.co',
      scopes: ATPROTO_OAUTH_SCOPES,
    })

    const constructorOptions = defaultBrowserOAuthClientMock.constructorSpy.mock
      .calls[0]?.[0] as {
      clientMetadata?: {
        client_id: string
        scope: string
        redirect_uris: string[]
      }
      responseMode?: string
    }

    expect(constructorOptions.clientMetadata).toMatchObject({
      scope,
      redirect_uris: [ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI],
    })
    expect(
      new URL(constructorOptions.clientMetadata?.client_id ?? '').searchParams
    ).toEqual(
      new URLSearchParams({
        scope,
        redirect_uri: ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI,
      })
    )
    expect(constructorOptions.responseMode).toBe('query')
    expect(client.authorize).toHaveBeenCalledWith('franknoirot.co', {
      scope,
      redirect_uri: ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI,
    })
    expect(window.electron?.openExternal).toHaveBeenCalledWith(
      'https://auth.example/authorize'
    )
    expect(client.callback).toHaveBeenCalledOnce()
    const [callbackParams, callbackOptions] = client.callback.mock.calls[0]
    expect((callbackParams as URLSearchParams).toString()).toBe(
      'code=oauth-code&state=oauth-state'
    )
    expect(callbackOptions).toEqual({
      redirect_uri: ATPROTO_DESKTOP_OAUTH_CALLBACK_REDIRECT_URI,
    })
    expect(client.restore).toHaveBeenCalledWith('did:plc:desktop', false)
    expect(client.signInPopup).not.toHaveBeenCalled()
    expect(identity).toMatchObject({
      provider: 'atproto',
      did: 'did:plc:desktop',
      handle: 'franknoirot.co',
      status: 'connected',
    })
  })

  it('builds project API configs that use the SDK session fetch handler', async () => {
    const fetchHandler = vi
      .fn<OAuthSession['fetchHandler']>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            uri: 'at://did:plc:frank/nyc.noirot.cad.project/demo',
            cid: 'project-cid',
            value: { title: 'Demo' },
          })
        )
      )
    const session = createSession({ fetchHandler })
    const client = {
      init: vi.fn(),
      restore: vi.fn(),
      revoke: vi.fn(),
      signInPopup: vi.fn().mockResolvedValue(session),
    }
    const connector = createAtprotoBrowserOAuthConnector({
      client,
      archiveRetentionLimit: 7,
    })
    const identity = await connector.connect({
      input: 'franknoirot.co',
      scopes: ['atproto'],
    })

    const config = await connector.createProjectApiConfig?.(identity)

    expect(config?.archiveRetentionLimit).toBe(7)
    await expect(
      config?.client.getRecord({
        repo: 'did:plc:frank',
        collection: 'nyc.noirot.cad.project',
        rkey: 'demo',
      })
    ).resolves.toMatchObject({
      cid: 'project-cid',
    })
    expect(fetchHandler).toHaveBeenCalledWith(
      '/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Afrank&collection=nyc.noirot.cad.project&rkey=demo',
      expect.objectContaining({
        method: 'GET',
      })
    )
  })

  it('uses default input and revokes/restores stored SDK sessions', async () => {
    const client = {
      init: vi.fn(),
      restore: vi
        .fn()
        .mockResolvedValue(createSession({ did: 'did:plc:restored' })),
      revoke: vi.fn().mockResolvedValue(undefined),
      signInPopup: vi.fn().mockResolvedValue(createSession()),
    }
    const connector = createAtprotoBrowserOAuthConnector({
      client,
      defaultInput: () => 'default.example',
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    })

    await connector.connect({
      scopes: ['atproto'],
    })
    const refreshed = await connector.refresh?.({
      provider: 'atproto',
      did: 'did:plc:frank',
      handle: 'franknoirot.co',
      scopes: ['atproto'],
      status: 'connected',
      connectedAt: '2026-08-22T00:00:00.000Z',
    })
    await connector.disconnect?.({
      provider: 'atproto',
      did: 'did:plc:frank',
      scopes: ['atproto'],
      status: 'connected',
      connectedAt: '2026-08-22T00:00:00.000Z',
    })

    expect(client.signInPopup).toHaveBeenCalledWith('default.example', {
      scope: 'atproto',
    })
    expect(client.restore).toHaveBeenCalledWith('did:plc:frank', true)
    expect(refreshed?.did).toBe('did:plc:restored')
    expect(client.revoke).toHaveBeenCalledWith('did:plc:frank')
  })

  it('marks identities expired when the SDK session cannot be restored', async () => {
    const client = {
      init: vi.fn(),
      restore: vi.fn().mockRejectedValue(new Error('missing session')),
      revoke: vi.fn(),
      signInPopup: vi.fn(),
    }
    const connector = createAtprotoBrowserOAuthConnector({ client })

    await expect(
      connector.refresh?.({
        provider: 'atproto',
        did: 'did:plc:frank',
        scopes: ['atproto'],
        status: 'connected',
        connectedAt: '2026-08-22T00:00:00.000Z',
      })
    ).resolves.toMatchObject({
      status: 'expired',
    })
  })

  it('requires an input when no default is configured', async () => {
    const connector = createAtprotoBrowserOAuthConnector({
      client: {
        init: vi.fn(),
        restore: vi.fn(),
        revoke: vi.fn(),
        signInPopup: vi.fn(),
      },
    })

    await expect(connector.connect({ scopes: ['atproto'] })).rejects.toThrow(
      'Enter an ATProto handle, DID, or PDS URL.'
    )
  })

  it('ignores popup callback completion errors after notifying the parent window', async () => {
    const connector = createAtprotoBrowserOAuthConnector({
      client: {
        init: vi.fn().mockRejectedValue(
          Object.assign(new Error('Login complete'), {
            code: 'LOGIN_CONTINUED_IN_PARENT_WINDOW',
          })
        ),
        restore: vi.fn(),
        revoke: vi.fn(),
        signInPopup: vi.fn(),
      },
    })

    await expect(connector.initialize?.()).resolves.toBeUndefined()
  })
})
