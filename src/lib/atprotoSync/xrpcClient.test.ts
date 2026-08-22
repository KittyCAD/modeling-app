import { AtprotoSyncStaleRevisionError } from '@src/lib/atprotoSync/api'
import {
  AtprotoXrpcClient,
  AtprotoXrpcError,
  atprotoBlobCid,
} from '@src/lib/atprotoSync/xrpcClient'
import { describe, expect, test, vi } from 'vitest'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}

function fetchMockWithResponses(responses: Response[]) {
  return vi.fn<typeof fetch>(async () => {
    const response = responses.shift()
    if (!response) {
      throw new Error('No fake response queued')
    }
    return response
  })
}

function requestUrl(fetchMock: ReturnType<typeof fetchMockWithResponses>) {
  return new URL(fetchMock.mock.calls.at(-1)?.[0] as string)
}

function requestInit(fetchMock: ReturnType<typeof fetchMockWithResponses>) {
  return fetchMock.mock.calls.at(-1)?.[1]
}

describe('ATProto XRPC client', () => {
  test('lists records across paginated listRecords responses', async () => {
    const fetchMock = fetchMockWithResponses([
      jsonResponse({
        cursor: 'next-page',
        records: [
          {
            uri: 'at://did:plc:frank/nyc.noirot.cad.project/a',
            cid: 'cid-a',
            value: { title: 'A' },
          },
        ],
      }),
      jsonResponse({
        records: [
          {
            uri: 'at://did:plc:frank/nyc.noirot.cad.project/b',
            cid: 'cid-b',
            value: { title: 'B' },
          },
        ],
      }),
    ])
    const client = new AtprotoXrpcClient({
      serviceUrl: 'https://pds.example',
      fetch: fetchMock,
    })

    await expect(
      client.listRecords({
        repo: 'did:plc:frank',
        collection: 'nyc.noirot.cad.project',
      })
    ).resolves.toEqual([
      expect.objectContaining({ cid: 'cid-a' }),
      expect.objectContaining({ cid: 'cid-b' }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://pds.example/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Afrank&collection=nyc.noirot.cad.project&limit=100'
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://pds.example/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Afrank&collection=nyc.noirot.cad.project&limit=100&cursor=next-page'
    )
  })

  test('gets records through com.atproto.repo.getRecord', async () => {
    const fetchMock = fetchMockWithResponses([
      jsonResponse({
        uri: 'at://did:plc:frank/nyc.noirot.cad.project/a',
        cid: 'cid-a',
        value: { title: 'A' },
      }),
    ])
    const client = new AtprotoXrpcClient({
      serviceUrl: 'https://pds.example/',
      fetch: fetchMock,
    })

    await expect(
      client.getRecord({
        repo: 'did:plc:frank',
        collection: 'nyc.noirot.cad.project',
        rkey: 'a',
      })
    ).resolves.toMatchObject({
      uri: 'at://did:plc:frank/nyc.noirot.cad.project/a',
      cid: 'cid-a',
    })

    expect(requestUrl(fetchMock).toString()).toBe(
      'https://pds.example/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Afrank&collection=nyc.noirot.cad.project&rkey=a'
    )
  })

  test('writes records with Authorization and swapRecord', async () => {
    const fetchMock = fetchMockWithResponses([
      jsonResponse({
        uri: 'at://did:plc:frank/nyc.noirot.cad.project/a',
        cid: 'cid-next',
      }),
    ])
    const client = new AtprotoXrpcClient({
      serviceUrl: 'https://pds.example',
      accessToken: () => 'token-123',
      fetch: fetchMock,
    })

    await expect(
      client.putRecord({
        repo: 'did:plc:frank',
        collection: 'nyc.noirot.cad.project',
        rkey: 'a',
        record: { title: 'A' },
        swapRecord: 'cid-current',
      })
    ).resolves.toMatchObject({ cid: 'cid-next' })

    const init = requestInit(fetchMock)
    expect(requestUrl(fetchMock).toString()).toBe(
      'https://pds.example/xrpc/com.atproto.repo.putRecord'
    )
    expect(init?.method).toBe('POST')
    expect((init?.headers as Headers).get('Authorization')).toBe(
      'Bearer token-123'
    )
    expect((init?.headers as Headers).get('Content-Type')).toBe(
      'application/json'
    )
    expect(JSON.parse(init?.body as string)).toEqual({
      repo: 'did:plc:frank',
      collection: 'nyc.noirot.cad.project',
      rkey: 'a',
      record: { title: 'A' },
      swapRecord: 'cid-current',
    })
  })

  test('maps InvalidSwap write failures to stale revision errors', async () => {
    const fetchMock = fetchMockWithResponses([
      jsonResponse(
        {
          error: 'InvalidSwap',
          message: 'record changed',
        },
        { status: 400, statusText: 'Bad Request' }
      ),
    ])
    const client = new AtprotoXrpcClient({
      serviceUrl: 'https://pds.example',
      accessToken: 'token-123',
      fetch: fetchMock,
    })

    await expect(
      client.putRecord({
        repo: 'did:plc:frank',
        collection: 'nyc.noirot.cad.project',
        rkey: 'a',
        record: { title: 'A' },
        swapRecord: 'cid-current',
      })
    ).rejects.toMatchObject({
      expectedRevision: 'cid-current',
    } satisfies Partial<AtprotoSyncStaleRevisionError>)
  })

  test('uploads blobs and fetches blobs by DID and CID', async () => {
    const uploadedBytes = new TextEncoder().encode('zip bytes')
    const downloadedBytes = new TextEncoder().encode('downloaded bytes')
    const fetchMock = fetchMockWithResponses([
      jsonResponse({
        blob: {
          $type: 'blob',
          ref: { $link: 'bafkreiuploaded' },
          mimeType: 'application/zip',
          size: uploadedBytes.byteLength,
        },
      }),
      new Response(downloadedBytes),
    ])
    const client = new AtprotoXrpcClient({
      serviceUrl: 'https://pds.example',
      accessToken: 'token-123',
      fetch: fetchMock,
    })

    const blob = await client.uploadBlob({
      repo: 'did:plc:frank',
      bytes: uploadedBytes,
      contentType: 'application/zip',
    })
    expect(blob).toMatchObject({
      ref: { $link: 'bafkreiuploaded' },
      mimeType: 'application/zip',
    })
    expect(
      (requestInit(fetchMock)?.headers as Headers).get('Authorization')
    ).toBe('Bearer token-123')
    expect(
      (requestInit(fetchMock)?.headers as Headers).get('Content-Type')
    ).toBe('application/zip')
    expect(requestInit(fetchMock)?.body).toBeInstanceOf(ArrayBuffer)

    await expect(
      client.getBlob({
        repo: 'did:plc:frank',
        blob,
      })
    ).resolves.toEqual(
      downloadedBytes.buffer.slice(
        downloadedBytes.byteOffset,
        downloadedBytes.byteOffset + downloadedBytes.byteLength
      )
    )
    expect(requestUrl(fetchMock).toString()).toBe(
      'https://pds.example/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Afrank&cid=bafkreiuploaded'
    )
  })

  test('preserves generic XRPC error details and retry-after delays', async () => {
    const fetchMock = fetchMockWithResponses([
      jsonResponse(
        {
          error: 'RateLimitExceeded',
          message: 'slow down',
        },
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: {
            'retry-after': '7',
          },
        }
      ),
    ])
    const client = new AtprotoXrpcClient({
      serviceUrl: 'https://pds.example',
      fetch: fetchMock,
    })

    await expect(
      client.getRecord({
        repo: 'did:plc:frank',
        collection: 'nyc.noirot.cad.project',
        rkey: 'a',
      })
    ).rejects.toMatchObject({
      status: 429,
      errorName: 'RateLimitExceeded',
      message: 'slow down',
      retryAfterMs: 7000,
    } satisfies Partial<AtprotoXrpcError>)
  })
})

describe('ATProto blob refs', () => {
  test('extracts blob CIDs from current and legacy blob ref shapes', () => {
    expect(atprotoBlobCid({ ref: { $link: 'bafkreiobject' } })).toBe(
      'bafkreiobject'
    )
    expect(atprotoBlobCid({ ref: 'bafkreistring' })).toBe('bafkreistring')
    expect(atprotoBlobCid({ cid: 'bafkreicid' })).toBe('bafkreicid')
    expect(atprotoBlobCid({})).toBeUndefined()
  })
})
