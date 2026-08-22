import type { OAuthSession } from '@atproto/oauth-client-browser'
import {
  ATPROTO_ARCHIVE_BLOB_SCOPE,
  ATPROTO_AUTH_SYNC_SCOPE,
  createAtprotoBrowserOAuthConnector,
} from '@src/lib/atprotoSync'
import { describe, expect, it, vi } from 'vitest'

function createSession({
  did = 'did:plc:frank',
  scope = `atproto ${ATPROTO_AUTH_SYNC_SCOPE} ${ATPROTO_ARCHIVE_BLOB_SCOPE}`,
  expired = false,
}: {
  did?: string
  scope?: string
  expired?: boolean
} = {}): OAuthSession {
  return {
    did,
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
