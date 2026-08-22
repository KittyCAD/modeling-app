import type { OAuthSession } from '@atproto/oauth-client-browser'
import {
  ATPROTO_ARCHIVE_BLOB_SCOPE,
  ATPROTO_AUTH_SYNC_SCOPE,
  createAtprotoBrowserOAuthConnector,
} from '@src/lib/atprotoSync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const defaultBrowserOAuthClientMock = vi.hoisted(() => {
  let client:
    | {
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
  beforeEach(() => {
    defaultBrowserOAuthClientMock.constructorSpy.mockReset()
    defaultBrowserOAuthClientMock.setClient(undefined)
  })

  afterEach(() => {
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
    const connector = createAtprotoBrowserOAuthConnector({ client })
    const identity = await connector.connect({
      input: 'franknoirot.co',
      scopes: ['atproto'],
    })

    const config = await connector.createProjectApiConfig?.(identity)

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
